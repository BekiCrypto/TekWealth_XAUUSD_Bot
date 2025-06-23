import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  crypto as webCrypto, // Renamed to avoid conflict with Deno.crypto
} from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";


// Helper function to get environment variables
function getEnv(variableName: string): string {
  const value = Deno.env.get(variableName);
  if (!value) {
    throw new Error(`Environment variable ${variableName} is not set.`)
  }
  return value
}

// --- Cryptography Helpers for Password Encryption ---
const VAULT_SECRET_KEY_NAME = "TRADING_ACCOUNT_ENC_KEY"; // Name of the secret in Supabase Vault

async function getKeyFromVault(): Promise<CryptoKey> {
  const keyMaterialBase64 = Deno.env.get(VAULT_SECRET_KEY_NAME);
  if (!keyMaterialBase64) {
    throw new Error(`Vault secret ${VAULT_SECRET_KEY_NAME} not found. Please set it in Supabase Vault (e.g., a 32-byte base64 encoded string).`);
  }
  try {
    const keyMaterial = base64Decode(keyMaterialBase64);
    if (keyMaterial.byteLength !== 32) { // Ensure it's 256-bit
        throw new Error("Vault encryption key must be 32 bytes (256-bit) long when base64 decoded.");
    }
    return await webCrypto.subtle.importKey(
      "raw",
      keyMaterial,
      { name: "AES-GCM" },
      false, // not extractable
      ["encrypt", "decrypt"]
    );
  } catch (e) {
    console.error("Error importing key from vault:", e.message);
    throw new Error("Failed to import encryption key. Ensure it's a valid base64 encoded 32-byte key.");
  }
}

async function encryptPassword(password: string): Promise<string> {
  const key = await getKeyFromVault();
  const iv = webCrypto.getRandomValues(new Uint8Array(12)); // AES-GCM recommended IV size is 12 bytes
  const encodedPassword = new TextEncoder().encode(password);

  const encryptedData = await webCrypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encodedPassword
  );

  // Combine IV and ciphertext, then base64 encode for storage
  // Format: base64(iv):base64(ciphertext)
  const ivBase64 = base64Encode(iv);
  const encryptedBase64 = base64Encode(new Uint8Array(encryptedData));
  return `${ivBase64}:${encryptedBase64}`;
}

/*
async function decryptPassword(encryptedPasswordWithIv: string): Promise<string> {
  const key = await getKeyFromVault();
  const parts = encryptedPasswordWithIv.split(':');
  if (parts.length !== 2) {
    throw new Error("Invalid encrypted password format. Expected 'iv:ciphertext'.");
  }
  const iv = base64Decode(parts[0]);
  const encryptedData = base64Decode(parts[1]);

  const decryptedData = await webCrypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encryptedData
  );

  return new TextDecoder().decode(decryptedData);
}
*/
// --- End Cryptography Helpers ---

// --- Action Handler for Upserting Trading Account with Encrypted Password ---
async function upsertTradingAccountAction(supabase: any, data: any) {
  const { userId, accountId, platform, serverName, loginId, passwordPlainText, isActive = true } = data;

  if (!userId || !platform || !serverName || !loginId || !passwordPlainText) {
    return new Response(JSON.stringify({ error: "Missing required fields (userId, platform, serverName, loginId, passwordPlainText)." }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const encryptedPassword = await encryptPassword(passwordPlainText);

    const accountDataToUpsert = {
      user_id: userId,
      platform: platform,
      server_name: serverName,
      login_id: loginId,
      password_encrypted: encryptedPassword, // Store the encrypted password
      is_active: isActive,
      // Ensure other non-sensitive fields like account_balance, equity are not overwritten here
      // They should be updated by a sync process with the trade provider if needed.
    };

    const query = supabase.from('trading_accounts');
    let result;

    if (accountId) { // If accountId is provided, it's an update
      // Select existing account to preserve non-updated fields if necessary, though upsert handles this.
      // However, for an update, we only want to update specific fields if they are passed.
      // For simplicity, this example updates all provided fields.
      // A more granular update would build the update object dynamically.
      result = await query.update(accountDataToUpsert)
        .eq('id', accountId)
        .eq('user_id', userId) // Ensure user owns the account they are trying to update
        .select()
        .single();
    } else { // Otherwise, it's an insert
      result = await query.insert(accountDataToUpsert)
        .select()
        .single();
    }

    const { data: savedAccount, error: dbError } = result;

    if (dbError) {
      console.error('Error upserting trading account:', dbError);
      // Handle specific errors like unique constraint violation on login_id if necessary
      if (dbError.code === '23505') { // Unique violation
        return new Response(JSON.stringify({ error: "Trading account with this login ID already exists for this server/platform." }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      throw dbError;
    }
     if (!savedAccount) {
      throw new Error("Trading account data was not returned after upsert.");
    }


    // Do NOT return the encryptedPassword or plain password in the response
    const { password_encrypted: _password_encrypted, ...accountToReturn } = savedAccount;

    return new Response(JSON.stringify(accountToReturn), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in upsertTradingAccountAction:", error.message, error.stack);
    const isCryptoError = error.message.includes(VAULT_SECRET_KEY_NAME) || error.message.includes("Failed to import encryption key");
    const logLevel = isCryptoError ? 'CRITICAL' : 'ERROR';
    const logMessage = isCryptoError ? `Encryption setup error: ${error.message}` : `Failed to save trading account: ${error.message}`;

    await logSystemEvent(
      supabase, // supabaseClient is named 'supabase' in this function's scope
      logLevel,
      'UpsertTradingAccount',
      logMessage,
      { stack: error.stack, userId: data?.userId, accountId: data?.accountId }
    );

    if (isCryptoError) {
        return new Response(JSON.stringify({ error: `${logMessage}. Please ensure the Vault secret is correctly configured.` }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
    return new Response(JSON.stringify({ error: "Failed to save trading account: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
// --- End Trading Account Action ---

// --- Retry Helper ---
async function retryAsyncFunction<T>(
  asyncFn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
  context: string = "Unnamed"
): Promise<T> {
  let attempts = 0;
  while (attempts < maxRetries) {
    try {
      if (attempts > 0) {
        console.log(`Retrying ${context}: Attempt ${attempts + 1} of ${maxRetries} after ${delayMs}ms delay...`);
      }
      return await asyncFn();
    } catch (error) {
      attempts++;
      console.error(`Error in ${context} on attempt ${attempts}:`, error.message);
      if (attempts >= maxRetries) {
        console.error(`All ${maxRetries} retries failed for ${context}.`);
        // logSystemEvent is async, but this is inside a sync function if not careful.
        // However, retryAsyncFunction IS async. So this is fine.
        // We need supabaseClient here. This helper might need to be a class or take client.
        // For now, we cannot call logSystemEvent from here without supabaseClient.
        // Let's assume the caller of retryAsyncFunction will log the final failure.
        throw error; // Re-throw the last error
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  // Should not be reached if maxRetries > 0, but typescript needs a return path or throw
  throw new Error(`All retries failed for ${context} (this line should not be reached).`);
}
// --- End Retry Helper ---

// --- System Logging Helper ---
async function logSystemEvent(
  supabaseClient: any,
  level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL',
  context: string,
  message: string,
  details?: any,
  sessionId?: string,
  userId?: string
) {
  try {
    const logEntry: any = {
      log_level: level,
      context,
      message,
      details: details || null,
    };
    if (sessionId) logEntry.session_id = sessionId;
    if (userId) logEntry.user_id = userId;

    const { error } = await supabaseClient.from('system_logs').insert(logEntry);
    if (error) {
      console.error('Failed to insert system log:', error, logEntry);
    }
  } catch (e) {
    console.error('Exception in logSystemEvent:', e);
  }
}
// --- End System Logging Helper ---

// --- Admin Actions ---
// Helper function to check user role (simplified for now)
// In a real app, this would involve decoding JWT and checking custom claims or a roles table.
async function isAdmin(supabaseClient: any, requestHeaders: Headers): Promise<{ authorized: boolean, userId?: string, userEmail?: string }> {
  const authHeader = requestHeaders.get('Authorization');
  if (!authHeader) {
    console.warn("isAdmin check: No Authorization header found.");
    return { authorized: false };
  }
  try {
    const { data: { user }, error } = await supabaseClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (error) {
      console.warn("isAdmin check: Error getting user from JWT:", error.message);
      return { authorized: false };
    }
    if (!user) {
      console.warn("isAdmin check: No user object returned from JWT.");
      return { authorized: false };
    }

    // Super basic: check if user email matches a predefined admin email ENV var (NOT recommended for production)
    const adminEmail = Deno.env.get("ADMIN_EMAIL_ADDRESS");
    if (adminEmail && user.email === adminEmail) {
        // console.log(`User ${user.email} identified as admin via ADMIN_EMAIL_ADDRESS.`);
        return { authorized: true, userId: user.id, userEmail: user.email };
    }
    console.warn(`isAdmin check: User ${user.email} is not authorized as admin based on current basic check.`);
    return { authorized: false, userId: user.id, userEmail: user.email };
  } catch (e) {
    console.error("isAdmin check: Exception during auth check:", e.message);
    return { authorized: false };
  }
}

async function adminGetEnvVariablesStatusAction(supabaseClient: any, _data: any, headers: Headers) {
  const adminCheck = await isAdmin(supabaseClient, headers);
  if (!adminCheck.authorized) {
    await logSystemEvent(supabaseClient, 'WARN', 'AdminActionAttempt', 'Unauthorized attempt to access adminGetEnvVariablesStatusAction.', { userId: adminCheck.userId, userEmail: adminCheck.userEmail });
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
  }

  const criticalEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'ALPHA_VANTAGE_API_KEY',
    'SENDGRID_API_KEY',
    'FROM_EMAIL',
    'NOTIFICATION_EMAIL_RECIPIENT',
    'MT_BRIDGE_URL', // Optional depending on TRADE_PROVIDER_TYPE
    'MT_BRIDGE_API_KEY', // Optional
    'TRADE_PROVIDER_TYPE',
    VAULT_SECRET_KEY_NAME, // From crypto helpers
    'ADMIN_EMAIL_ADDRESS' // For the basic admin check
  ];

  const statuses = criticalEnvVars.map(varName => {
    const value = Deno.env.get(varName);
    return { name: varName, status: value ? "SET" : "NOT SET" };
  });

  return new Response(JSON.stringify(statuses), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function adminListUsersOverviewAction(supabaseClient: any, _data: any, headers: Headers) {
  const adminCheck = await isAdmin(supabaseClient, headers);
  if (!adminCheck.authorized) {
    await logSystemEvent(supabaseClient, 'WARN', 'AdminActionAttempt', 'Unauthorized attempt to access adminListUsersOverviewAction.', { userId: adminCheck.userId, userEmail: adminCheck.userEmail });
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
  }

  try {
    // Note: Supabase client library's listUsers is an admin API.
    // Ensure your SERVICE_ROLE_KEY is used when creating supabaseClient for this to work.
    const { data: { users }, error } = await supabaseClient.auth.admin.listUsers({
        page: 1,
        perPage: 100, // Adjust as needed
    });

    if (error) throw error;

    const usersOverview = users.map(user => ({
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      // role: user.app_metadata?.role || user.user_metadata?.role || 'user', // Example if role is in metadata
    }));

    return new Response(JSON.stringify(usersOverview), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error("Error in adminListUsersOverviewAction:", error.message);
    return new Response(JSON.stringify({ error: "Failed to list users: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function adminGetSystemLogsAction(supabaseClient: any, data: any, headers: Headers) {
  const adminCheck = await isAdmin(supabaseClient, headers);
  if (!adminCheck.authorized) {
    await logSystemEvent(supabaseClient, 'WARN', 'AdminActionAttempt', 'Unauthorized attempt to access adminGetSystemLogsAction.', { userId: adminCheck.userId, userEmail: adminCheck.userEmail });
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
  }

  const {
    limit = 50,
    offset = 0,
    log_level,
    context,
    start_date, // ISO string
    end_date    // ISO string
  } = data || {};

  try {
    let query = supabaseClient.from('system_logs').select('*');

    if (log_level) query = query.eq('log_level', log_level);
    if (context) query = query.ilike('context', `%${context}%`); // Case-insensitive like
    if (start_date) query = query.gte('created_at', start_date);
    if (end_date) query = query.lte('created_at', end_date);

    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: logs, error, count } = await query;

    if (error) throw error;

    return new Response(JSON.stringify({ logs, count }), { // Send count for pagination
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in adminGetSystemLogsAction:", error.message);
    await logSystemEvent(supabaseClient, 'ERROR', 'AdminGetSystemLogs', `Failed to fetch system logs: ${error.message}`, { stack: error.stack, filters: data });
    return new Response(JSON.stringify({ error: "Failed to fetch system logs: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}
// --- End Admin Actions ---


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Global variable to cache the latest price to minimize API calls
let latestGoldPrice: { price: number; timestamp: number } | null = null;
const PRICE_CACHE_DURATION_MS = 5 * 60 * 1000; // Cache price for 5 minutes

// --- Enhanced Trade Execution Abstraction ---
// Parameter and Result Types
interface ExecuteOrderParams {
  userId: string;
  tradingAccountId: string;
  symbol: string;
  tradeType: 'BUY' | 'SELL';
  lotSize: number;
  openPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  botSessionId?: string;
}

interface ExecuteOrderResult {
  success: boolean;
  tradeId?: string;
  ticketId?: string;
  error?: string;
}

interface CloseOrderParams {
  ticketId: string;
  lots?: number;
  price?: number;
  slippage?: number;
  // For SimulatedTradeProvider to fetch current price:
  userId?: string; // To potentially log who initiated close, or for simulated context
  tradingAccountId?: string; // For simulated context
}

interface CloseOrderResult {
  success: boolean;
  ticketId: string;
  closePrice?: number;
  profit?: number;
  error?: string;
}

interface AccountSummary {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  error?: string;
}

interface OpenPosition {
  ticket: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  lots: number;
  openPrice: number;
  openTime: string;
  stopLoss?: number;
  takeProfit?: number;
  currentPrice?: number;
  profit?: number;
  swap?: number;
  comment?: string;
}

interface ServerTime {
  time: string;
  error?: string;
}

// Expanded Interface
interface ITradeExecutionProvider {
  executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult>;
  closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>;
  getAccountSummary(tradingAccountId?: string): Promise<AccountSummary>;
  getOpenPositions(tradingAccountId?: string): Promise<OpenPosition[]>;
  getServerTime(): Promise<ServerTime>;
}

class SimulatedTradeProvider implements ITradeExecutionProvider {
  private supabase: any;
  private alphaVantageApiKey: string;

  constructor(supabaseClient: any, alphaVantageApiKey: string) {
    this.supabase = supabaseClient;
    this.alphaVantageApiKey = alphaVantageApiKey;
  }

  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const ticketId = generateTicketId();
      const { data: dbTrade, error } = await this.supabase
        .from('trades')
        .insert({
          user_id: params.userId,
          trading_account_id: params.tradingAccountId,
          ticket_id: ticketId,
          symbol: params.symbol,
          trade_type: params.tradeType,
          lot_size: params.lotSize,
          open_price: params.openPrice,
          stop_loss: params.stopLossPrice,
          take_profit: params.takeProfitPrice,
          status: 'open',
          bot_session_id: params.botSessionId,
        })
        .select('id')
        .single();

      if (error) {
        console.error('SimulatedTradeProvider: Error inserting trade:', error);
        return { success: false, error: error.message, ticketId };
      }
      if (!dbTrade || !dbTrade.id) {
        return { success: false, error: "SimulatedTradeProvider: Failed to insert trade or retrieve its ID.", ticketId };
      }
      return { success: true, tradeId: dbTrade.id, ticketId };
    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in executeOrder:', e);
      return { success: false, error: e.message };
    }
  }

  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    const { ticketId } = params;
    try {
      // For simulated close, we need the current market price.
      // This assumes the close is for XAUUSD if not specified otherwise.
      const currentPrice = await getCurrentGoldPrice(this.alphaVantageApiKey);

      const { data: tradeToClose, error: fetchError } = await this.supabase
        .from('trades')
        .select('*')
        .eq('id', ticketId) // Assuming ticketId is the database UUID 'id'
        .eq('status', 'open')
        .single();

      if (fetchError) throw new Error(`Error fetching trade to close: ${fetchError.message}`);
      if (!tradeToClose) return { success: false, ticketId, error: "Open trade with specified ID not found." };

      const priceDiff = tradeToClose.trade_type === 'BUY'
        ? currentPrice - tradeToClose.open_price
        : tradeToClose.open_price - currentPrice;
      const profitLoss = priceDiff * tradeToClose.lot_size * 100;

      const { error: updateError } = await this.supabase
        .from('trades')
        .update({
          close_price: currentPrice,
          profit_loss: profitLoss,
          status: 'closed',
          close_time: new Date().toISOString(),
        })
        .eq('id', ticketId);

      if (updateError) throw new Error(`Error updating trade to closed: ${updateError.message}`);
      return { success: true, ticketId, closePrice: currentPrice, profit: parseFloat(profitLoss.toFixed(2)) };
    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in closeOrder:', e);
      return { success: false, ticketId, error: e.message };
    }
  }

  async getAccountSummary(tradingAccountId?: string): Promise<AccountSummary> {
    if (tradingAccountId) {
        const {data, error} = await this.supabase
            .from('trading_accounts') // Assuming you have a table storing account details
            .select('account_balance, equity, margin, free_margin, currency')
            .eq('id', tradingAccountId)
            .single();
        if (error || !data) {
            console.error("SimulatedTradeProvider: Error fetching account summary from DB for account:", tradingAccountId, error);
            return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'USD', error: "Account not found or DB error."};
        }
        return {
            balance: data.account_balance || 0,
            equity: data.equity || 0,
            margin: data.margin || 0,
            freeMargin: data.free_margin || 0,
            currency: data.currency || 'USD'
        };
    }
    // Fallback static data if no specific tradingAccountId is provided
    return { balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, currency: 'USD', error: "No accountId provided, returning default summary." };
  }

  async getOpenPositions(tradingAccountId?: string): Promise<OpenPosition[]> {
    try {
      let query = this.supabase.from('trades').select('*').eq('status', 'open');
      if (tradingAccountId) {
        query = query.eq('trading_account_id', tradingAccountId);
      }
      const { data, error } = await query;
      if (error) throw error;

      return (data || []).map(t => ({
        ticket: t.id,
        symbol: t.symbol,
        type: t.trade_type,
        lots: t.lot_size,
        openPrice: t.open_price,
        openTime: t.created_at,
        stopLoss: t.stop_loss,
        takeProfit: t.take_profit,
        comment: t.bot_session_id ? `BotSess:${t.bot_session_id}` : (t.ticket_id || '')
        // currentPrice and profit would need live price fetching here if desired for this view
      }));
    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in getOpenPositions:', e);
      return [];
    }
  }

  async getServerTime(): Promise<ServerTime> {
    return { time: new Date().toISOString() };
  }
}

class MetaTraderBridgeProvider implements ITradeExecutionProvider {
  private bridgeUrl: string;
  private bridgeApiKey: string;

  constructor(bridgeUrl: string, bridgeApiKey: string) {
    if (!bridgeUrl || !bridgeApiKey) {
      throw new Error("MetaTraderBridgeProvider: bridgeUrl and bridgeApiKey are required.");
    }
    this.bridgeUrl = bridgeUrl.endsWith('/') ? bridgeUrl.slice(0, -1) : bridgeUrl;
    this.bridgeApiKey = bridgeApiKey;
  }

  private async makeRequest(endpoint: string, method: string, body?: any): Promise<any> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MT-Bridge-API-Key': this.bridgeApiKey,
    };

    const fetchFn = async () => {
      const response = await fetch(`${this.bridgeUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
            errorData = JSON.parse(errorText);
        } catch (e) {
            errorData = { error: "Failed to parse error response from bridge", details: errorText };
        }
        // Log the error before throwing to ensure it's captured by retry logic's console output
        console.error(`MetaTraderBridgeProvider Error (Attempt): ${response.status} ${response.statusText} for ${method} ${endpoint}`, errorData);
        throw new Error(`Bridge API Error (${method} ${endpoint}): ${response.status} - ${errorData.error || response.statusText}`);
      }

      if (response.status === 202 || response.status === 204) {
          return { success: true, message: `Request to ${endpoint} accepted.` };
      }
      return await response.json();
    };

    try {
      // Retry up to 2 times (total 3 attempts) with 3s delay for bridge requests
      return await retryAsyncFunction(fetchFn, 2, 3000, `MetaTraderBridgeProvider.makeRequest(${method} ${endpoint})`);
    } catch (error) {
      // This error is after all retries have failed
      console.error(`All retries failed for MetaTraderBridgeProvider.makeRequest (${method} ${endpoint}):`, error.message);
      throw error; // Re-throw the final error to be handled by the calling method
    }
  }

  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const requestBody = {
        symbol: params.symbol,
        type: params.tradeType,
        lots: params.lotSize,
        price: params.openPrice,
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
        magicNumber: params.botSessionId ? parseInt(params.botSessionId.replace(/\D/g,'').slice(-7)) || 0 : 0,
        comment: `BotTrade_Sess${params.botSessionId || 'N/A'}`,
      };
      const responseData = await this.makeRequest('/order/execute', 'POST', requestBody);
      if (responseData.success && responseData.ticket) {
        return { success: true, tradeId: responseData.ticket.toString(), ticketId: responseData.ticket.toString() };
      } else {
        return { success: false, error: responseData.error || "Failed to execute order via bridge." };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    try {
      const responseData = await this.makeRequest('/order/close', 'POST', {
        ticket: parseInt(params.ticketId),
        lots: params.lots,
      });
      if (responseData.success) {
        return { success: true, ticketId: params.ticketId, closePrice: responseData.closePrice, profit: responseData.profit };
      } else {
        return { success: false, ticketId: params.ticketId, error: responseData.error || "Failed to close order via bridge." };
      }
    } catch (error) {
      return { success: false, ticketId: params.ticketId, error: error.message };
    }
  }

  async getAccountSummary(): Promise<AccountSummary> {
    try {
      const data = await this.makeRequest('/account/summary', 'GET');
      return {
        balance: data.balance,
        equity: data.equity,
        margin: data.margin,
        freeMargin: data.freeMargin,
        currency: data.currency,
      };
    } catch (error) {
      return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'N/A', error: error.message };
    }
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
     try {
      const data = await this.makeRequest('/positions/open', 'GET');
      return (data.positions || []).map((p: any) => ({
          ticket: p.ticket.toString(),
          symbol: p.symbol,
          type: p.type,
          lots: p.lots,
          openPrice: p.openPrice,
          openTime: p.openTime,
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
          currentPrice: p.currentPrice,
          profit: p.profit,
          swap: p.swap,
          comment: p.comment,
      }));
    } catch (error) {
      console.error('MetaTraderBridgeProvider: Error fetching open positions:', error);
      return [];
    }
  }

  async getServerTime(): Promise<ServerTime> {
    try {
      const data = await this.makeRequest('/server/time', 'GET');
      return { time: data.serverTime, error: data.error };
    } catch (error) {
      return { time: '', error: error.message };
    }
  }
}
// --- End Trade Execution Abstraction ---


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      getEnv('SUPABASE_URL'),
      getEnv('SUPABASE_SERVICE_ROLE_KEY')
    )
    const alphaVantageApiKey = getEnv('ALPHA_VANTAGE_API_KEY')

    const body = await req.json()
    const action = body.action; // Ensure action is correctly extracted
    const data = body.data;     // Ensure data is correctly extracted

    switch (action) {
      case 'execute_trade':
        return await executeTrade(supabaseClient, data, alphaVantageApiKey)
      
      case 'close_trade':
        return await closeTrade(supabaseClient, data, alphaVantageApiKey)
      
      case 'update_prices':
        return await updatePrices(supabaseClient, data)
      
      case 'run_bot_logic':
        return await runBotLogic(supabaseClient, data, alphaVantageApiKey)

      case 'get_current_price_action':
        try {
          const price = await getCurrentGoldPrice(alphaVantageApiKey);
          return new Response(JSON.stringify({ price }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } catch (error) {
          await logSystemEvent(supabaseClient, 'ERROR', 'GetCurrentPriceAction', `Failed to get current price: ${error.message}`, { stack: error.stack });
          // Re-throw or return error response, consistent with other error handling
          throw error; // Let the main serve catch block handle response formatting
        }

      case 'fetch_historical_data_action': // New action
        return await fetchAndStoreHistoricalData(supabaseClient, data, alphaVantageApiKey);

      case 'run_backtest_action': // New action for backtesting
        return await runBacktestAction(supabaseClient, data, alphaVantageApiKey);

      case 'get_backtest_report_action':
        return await getBacktestReportAction(supabaseClient, data);

      case 'list_backtests_action':
        return await listBacktestsAction(supabaseClient, data);

      // New provider actions
      case 'provider_close_order':
        return await handleProviderCloseOrder(supabaseClient, data, alphaVantageApiKey);
      case 'provider_get_account_summary':
        return await handleProviderGetAccountSummary(supabaseClient, data, alphaVantageApiKey);
      case 'provider_list_open_positions':
        return await handleProviderListOpenPositions(supabaseClient, data, alphaVantageApiKey);
      case 'provider_get_server_time':
        return await handleProviderGetServerTime(supabaseClient, data, alphaVantageApiKey);

      case 'upsert_trading_account_action': // New action for secure password handling
        return await upsertTradingAccountAction(supabaseClient, data);

      // Admin actions
      case 'admin_get_env_variables_status':
        return await adminGetEnvVariablesStatusAction(supabaseClient, data, req.headers);
      case 'admin_list_users_overview':
        return await adminListUsersOverviewAction(supabaseClient, data, req.headers);
      case 'admin_get_system_logs':
        return await adminGetSystemLogsAction(supabaseClient, data, req.headers);

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error('Trading engine error:', error.message, error.stack);
    // Attempt to log to system_logs if supabaseClient was initialized
    // Need to check if supabaseClient is in scope and initialized.
    // For simplicity, we'll assume if we are in this catch, it might not be,
    // or the error might be *about* supabaseClient. A more robust solution
    // would pass supabaseClient into a centralized error handler.
    // For now, just console.error is reliable here.
    // Awaiting logSystemEvent(supabaseClient, 'CRITICAL', 'MainServeError', error.message, { stack: error.stack });
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function fetchCurrentGoldPriceFromAPI(apiKey: string): Promise<number> {
  const fetchFn = async () => {
    const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) {
      // Specific check for Alpha Vantage rate limit response
      if (response.status === 429 || (response.headers.get("content-type")?.includes("application/json"))) {
        const errorData = await response.json().catch(() => null);
        if (errorData && errorData.Information && errorData.Information.includes("API call frequency")) {
          throw new Error(`Alpha Vantage API rate limit hit: ${errorData.Information}`);
        }
      }
      throw new Error(`Alpha Vantage API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const rate = data["Realtime Currency Exchange Rate"]?.["5. Exchange Rate"];
    if (!rate) {
      console.warn("Alpha Vantage API did not return expected price data:", data);
      // Fallback or error if no rate found
      if (latestGoldPrice) return latestGoldPrice.price; // return cached if available
      throw new Error("Could not fetch current gold price from Alpha Vantage.");
    }
    const price = parseFloat(rate);
    latestGoldPrice = { price, timestamp: Date.now() };
    // console.log("Fetched new gold price from API:", price); // Reduced verbosity
    return price;
  };

  try {
    // Retry up to 2 times (total 3 attempts) with 2s delay for price fetching
    return await retryAsyncFunction(fetchFn, 2, 2000, "fetchCurrentGoldPriceFromAPI");
  } catch (error) {
    console.error("All retries failed for fetchCurrentGoldPriceFromAPI:", error.message);
    // supabaseClient is not available in this function's scope directly.
    // Logging of this specific failure needs to happen where supabaseClient is available,
    // or this function needs supabaseClient passed to it.
    // For now, this detailed console error will have to suffice for this specific spot.
    // If API fails after retries, try to return the last cached price if not too old
    if (latestGoldPrice && (Date.now() - latestGoldPrice.timestamp < PRICE_CACHE_DURATION_MS * 2)) {
      console.warn("Returning cached gold price due to API error after retries.");
      return latestGoldPrice.price;
    }
    throw error; // Re-throw if no usable cache
  }
}

// --- Action Handlers for ITradeExecutionProvider methods ---
// Helper to get the configured trade provider
// Now needs tradingAccountId to fetch encrypted password for MetaTraderBridgeProvider
async function getTradeProvider(
  supabase: any,
  alphaVantageApiKeyForSimulated: string,
  tradingAccountId?: string // Make this optional for general calls, but required if MT provider needs credentials
): Promise<ITradeExecutionProvider> {
  const providerType = Deno.env.get('TRADE_PROVIDER_TYPE')?.toUpperCase() || 'SIMULATED';

  if (providerType === 'METATRADER') {
    if (!tradingAccountId) {
      // This scenario might occur if an admin tries to call a provider action without specific account context
      // Or if a session is processed without a valid trading_account_id (should be prevented by session validation)
      console.error("MetaTrader provider selected, but no tradingAccountId provided to fetch credentials. Cannot instantiate provider.");
      // Depending on strictness, could throw error or fallback. For now, let's throw an error or return a "dummy" provider that always fails.
      // Or, if certain MT_BRIDGE_API_KEY is global and doesn't need per-account password, this check isn't needed.
      // Assuming for now the MT_BRIDGE_API_KEY is for the bridge itself, but individual account access needs credentials.
      // The current MetaTraderBridgeProvider constructor doesn't take login/password, this needs to be revisited.
      // Let's assume the bridge API key is global, and no per-account password is passed TO the bridge via constructor for now.
      // If per-account credentials ARE needed by the bridge, the bridge API contract and provider need an update.
      // For this step, we focus on decrypting password stored in OUR DB if we were to send it.

      // For the purpose of this step (decrypting password from our DB to *potentially* use it):
      // The MetaTraderBridgeProvider's constructor currently only takes bridgeUrl and bridgeApiKey.
      // It does NOT take the trading account's login/password. This implies either:
      // 1. The bridge itself is pre-configured with account credentials (less likely for multi-user system).
      // 2. The bridge API calls (like /order/execute) would need to include account identifiers and potentially auth tokens.
      // This part of the design (how MT account credentials are used by the bridge) needs clarification
      // if we are to pass decrypted passwords to it.

      // For now, let's assume the `MT_BRIDGE_API_KEY` is the only auth needed FOR THE BRIDGE.
      // The Vault encryption/decryption is for passwords stored IN OUR `trading_accounts` table.
      // If these decrypted passwords need to be sent TO THE BRIDGE with each call,
      // then the `MetaTraderBridgeProvider.makeRequest` or individual methods would need to accept them.

      // Let's proceed with the current structure of MetaTraderBridgeProvider's constructor
      // and note that if individual account passwords need to be passed to the bridge,
      // that's a separate refactor of the provider and its API calls.
      // The decryption logic added here would be useful IF that refactor occurs.

      // TODO: Refactor MetaTraderBridgeProvider and its API contract if per-account login/password
      // needs to be passed to the bridge. Currently, it only uses a global bridge API key.
      // The `decryptPassword` function is available for when this is implemented.
      /*
      if (!tradingAccountId) {
        throw new Error("MetaTrader provider requires tradingAccountId to fetch credentials.");
      }
      const { data: account, error: accError } = await supabase
        .from('trading_accounts')
        .select('password_encrypted, login_id') // Assuming login_id is also needed
        .eq('id', tradingAccountId)
        .single();

      if (accError || !account || !account.password_encrypted) {
        console.error(`Failed to fetch trading account ${tradingAccountId} or its encrypted password.`, accError);
        await logSystemEvent(supabase, 'ERROR', 'GetTradeProvider', `Failed to fetch trading account ${tradingAccountId} or its encrypted password.`, { error: accError?.message, tradingAccountId });
        throw new Error(`Could not retrieve credentials for trading account ${tradingAccountId}.`);
      }

      const decryptedPass = await decryptPassword(account.password_encrypted);
      // Now, MetaTraderBridgeProvider constructor or its methods would need to accept login_id and decryptedPass.
      // e.g. return new MetaTraderBridgeProvider(bridgeUrl, bridgeApiKeyEnv, account.login_id, decryptedPass);
      console.log(`Conceptual: Would use decrypted password for account ${tradingAccountId} / login ${account.login_id}`);
      */

      const bridgeUrl = Deno.env.get('MT_BRIDGE_URL');
      const bridgeApiKeyEnv = Deno.env.get('MT_BRIDGE_API_KEY');
      if (!bridgeUrl || !bridgeApiKeyEnv) {
        console.warn("MetaTrader provider configured but URL or API key missing. Falling back to SIMULATED.");
        return new SimulatedTradeProvider(supabase, alphaVantageApiKeyForSimulated);
      }
      return new MetaTraderBridgeProvider(bridgeUrl, bridgeApiKeyEnv); // Current constructor
    }
    return new SimulatedTradeProvider(supabase, alphaVantageApiKeyForSimulated);
}


async function handleProviderCloseOrder(supabase: any, data: any, alphaVantageApiKey: string) {
  // Provider actions are often generic, may not have tradingAccountId if bridge is global
  // If they become account-specific, data.tradingAccountId would be needed here.
  const provider = await getTradeProvider(supabase, alphaVantageApiKey, data.tradingAccountId);
  const { ticketId, lots, price, slippage } = data; // data should be CloseOrderParams
  if (!ticketId) {
    return new Response(JSON.stringify({ error: "ticketId is required to close an order." }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const result = await provider.closeOrder({ ticketId, lots, price, slippage });
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function handleProviderGetAccountSummary(supabase: any, data: any, alphaVantageApiKey: string) {
  const provider = getTradeProvider(supabase, alphaVantageApiKey);
  const { tradingAccountId } = data; // Optional: for simulated provider context
  const result = await provider.getAccountSummary(tradingAccountId);
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function handleProviderListOpenPositions(supabase: any, data: any, alphaVantageApiKey: string) {
  const provider = getTradeProvider(supabase, alphaVantageApiKey);
  const { tradingAccountId } = data; // Optional: for simulated provider context
  const result = await provider.getOpenPositions(tradingAccountId);
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}

async function handleProviderGetServerTime(supabase: any, _data: any, alphaVantageApiKey: string) {
  const provider = getTradeProvider(supabase, alphaVantageApiKey);
  const result = await provider.getServerTime();
  return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
}
// --- End Action Handlers ---

// --- Email Sending Helper ---
async function sendEmail(
  to: string,
  subject: string,
  htmlContent: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const sendGridApiKey = Deno.env.get('SENDGRID_API_KEY');
  const fromEmail = Deno.env.get('FROM_EMAIL');

  if (!sendGridApiKey) {
    console.error('SENDGRID_API_KEY environment variable is not set. Cannot send email.');
    return { success: false, error: 'SendGrid API Key not configured.' };
  }
  if (!fromEmail) {
    console.error('FROM_EMAIL environment variable is not set. Cannot send email.');
    return { success: false, error: 'Sender email (FROM_EMAIL) not configured.' };
  }

  const emailData = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: fromEmail, name: 'TekWealth Trading Bot' },
    subject: subject,
    content: [{ type: 'text/html', value: htmlContent }],
  };

  const sendFn = async () => {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendGridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    if (response.status === 202) {
      // console.log(`Email sent successfully to ${to}. Subject: ${subject}`); // Reduced verbosity
      const messageId = response.headers.get('x-message-id');
      return { success: true, messageId: messageId || undefined };
    } else {
      // Attempt to parse error body for better logging
      const errorBodyText = await response.text();
      let errorBodyJson = null;
      try {
        errorBodyJson = JSON.parse(errorBodyText);
      } catch (_e) { /* ignore parsing error */ }

      console.error(`Failed to send email. Status: ${response.status}`, errorBodyJson || errorBodyText);
      // Throw an error to trigger retry
      throw new Error(`SendGrid API Error: ${response.status} - ${errorBodyJson ? JSON.stringify(errorBodyJson.errors) : errorBodyText}`);
    }
  };

  try {
    // Retry up to 2 times (total 3 attempts) with 5s delay for email sending
    return await retryAsyncFunction(sendFn, 2, 5000, `sendEmail to ${to}`);
  } catch (error) {
    console.error(`All retries failed for sendEmail to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}
// --- End Email Sending Helper ---

// --- Technical Indicator Utilities ---
// (ohlcData expects objects with high_price, low_price, close_price)
function calculateATR(ohlcData: Array<{high_price: number, low_price: number, close_price: number}>, period: number): (number | null)[] {
  if (!ohlcData || ohlcData.length < period) {
    return ohlcData.map(() => null); // Not enough data
  }

  const trValues: (number | null)[] = [null]; // TR for the first candle is null/undefined
  for (let i = 1; i < ohlcData.length; i++) {
    const high = ohlcData[i].high_price;
    const low = ohlcData[i].low_price;
    const prevClose = ohlcData[i-1].close_price;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trValues.push(tr);
  }

  const atrValues: (number | null)[] = new Array(ohlcData.length).fill(null);
  if (trValues.length < period) return atrValues; // Should not happen if ohlcData.length >= period

  // Calculate first ATR (simple average of first 'period' TR values)
  // We need 'period' TR values. Since trValues[0] is null, we start from trValues[1]
  let sumTr = 0;
  for (let i = 1; i <= period; i++) { // Summing 'period' TRs (trValues[1] to trValues[period])
      if (trValues[i] === null) { // Should not happen if ohlcData is sufficient
          // This case implies not enough data for the first ATR, fill with nulls
          return atrValues;
      }
      sumTr += trValues[i] as number;
  }
  atrValues[period] = sumTr / period; // ATR is typically aligned with the *end* of its first calculation period

  // Subsequent ATR values using Wilder's smoothing
  for (let i = period + 1; i < ohlcData.length; i++) {
    if (atrValues[i-1] === null || trValues[i] === null) { // Should not happen
        atrValues[i] = null;
        continue;
    }
    atrValues[i] = (((atrValues[i-1] as number) * (period - 1)) + (trValues[i] as number)) / period;
  }
  return atrValues;
}

function calculateSMA(prices: number[], period: number): (number | null)[] {
  if (!prices || prices.length === 0) return [];
  const smaValues: (number | null)[] = new Array(prices.length).fill(null);
  if (prices.length < period) return smaValues;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  smaValues[period - 1] = sum / period;

  for (let i = period; i < prices.length; i++) {
    sum = sum - prices[i - period] + prices[i];
    smaValues[i] = sum / period;
  }
  return smaValues;
}

function calculateStdDev(prices: number[], period: number, smaValues: (number | null)[]): (number | null)[] {
    if (!prices || prices.length < period) return new Array(prices.length).fill(null);
    const stdDevValues: (number | null)[] = new Array(prices.length).fill(null);

    for (let i = period - 1; i < prices.length; i++) {
        if (smaValues[i] === null) continue;
        const currentSma = smaValues[i] as number;
        const slice = prices.slice(i - period + 1, i + 1);
        let sumOfSquares = 0;
        for (const price of slice) {
            sumOfSquares += Math.pow(price - currentSma, 2);
        }
        stdDevValues[i] = Math.sqrt(sumOfSquares / period);
    }
    return stdDevValues;
}


function calculateBollingerBands(
    ohlcData: Array<{close_price: number}>,
    period: number,
    stdDevMultiplier: number
): Array<{middle: number | null, upper: number | null, lower: number | null}> {
    if (!ohlcData || ohlcData.length < period) {
        return ohlcData.map(() => ({ middle: null, upper: null, lower: null }));
    }
    const closePrices = ohlcData.map(d => d.close_price);
    const middleBandValues = calculateSMA(closePrices, period);
    const stdDevValues = calculateStdDev(closePrices, period, middleBandValues);

    const bbValues: Array<{middle: number | null, upper: number | null, lower: number | null}> = [];
    for (let i = 0; i < ohlcData.length; i++) {
        if (middleBandValues[i] !== null && stdDevValues[i] !== null) {
            const middle = middleBandValues[i] as number;
            const stdDev = stdDevValues[i] as number;
            bbValues.push({
                middle: middle,
                upper: middle + (stdDev * stdDevMultiplier),
                lower: middle - (stdDev * stdDevMultiplier),
            });
        } else {
            bbValues.push({ middle: null, upper: null, lower: null });
        }
    }
    return bbValues;
}

function calculateRSI(ohlcData: Array<{close_price: number}>, period: number): (number | null)[] {
    if (!ohlcData || ohlcData.length < period) {
        return ohlcData.map(() => null);
    }
    const closePrices = ohlcData.map(d => d.close_price);
    const rsiValues: (number | null)[] = new Array(closePrices.length).fill(null);

    let gains: number[] = [];
    let losses: number[] = [];

    for (let i = 1; i < closePrices.length; i++) {
        const change = closePrices[i] - closePrices[i-1];
        gains.push(change > 0 ? change : 0);
        losses.push(change < 0 ? Math.abs(change) : 0);
    }

    if (gains.length < period -1) return rsiValues; // Not enough data points for first calculation

    let avgGain = 0;
    let avgLoss = 0;

    // Calculate first average gain and loss
    for (let i = 0; i < period; i++) { // Sum first 'period' gains/losses (corresponds to period+1 close prices)
        avgGain += gains[i];
        avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    if (avgLoss === 0) {
        rsiValues[period] = 100; // Avoid division by zero; if all losses are 0, RSI is 100
    } else {
        const rs = avgGain / avgLoss;
        rsiValues[period] = 100 - (100 / (1 + rs));
    }

    // Subsequent RSI values using Wilder's smoothing for average gain/loss
    for (let i = period; i < gains.length; i++) { // Loop from 'period'-th change (which is index period+1 in closePrices)
        avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
        avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;

        if (avgLoss === 0) {
            rsiValues[i + 1] = 100;
        } else {
            const rs = avgGain / avgLoss;
            rsiValues[i + 1] = 100 - (100 / (1 + rs));
        }
    }
    return rsiValues;
}


// ADX function
// Wilder's Smoothing (similar to an EMA with alpha = 1/period)
function wildersSmoothing(values: (number | null)[], period: number): (number | null)[] {
  const smoothed: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return smoothed;

  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < period; i++) {
    if (values[i] !== null) {
      sum += values[i] as number;
      validCount++;
    }
  }

  if (validCount < period && validCount > 0) { // Partial sum if some initial values are null but not all
      // This is a simplification; proper handling of leading nulls for first sum might be needed
      // For now, if not all 'period' values are present for the first sum, we can't start.
      // However, typical indicator usage implies data is present.
  } else if (validCount === 0 && period > 0) {
      return smoothed; // Cannot start if all initial values are null
  }

  // First smoothed value is the average of the first 'period' values
  // This assumes that 'values' array starts with non-nulls for at least 'period' length if it's to work.
  // Or, the nulls are at the beginning and the first valid sum starts after them.
  // Let's find the first valid sum.
  let firstValidIndex = -1;
  for(let i = 0; i <= values.length - period; i++) {
      sum = 0;
      validCount = 0;
      let canCalc = true;
      for(let j=0; j < period; j++) {
          if(values[i+j] === null) {
              canCalc = false;
              break;
          }
          sum += values[i+j] as number;
      }
      if(canCalc) {
          smoothed[i + period -1] = sum / period;
          firstValidIndex = i + period -1;
          break;
      }
  }

  if(firstValidIndex === -1) return smoothed; // Not enough contiguous data to start

  for (let i = firstValidIndex + 1; i < values.length; i++) {
    if (values[i] === null) {
      smoothed[i] = smoothed[i-1]; // Carry forward if current value is null
    } else if (smoothed[i-1] === null) {
      // This case implies a gap, re-initialize sum if possible or continue null
      // For simplicity, if previous smoothed is null due to prolonged nulls in input, this will also be null
      // A more robust version might re-average.
      smoothed[i] = null; // Or attempt re-averaging for 'period' if desired
    }
    else {
      smoothed[i] = ((smoothed[i-1] as number * (period - 1)) + (values[i] as number)) / period;
    }
  }
  return smoothed;
}


interface ADXValues {
    pdi: (number | null)[]; // Positive Directional Indicator (+DI)
    ndi: (number | null)[]; // Negative Directional Indicator (-DI)
    adx: (number | null)[]; // Average Directional Index
}

function calculateADX(
    ohlcData: Array<{high_price: number, low_price: number, close_price: number}>,
    period: number = 14
): ADXValues {
    const results: ADXValues = {
        pdi: new Array(ohlcData.length).fill(null),
        ndi: new Array(ohlcData.length).fill(null),
        adx: new Array(ohlcData.length).fill(null),
    };

    if (ohlcData.length < period + 1) { // Need at least period+1 bars for first calculation
        return results;
    }

    const trValues = calculateATR(ohlcData, period).map((atr,idx) => {
        // ATR is TR/(period) for first, then smoothed. We need raw TR for DM calculations.
        // calculateATR's internal trValues are what we need.
        // Let's recalculate TR here for clarity or make calculateATR return TRs.
        // For now, direct TR calculation:
        if (idx === 0) return null;
        const high = ohlcData[idx].high_price;
        const low = ohlcData[idx].low_price;
        const prevClose = ohlcData[idx-1].close_price;
        return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    });


    const pDM: (number | null)[] = [null]; // Positive Directional Movement
    const nDM: (number | null)[] = [null]; // Negative Directional Movement

    for (let i = 1; i < ohlcData.length; i++) {
        const upMove = ohlcData[i].high_price - ohlcData[i-1].high_price;
        const downMove = ohlcData[i-1].low_price - ohlcData[i].low_price;

        pDM.push((upMove > downMove && upMove > 0) ? upMove : 0);
        nDM.push((downMove > upMove && downMove > 0) ? downMove : 0);
    }

    const smoothedTR = wildersSmoothing(trValues, period);
    const smoothedPDM = wildersSmoothing(pDM, period);
    const smoothedNDM = wildersSmoothing(nDM, period);

    const dxValues: (number | null)[] = new Array(ohlcData.length).fill(null);

    for (let i = 0; i < ohlcData.length; i++) {
        if (smoothedTR[i] && smoothedPDM[i] !== null && smoothedNDM[i] !== null) {
            const sTR = smoothedTR[i] as number;
            const sPDM = smoothedPDM[i] as number;
            const sNDM = smoothedNDM[i] as number;

            if (sTR > 0) {
                results.pdi[i] = (sPDM / sTR) * 100;
                results.ndi[i] = (sNDM / sTR) * 100;

                const diSum = (results.pdi[i] as number) + (results.ndi[i] as number);
                if (diSum > 0) {
                    dxValues[i] = (Math.abs((results.pdi[i] as number) - (results.ndi[i] as number)) / diSum) * 100;
                } else {
                    dxValues[i] = 0; // Or null, if sum is 0, implies no directional movement
                }
            }
        }
    }

    results.adx = wildersSmoothing(dxValues, period);

    return results;
}


// --- Mean Reversion Strategy (Bollinger Bands + RSI) ---
interface MeanReversionSettings {
  bbPeriod?: number;
  bbStdDevMult?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  atrPeriod?: number; // For ATR calculation if not passed in
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;
}

function analyzeMeanReversionStrategy(
  ohlcDataForAnalysis: any[], // Expects objects with open_price, close_price, high_price, low_price
  currentIndexForDecision: number,
  settings: MeanReversionSettings,
  currentAtrValue: number | null // ATR value for the candle *prior* to currentIndexForDecision
): MarketAnalysisResult {
  const {
    bbPeriod = 20,
    bbStdDevMult = 2,
    rsiPeriod = 14,
    rsiOversold = 30,
    rsiOverbought = 70,
    atrMultiplierSL = 1.5, // Default ATR SL multiplier from typical strategy settings
    atrMultiplierTP = 3.0    // Default ATR TP multiplier
  } = settings;

  // Ensure we have enough data for indicators up to the signal candle (candle before decision candle)
  // currentIndexForDecision is the candle we'd act on (e.g. its open)
  // Indicators are based on data *up to* currentIndexForDecision - 1
  const signalCandleIndex = currentIndexForDecision - 1;
  if (signalCandleIndex < Math.max(bbPeriod, rsiPeriod)) {
    return { shouldTrade: false }; // Not enough data for indicators
  }

  const decisionPrice = ohlcDataForAnalysis[currentIndexForDecision].open_price;

  // Calculate indicators on the relevant slice of data ending at the signal candle
  const dataSliceForIndicators = ohlcDataForAnalysis.slice(0, currentIndexForDecision); // Includes signalCandleIndex

  const bbValues = calculateBollingerBands(dataSliceForIndicators, bbPeriod, bbStdDevMult);
  const rsiValues = calculateRSI(dataSliceForIndicators, rsiPeriod);

  const currentBB = bbValues[signalCandleIndex];
  const currentRSI = rsiValues[signalCandleIndex];
  const prevRSI = rsiValues[signalCandleIndex -1]; // For RSI turn confirmation

  if (!currentBB || currentRSI === null || prevRSI === null || currentAtrValue === null) {
    // console.log("MeanReversion: Indicator data missing for decision.", {currentBB, currentRSI, prevRSI, currentAtrValue});
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  const signalCandleClose = dataSliceForIndicators[signalCandleIndex].close_price;
  let tradeType: 'BUY' | 'SELL' | undefined = undefined;

  // Buy Signal Logic: Price near/below lower BB, RSI oversold and turning up
  if (currentBB.lower && signalCandleClose <= currentBB.lower && currentRSI < rsiOversold && currentRSI > prevRSI) {
    tradeType = 'BUY';
  }
  // Sell Signal Logic: Price near/above upper BB, RSI overbought and turning down
  else if (currentBB.upper && signalCandleClose >= currentBB.upper && currentRSI > rsiOverbought && currentRSI < prevRSI) {
    tradeType = 'SELL';
  }

  if (tradeType) {
    const stopLoss = tradeType === 'BUY'
      ? decisionPrice - (currentAtrValue * atrMultiplierSL)
      : decisionPrice + (currentAtrValue * atrMultiplierSL);
    const takeProfit = tradeType === 'BUY'
      ? decisionPrice + (currentAtrValue * atrMultiplierTP)
      : decisionPrice - (currentAtrValue * atrMultiplierTP);

    // console.log(`MeanReversion Signal: ${tradeType} @ ${decisionPrice.toFixed(4)}, SL: ${stopLoss.toFixed(4)}, TP: ${takeProfit.toFixed(4)}, ATR: ${currentAtrValue.toFixed(4)}`);
    return {
      shouldTrade: true,
      tradeType: tradeType,
      priceAtDecision: decisionPrice,
      stopLoss: parseFloat(stopLoss.toFixed(4)),
      takeProfit: parseFloat(takeProfit.toFixed(4)),
    };
  }

  return { shouldTrade: false, priceAtDecision: decisionPrice };
}
// --- End Mean Reversion Strategy ---


// --- End Technical Indicator Utilities ---


interface SimulatedTrade {
  entryTime: string;
  entryPrice: number;
  exitTime?: string;
  exitPrice?: number;
  tradeType: 'BUY' | 'SELL';
  lotSize: number;
  stopLossPrice: number;
  takeProfitPrice?: number | null;
  status: 'open' | 'closed';
  profitOrLoss?: number;
  closeReason?: string; // e.g., 'SL', 'Signal'
}

async function runBacktestAction(supabase: any, data: any, apiKey: string) {
  const {
    userId,
    symbol = 'XAUUSD',
    timeframe = '15min',
    startDate,
    endDate,
    strategySettings = { /* Defaults will be set in fullStrategyParams below */ },
    riskSettings = {
      riskLevel: 'conservative',
      // maxLotSize will be taken from riskSettingsMap based on riskLevel
    },
    commissionPerLot = 0,
    slippagePoints = 0
  } = data;

  // TODO: Implement dynamic lot sizing for backtests.
  // Currently, backtester uses a fixed lot size based on riskLevel's maxLotSize.
  // For more accurate backtests simulating live dynamic lot sizing, this would require:
  // 1. Simulating account equity changes throughout the backtest.
  // 2. Using risk_per_trade_percent from strategySettings.
  // 3. Applying the dynamic lot calculation logic similar to processBotSession.

  // Merge strategySettings from data with defaults for ATR if not provided by caller
  const effectiveStrategySettings = {
    smaShortPeriod: 20,
    smaLongPeriod: 50,
    atrPeriod: 14,
    ...strategySettings // User-provided strategySettings will override defaults
  };

  // Merge riskSettings from data with defaults for ATR multipliers if not provided
  const effectiveRiskSettings = {
    riskLevel: 'conservative',
    maxLotSize: 0.01,
    stopLossPips: 200, // Kept for potential other uses or fallback
    atrMultiplierSL: 1.5,
    atrMultiplierTP: 3.0,
    ...riskSettings // User-provided riskSettings will override defaults
  };


  if (!startDate || !endDate) {
    return new Response(JSON.stringify({ error: "startDate and endDate are required." }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  if (!userId) {
     // In a real app, you might get userId from JWT or session
     // For now, if not provided, we can use a placeholder or make it optional for report storage
     console.warn("userId not provided for backtest report. Report will not be user-associated if saved.");
  }


  try {
    // 1. Fetch Historical Data from DB
    const { data: historicalOhlc, error: dbError } = await supabase
      .from('price_data')
      .select('timestamp, open_price, high_price, low_price, close_price, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('timestamp', startDate)
      .lte('timestamp', endDate)
      .order('timestamp', { ascending: true });

    if (dbError) throw dbError;
    if (!historicalOhlc || historicalOhlc.length < Math.max(effectiveStrategySettings.smaLongPeriod, effectiveStrategySettings.atrPeriod +1) ) {
      return new Response(JSON.stringify({ error: "Not enough historical data for the selected period or to meet strategy MA/ATR length." }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tradesForDb: Omit<SimulatedTrade, 'status' | 'profitOrLoss' | 'closeReason'>[] = [];
    let openTrade: SimulatedTrade | null = null;

    // const pipsToPricePoints = (pips: number) => pips / 10; // Replaced by ATR logic

    // Start loop from where all indicators can be valid
    const loopStartIndex = Math.max(effectiveStrategySettings.smaLongPeriod, effectiveStrategySettings.atrPeriod + 1);

    for (let i = loopStartIndex; i < historicalOhlc.length; i++) {
      const currentCandle = historicalOhlc[i];
      const currentTime = currentCandle.timestamp;
      const currentLowPrice = currentCandle.low_price;
      const currentHighPrice = currentCandle.high_price;

      if (openTrade) {
        let actualExitPrice = 0;
        let closeReason = '';

        // Check Stop Loss
        if (openTrade.tradeType === 'BUY' && currentLowPrice <= openTrade.stopLossPrice) {
          actualExitPrice = openTrade.stopLossPrice - slippagePoints; // Worse exit for BUY
          closeReason = 'SL';
        } else if (openTrade.tradeType === 'SELL' && currentHighPrice >= openTrade.stopLossPrice) {
          actualExitPrice = openTrade.stopLossPrice + slippagePoints; // Worse exit for SELL
          closeReason = 'SL';
        }
        // Check Take Profit (if defined)
        else if (openTrade.takeProfitPrice) {
            if (openTrade.tradeType === 'BUY' && currentHighPrice >= openTrade.takeProfitPrice) {
                actualExitPrice = openTrade.takeProfitPrice - slippagePoints; // Worse exit for BUY (less profit)
                closeReason = 'TP';
            } else if (openTrade.tradeType === 'SELL' && currentLowPrice <= openTrade.takeProfitPrice) {
                actualExitPrice = openTrade.takeProfitPrice + slippagePoints; // Worse exit for SELL (less profit)
                closeReason = 'TP';
            }
        }

        if (closeReason) {
          const priceDiff = openTrade.tradeType === 'BUY'
            ? actualExitPrice - openTrade.entryPrice
            : openTrade.entryPrice - actualExitPrice;
          let profitLoss = priceDiff * openTrade.lotSize * 100;
          const commissionCost = (commissionPerLot || 0) * openTrade.lotSize;
          profitLoss -= commissionCost;

          tradesForDb.push({
            ...openTrade,
            exitTime: currentTime,
            exitPrice: actualExitPrice,
            profitOrLoss: profitLoss,
            closeReason: closeReason,
          });
          openTrade = null;
        }
      }

      const analysisResult = await analyzeMarketConditions(
        apiKey,
        { // Pass full strategyParams object
            smaShortPeriod: effectiveStrategySettings.smaShortPeriod,
            smaLongPeriod: effectiveStrategySettings.smaLongPeriod,
            atrPeriod: effectiveStrategySettings.atrPeriod,
            atrMultiplierSL: effectiveRiskSettings.atrMultiplierSL,
            atrMultiplierTP: effectiveRiskSettings.atrMultiplierTP,
        },
        historicalOhlc,
        i
      );

      // C. Handle Signals
      if (openTrade) { // If a trade is open
        // Check for exit signal (e.g., opposite crossover)
        if (analysisResult.shouldTrade && analysisResult.tradeType !== openTrade.tradeType) {
          const exitPrice = analysisResult.priceAtDecision as number; // Exit at the decision price of the opposite signal
          const priceDiff = openTrade.tradeType === 'BUY'
            ? exitPrice - openTrade.entryPrice
            : openTrade.entryPrice - exitPrice;
          tradesForDb.push({
            ...openTrade, // Spreads existing openTrade properties
            exitTime: currentTime,
            exitPrice: exitPrice,
            profitOrLoss: priceDiff * openTrade.lotSize * 100,
            closeReason: 'Signal',
          });
          openTrade = null;
        }
        // Add Take Profit Check if TP is defined for the open trade
        else if (openTrade.takeProfitPrice) {
            let tpHit = false;
            if (openTrade.tradeType === 'BUY' && currentHighPrice >= openTrade.takeProfitPrice) {
                tpHit = true;
                openTrade.exitPrice = openTrade.takeProfitPrice;
            } else if (openTrade.tradeType === 'SELL' && currentLowPrice <= openTrade.takeProfitPrice) {
                tpHit = true;
                openTrade.exitPrice = openTrade.takeProfitPrice;
            }
            if (tpHit) {
                const priceDiff = openTrade.tradeType === 'BUY'
                    ? (openTrade.exitPrice as number) - openTrade.entryPrice
                    : openTrade.entryPrice - (openTrade.exitPrice as number);
                tradesForDb.push({
                    ...openTrade,
                    exitTime: currentTime,
                    profitOrLoss: priceDiff * openTrade.lotSize * 100,
                    closeReason: 'TP'
                });
                openTrade = null;
            }
        }

      } else { // No open trade, look for entry
        if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision && analysisResult.stopLoss) {
          openTrade = {
            entryTime: currentTime,
            entryPrice: analysisResult.priceAtDecision,
            tradeType: analysisResult.tradeType,
            lotSize: effectiveRiskSettings.maxLotSize,
            stopLossPrice: analysisResult.stopLoss,
            takeProfitPrice: analysisResult.takeProfit, // Will be undefined if not set by strategy
            status: 'open',
          };
        }
      }
    }

    if (openTrade) {
      const lastCandle = historicalOhlc[historicalOhlc.length - 1];
      const exitPrice = lastCandle.close_price;
      const priceDiff = openTrade.tradeType === 'BUY' ? exitPrice - openTrade.entryPrice : openTrade.entryPrice - exitPrice;
      tradesForDb.push({
        ...openTrade,
        exitTime: lastCandle.timestamp,
        exitPrice: exitPrice,
        profitOrLoss: priceDiff * openTrade.lotSize * 100,
        closeReason: 'EndOfTest',
      });
    }

    let totalProfitLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    tradesForDb.forEach(trade => {
      if (trade.profitOrLoss) {
        totalProfitLoss += trade.profitOrLoss;
        if (trade.profitOrLoss > 0) winningTrades++;
        else if (trade.profitOrLoss < 0) losingTrades++;
      }
    });
    const totalTrades = tradesForDb.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const reportSummary = {
      user_id: userId || null, // Store null if no userId
      symbol,
      timeframe,
      start_date: startDate,
      end_date: endDate,
      strategy_settings: strategySettings,
      risk_settings: riskSettings,
      total_trades: totalTrades,
      total_profit_loss: parseFloat(totalProfitLoss.toFixed(2)),
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      win_rate: parseFloat(winRate.toFixed(2)),
    };

    const { data: report, error: reportError } = await supabase
      .from('backtest_reports')
      .insert(reportSummary)
      .select()
      .single();

    if (reportError) throw reportError;
    if (!report) throw new Error("Failed to save backtest report summary.");

    const reportId = report.id;
    const simulatedTradesToStore = tradesForDb.map(t => ({
      backtest_report_id: reportId,
      entry_time: t.entryTime,
      entry_price: t.entryPrice,
      exit_time: t.exitTime,
      exit_price: t.exitPrice,
      trade_type: t.tradeType,
      lot_size: t.lotSize,
      stop_loss_price: t.stopLossPrice,
      profit_or_loss: t.profitOrLoss,
      close_reason: t.closeReason,
    }));

    if (simulatedTradesToStore.length > 0) {
        const { error: tradesError } = await supabase.from('simulated_trades').insert(simulatedTradesToStore);
        if (tradesError) {
            // Attempt to delete the summary report if saving trades fails to maintain consistency
            await supabase.from('backtest_reports').delete().eq('id', reportId);
            throw tradesError;
        }
    }

    // Return the full report including the ID and saved trades
    const finalResults = {
        ...reportSummary, // This doesn't include the 'id' and 'created_at' from the DB response
        id: reportId, // Add the actual report ID
        created_at: report.created_at, // Add created_at from DB
        trades: tradesForDb // Return the trades array as computed (before DB mapping)
    };

    // Send email notification for backtest completion
    const recipientEmail = Deno.env.get('NOTIFICATION_EMAIL_RECIPIENT');
    if (recipientEmail) {
      const emailSubject = `[Trading Bot] Backtest Completed: Report ID ${reportId}`;
      const emailHtmlContent = `
        <h1>Backtest Completed</h1>
        <p>A backtest has successfully completed. Details:</p>
        <ul>
          <li>Report ID: ${reportId}</li>
          <li>Symbol: ${reportSummary.symbol}</li>
          <li>Timeframe: ${reportSummary.timeframe}</li>
          <li>Period: ${new Date(reportSummary.start_date).toLocaleDateString()} - ${new Date(reportSummary.end_date).toLocaleDateString()}</li>
          <li>Total Trades: ${reportSummary.total_trades}</li>
          <li>Total P/L: $${reportSummary.total_profit_loss}</li>
          <li>Win Rate: ${reportSummary.win_rate}%</li>
        </ul>
        <p>Full details and trade list are available in the application.</p>
      `;
      sendEmail(recipientEmail, emailSubject, emailHtmlContent)
        .then(async (emailRes) => { // Made async
            if (emailRes.success) {
              console.log(`Backtest completion email sent to ${recipientEmail}, Message ID: ${emailRes.messageId}`);
            } else {
              const errorMessage = `Failed to send backtest completion email for report ${reportId}: ${emailRes.error}`;
              console.error(errorMessage);
              await logSystemEvent(supabase, 'ERROR', 'SendEmailFailure', errorMessage, { report_id: reportId, recipient: recipientEmail, subject: emailSubject }, undefined, reportSummary.user_id);
            }
        })
        .catch(async (err) => { // Made async
            const errorMessage = `Exception while sending backtest completion email for report ${reportId}: ${err.message}`;
            console.error(errorMessage);
            await logSystemEvent(supabase, 'ERROR', 'SendEmailException', errorMessage, { report_id: reportId, recipient: recipientEmail, subject: emailSubject, stack: err.stack }, undefined, reportSummary.user_id);
        });
    } else {
      console.warn("NOTIFICATION_EMAIL_RECIPIENT not set. Skipping backtest completion email.");
    }

    return new Response(JSON.stringify(finalResults), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in runBacktestAction:", error.message, error.stack);
    await logSystemEvent(supabase, 'ERROR', 'RunBacktestAction', `Backtesting failed: ${error.message}`, { stack: error.stack, params: data });
    return new Response(JSON.stringify({ error: "Backtesting failed: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function getBacktestReportAction(supabase: any, data: any) {
  const { reportId } = data;
  if (!reportId) {
    return new Response(JSON.stringify({ error: "reportId is required." }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const { data: report, error: reportError } = await supabase
      .from('backtest_reports')
      .select('*')
      .eq('id', reportId)
      .single();

    if (reportError) throw reportError;
    if (!report) {
      return new Response(JSON.stringify({ error: "Backtest report not found." }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: trades, error: tradesError } = await supabase
      .from('simulated_trades')
      .select('*')
      .eq('backtest_report_id', reportId)
      .order('entry_time', { ascending: true });

    if (tradesError) throw tradesError;

    return new Response(JSON.stringify({ ...report, trades: trades || [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in getBacktestReportAction:", error.message);
    return new Response(JSON.stringify({ error: "Failed to fetch backtest report: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function listBacktestsAction(supabase: any, data: any) {
  const { userId } = data; // Optional: if not provided, could list all (admin) or require auth context

  try {
    let query = supabase.from('backtest_reports').select('*').order('created_at', { ascending: false });
    if (userId) {
      query = query.eq('user_id', userId);
    }
    // Add pagination if needed: .range(from, to)

    const { data: reports, error } = await query;
    if (error) throw error;

    return new Response(JSON.stringify(reports || []), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in listBacktestsAction:", error.message);
    return new Response(JSON.stringify({ error: "Failed to list backtest reports: " + error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}


async function getCurrentGoldPrice(apiKey: string): Promise<number> {
  if (latestGoldPrice && (Date.now() - latestGoldPrice.timestamp < PRICE_CACHE_DURATION_MS)) {
    console.log("Using cached gold price:", latestGoldPrice.price);
    return latestGoldPrice.price;
  }
  return await fetchCurrentGoldPriceFromAPI(apiKey);
}


async function executeTrade(supabase: any, tradeData: any, apiKey: string) {
  const currentPrice = await getCurrentGoldPrice(apiKey)
  
  const { data: trade, error } = await supabase
    .from('trades')
    .insert({
      user_id: tradeData.userId,
      trading_account_id: tradeData.accountId,
      ticket_id: generateTicketId(),
      symbol: 'XAUUSD',
      trade_type: tradeData.type, // Should be 'BUY' or 'SELL'
      lot_size: tradeData.lotSize,
      open_price: currentPrice,
      stop_loss: tradeData.stopLoss, // Ensure this is calculated correctly by caller
      take_profit: tradeData.takeProfit,
      status: 'open'
    })
    .select()
    .single()

  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: tradeData.userId,
    type: 'trade_alert',
    title: 'Trade Executed (Simulated)',
    message: `${tradeData.type} ${tradeData.lotSize} lots of XAUUSD at $${currentPrice}`
  })

  return new Response(JSON.stringify({ trade }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function closeTrade(supabase: any, closeData: any, apiKey: string) {
  const currentPrice = await getCurrentGoldPrice(apiKey)
  
  const { data: trade, error: fetchError } = await supabase
    .from('trades')
    .select('*')
    .eq('id', closeData.tradeId)
    .single()

  if (fetchError) throw fetchError
  if (!trade) throw new Error(`Trade with ID ${closeData.tradeId} not found.`);

  const priceDiff = trade.trade_type === 'BUY' 
    ? currentPrice - trade.open_price
    : trade.open_price - currentPrice
  
  const profitLoss = priceDiff * trade.lot_size * 100 // Simplified P&L

  const { data: updatedTrade, error } = await supabase
    .from('trades')
    .update({
      close_price: currentPrice,
      profit_loss: profitLoss,
      status: 'closed',
      close_time: new Date().toISOString()
    })
    .eq('id', closeData.tradeId)
    .select()
    .single()

  if (error) throw error

  await supabase.from('notifications').insert({
    user_id: trade.user_id,
    type: 'trade_alert',
    title: 'Trade Closed (Simulated)',
    message: `Trade ${trade.id} closed. P/L: $${profitLoss.toFixed(2)}`
  })

  return new Response(JSON.stringify({ trade: updatedTrade }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// This function might be re-purposed to periodically fetch and store
// historical data from Alpha Vantage if needed for other analytics,
// or if the bot needs more data than it fetches per run.
async function updatePrices(supabase: any, priceData: any) {
  // For now, this is less critical as the bot will fetch its own data.
  // Could be used to backfill `price_data` table from Alpha Vantage.
  console.log("updatePrices called, currently a placeholder action.", priceData)
  // Example: Storing to price_data if you adapt it
  // const { data, error } = await supabase
  //   .from('price_data')
  //   .insert({ /* ... priceData mapping ... */ })
  // if (error) throw error
  return new Response(JSON.stringify({ success: true, message: "updatePrices placeholder" }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function runBotLogic(supabase: any, _botData: any, apiKey: string) {
  await logSystemEvent(supabase, 'INFO', 'RunBotLogic', 'Scheduled bot logic execution started.');
  const { data: sessions, error } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('status', 'active')

  if (error) {
    await logSystemEvent(supabase, 'ERROR', 'RunBotLogic', 'Error fetching active bot sessions.', { error: error.message, stack: error.stack });
    throw error;
  }

  if (!sessions || sessions.length === 0) {
    await logSystemEvent(supabase, 'INFO', 'RunBotLogic', 'No active bot sessions found.');
    return new Response(JSON.stringify({ processed: 0, message: "No active sessions" }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }


  let processedCount = 0;
  for (const session of sessions) {
    try {
      await processBotSession(supabase, session, apiKey)
      processedCount++;
    } catch (sessionError) {
      console.error(`Error processing bot session ${session.id}:`, sessionError.message, sessionError.stack);
      await logSystemEvent(
        supabase,
        'ERROR',
        'ProcessBotSession',
        `Failed to process session ${session.id}: ${sessionError.message}`,
        { stack: sessionError.stack, sessionId: session.id, userId: session.user_id },
        session.id,
        session.user_id
      );
      // Optionally, update session status to 'error' or log error to DB via notifications table
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_error',
        title: 'Bot Session Error',
        message: `Error in bot session ${session.id}: ${sessionError.message}`
      });
    }
  }
  await logSystemEvent(supabase, 'INFO', 'RunBotLogic', `Scheduled bot logic execution finished. Processed ${processedCount} active sessions.`);
  return new Response(JSON.stringify({ processed: processedCount }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function fetchHistoricalGoldPrices(apiKey: string, interval: string = '15min', outputsize: string = 'compact'): Promise<any[]> {
  const fetchFn = async () => {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 429 || (response.headers.get("content-type")?.includes("application/json"))) {
        const errorData = await response.json().catch(() => null);
        if (errorData && errorData.Information && errorData.Information.includes("API call frequency")) {
          throw new Error(`Alpha Vantage API rate limit hit (historical data): ${errorData.Information}`);
        }
      }
      throw new Error(`Alpha Vantage historical data API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const timeSeriesKey = `Time Series FX (${interval})`;
    const timeSeries = data[timeSeriesKey];

    if (!timeSeries) {
      console.warn("Alpha Vantage API did not return expected historical data (timeSeries missing or null):", data);
      // Consider if this should throw or return empty array. Throwing will trigger retry.
      // If AV sometimes returns valid empty response for certain requests, this might need adjustment.
      throw new Error("Could not fetch historical gold prices from Alpha Vantage (timeSeries missing or null). Check symbol or API response format.");
    }
    if (Object.keys(timeSeries).length === 0) {
        console.log("Alpha Vantage returned empty timeSeries for historical data. Assuming no data for period.");
        return []; // Valid empty response
    }

    return Object.entries(timeSeries).map(([timestamp, values]: [string, any]) => ({
      timestamp,
      open: parseFloat(values["1. open"]),
      high: parseFloat(values["2. high"]),
      low: parseFloat(values["3. low"]),
      close: parseFloat(values["4. close"]),
    })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  };

  try {
    // Retry up to 2 times (total 3 attempts) with 5s delay for historical data fetching
    return await retryAsyncFunction(fetchFn, 2, 5000, `fetchHistoricalGoldPrices(${interval},${outputsize})`);
  } catch (error) {
    console.error(`All retries failed for fetchHistoricalGoldPrices(${interval},${outputsize}):`, error.message);
    throw error;
  }
}

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const sum = prices.slice(-period).reduce((acc, val) => acc + val, 0);
  return sum / period;
}

interface MarketAnalysisResult {
  shouldTrade: boolean;
  tradeType?: 'BUY' | 'SELL';
  priceAtDecision?: number;
  stopLoss?: number; // Added for dynamic SL
  takeProfit?: number; // Added for dynamic TP
}

// --- Trade Execution Abstraction ---
interface ExecuteOrderParams {
  userId: string;
  tradingAccountId: string;
  symbol: string;
  tradeType: 'BUY' | 'SELL';
  lotSize: number;
  openPrice: number;
  stopLossPrice: number; // Changed from optional to required for the provider
  takeProfitPrice?: number; // Remains optional
  botSessionId?: string;
}

interface ExecuteOrderResult {
  success: boolean;
  tradeId?: string; // Actual ID from trades table or broker
  ticketId?: string;
  error?: string;
}

// --- Enhanced Trade Execution Abstraction ---
// Parameter and Result Types
interface CloseOrderParams {
  ticketId: string; // The ticket ID of the order to close
  lots?: number; // Optional: specific lots to close for partial closure
  price?: number; // Optional: price at which to attempt closure (for limit/stop on close)
  slippage?: number; // Optional
  // userId and tradingAccountId might be needed if the provider needs context
  // or if the trades table isn't solely reliant on ticketId for identification.
}

interface CloseOrderResult {
  success: boolean;
  ticketId: string;
  closePrice?: number;
  profit?: number;
  error?: string;
}

interface AccountSummary {
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  currency: string;
  error?: string;
}

interface OpenPosition {
  ticket: string; // Using string to be consistent with ExecuteOrderResult's ticketId
  symbol: string;
  type: 'BUY' | 'SELL';
  lots: number;
  openPrice: number;
  openTime: string;
  stopLoss?: number;
  takeProfit?: number;
  currentPrice?: number; // Current market price
  profit?: number; // Current floating profit/loss
  swap?: number;
  comment?: string;
}

interface ServerTime {
  time: string; // ISO format ideally, or as provided by broker
  error?: string;
}


// Expanded Interface
interface ITradeExecutionProvider {
  executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult>;
  closeOrder(params: CloseOrderParams): Promise<CloseOrderResult>;
  getAccountSummary(accountId?: string): Promise<AccountSummary>; // accountId for simulated if multiple
  getOpenPositions(accountId?: string): Promise<OpenPosition[]>; // accountId for simulated
  getServerTime(): Promise<ServerTime>;
}

class SimulatedTradeProvider implements ITradeExecutionProvider {
  private supabase: any;
  private apiKey: string;

  constructor(supabaseClient: any, alphaVantageApiKey: string) {
    this.supabase = supabaseClient;
    this.apiKey = alphaVantageApiKey; // Store apiKey for getCurrentGoldPrice
  }

  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const ticketId = generateTicketId();
      const { data: dbTrade, error } = await this.supabase
        .from('trades')
        .insert({
          user_id: params.userId,
          trading_account_id: params.tradingAccountId,
          ticket_id: ticketId,
          symbol: params.symbol,
          trade_type: params.tradeType,
          lot_size: params.lotSize,
          open_price: params.openPrice,
          stop_loss: params.stopLossPrice, // Ensure field name matches DB
          take_profit: params.takeProfitPrice,
          status: 'open',
          bot_session_id: params.botSessionId,
        })
        .select('id')
        .single();

      if (error) {
        console.error('SimulatedTradeProvider: Error inserting trade:', error);
        return { success: false, error: error.message, ticketId };
      }
      if (!dbTrade || !dbTrade.id) {
        return { success: false, error: "SimulatedTradeProvider: Failed to insert trade or retrieve its ID.", ticketId };
      }

      return { success: true, tradeId: dbTrade.id, ticketId };

    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in executeOrder:', e);
      return { success: false, error: e.message };
    }
  }

  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    const { ticketId } = params; // Ignoring lots, price for simple market close simulation
    try {
      const currentPrice = await getCurrentGoldPrice(this.apiKey); // Assumes XAUUSD for now

      // Fetch the trade to get its details
      const { data: tradeToClose, error: fetchError } = await this.supabase
        .from('trades')
        .select('*')
        // .eq('ticket_id', ticketId) // If ticket_id is unique and indexed for lookup
        .eq('id', ticketId) // Assuming ticketId passed is the DB UUID 'id'
        .eq('status', 'open')
        .single();

      if (fetchError) throw new Error(`Error fetching trade to close: ${fetchError.message}`);
      if (!tradeToClose) return { success: false, ticketId, error: "Open trade with specified ID not found." };

      const priceDiff = tradeToClose.trade_type === 'BUY'
        ? currentPrice - tradeToClose.open_price
        : tradeToClose.open_price - currentPrice;
      const profitLoss = priceDiff * tradeToClose.lot_size * 100; // Simplified P&L

      const { error: updateError } = await this.supabase
        .from('trades')
        .update({
          close_price: currentPrice,
          profit_loss: profitLoss,
          status: 'closed',
          close_time: new Date().toISOString(),
        })
        // .eq('ticket_id', ticketId);
        .eq('id', ticketId);


      if (updateError) throw new Error(`Error updating trade to closed: ${updateError.message}`);

      return {
        success: true,
        ticketId,
        closePrice: currentPrice,
        profit: parseFloat(profitLoss.toFixed(2))
      };
    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in closeOrder:', e);
      return { success: false, ticketId, error: e.message };
    }
  }

  async getAccountSummary(_accountId?: string): Promise<AccountSummary> {
    // This is a very basic simulation. A real one might calculate from trades or a balance table.
    // For now, let's assume it fetches from `trading_accounts` if an `accountId` (DB UUID) is provided
    if (_accountId) {
        const {data, error} = await this.supabase
            .from('trading_accounts')
            .select('account_balance, equity, margin, free_margin, currency')
            .eq('id', _accountId)
            .single();
        if (error || !data) {
            console.error("SimulatedTradeProvider: Error fetching account summary from DB", error);
            return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'USD', error: "Account not found or error."};
        }
        return {
            balance: data.account_balance || 0,
            equity: data.equity || 0,
            margin: data.margin || 0,
            freeMargin: data.free_margin || 0,
            currency: data.currency || 'USD'
        };
    }
    // Fallback static data if no accountId
    return { balance: 10000, equity: 10000, margin: 0, freeMargin: 10000, currency: 'USD' };
  }

  async getOpenPositions(accountId?: string): Promise<OpenPosition[]> {
    // Fetches from 'trades' table where status is 'open'
    // If accountId (DB UUID of trading_accounts) is provided, filter by it.
    try {
      let query = this.supabase.from('trades').select('*').eq('status', 'open');
      if (accountId) {
        query = query.eq('trading_account_id', accountId);
      }
      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map(t => ({
        ticket: t.id, // Using DB id as the ticket for consistency here
        symbol: t.symbol,
        type: t.trade_type,
        lots: t.lot_size,
        openPrice: t.open_price,
        openTime: t.created_at, // or open_time if you have it
        stopLoss: t.stop_loss,
        takeProfit: t.take_profit,
        // currentPrice and profit would require fetching live price and calculating
        comment: t.bot_session_id ? `BotSess:${t.bot_session_id}` : ''
      }));
    } catch (e) {
      console.error('SimulatedTradeProvider: Exception in getOpenPositions:', e);
      return [];
    }
  }

  async getServerTime(): Promise<ServerTime> {
    return { time: new Date().toISOString() };
  }
}
} // Added missing brace for MetaTraderBridgeProvider class
// --- End Trade Execution Abstraction ---

// --- MetaTrader Bridge Provider ---
// This class is INTENDED to communicate with an external EA bridge.
// The actual HTTP calls are placeholders and would need to be robustly implemented.
class MetaTraderBridgeProvider implements ITradeExecutionProvider {
  private bridgeUrl: string;
  private bridgeApiKey: string;

  constructor(bridgeUrl: string, bridgeApiKey: string) {
    if (!bridgeUrl || !bridgeApiKey) {
      throw new Error("MetaTraderBridgeProvider: bridgeUrl and bridgeApiKey are required.");
    }
    this.bridgeUrl = bridgeUrl.endsWith('/') ? bridgeUrl.slice(0, -1) : bridgeUrl; // Ensure no trailing slash
    this.bridgeApiKey = bridgeApiKey;
  }

  private async makeRequest(endpoint: string, method: string, body?: any): Promise<any> {
    const headers = {
      'Content-Type': 'application/json',
      'X-MT-Bridge-API-Key': this.bridgeApiKey,
    };
    try {
      const response = await fetch(`${this.bridgeUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Failed to parse error response from bridge" }));
        console.error(`MetaTraderBridgeProvider Error: ${response.status} ${response.statusText}`, errorData);
        throw new Error(`Bridge API Error (${endpoint}): ${response.status} - ${errorData.error || response.statusText}`);
      }
      return await response.json();
    } catch (error) {
      console.error(`MetaTraderBridgeProvider Request Failed (${endpoint}):`, error);
      throw error; // Re-throw to be handled by the caller
    }
  }

  async executeOrder(params: ExecuteOrderParams): Promise<ExecuteOrderResult> {
    try {
      const requestBody = {
        symbol: params.symbol,
        type: params.tradeType,
        lots: params.lotSize,
        price: params.openPrice, // For market order, price might be ignored by EA, or used for deviation checks
        stopLossPrice: params.stopLossPrice,
        takeProfitPrice: params.takeProfitPrice,
        magicNumber: params.botSessionId ? parseInt(params.botSessionId.replace(/\D/g,'').slice(-7)) || 0 : 0, // Example: extract numbers from session ID
        comment: `BotTrade_Sess${params.botSessionId || 'N/A'}`,
      };

      // Assuming the API contract defined: POST /order/execute
      const responseData = await this.makeRequest('/order/execute', 'POST', requestBody);

      if (responseData.success && responseData.ticket) {
        return {
          success: true,
          tradeId: responseData.ticket.toString(), // Assuming ticket is the primary ID from MT
          ticketId: responseData.ticket.toString()
        };
      } else {
        return { success: false, error: responseData.error || "Failed to execute order via bridge." };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  // Implement other ITradeExecutionProvider methods (getAccountSummary, etc.) here,
  // each calling their respective endpoints on the EA bridge.
  async closeOrder(params: CloseOrderParams): Promise<CloseOrderResult> {
    try {
      // Assuming API contract: POST /order/close
      const responseData = await this.makeRequest('/order/close', 'POST', {
        ticket: parseInt(params.ticketId), // EA bridge likely expects integer ticket
        lots: params.lots,
        // price: params.price, // If EA supports closing at a specific price
        // slippage: params.slippage,
      });
      if (responseData.success) {
        return {
          success: true,
          ticketId: params.ticketId,
          closePrice: responseData.closePrice,
          profit: responseData.profit
        };
      } else {
        return { success: false, ticketId: params.ticketId, error: responseData.error || "Failed to close order via bridge." };
      }
    } catch (error) {
      return { success: false, ticketId: params.ticketId, error: error.message };
    }
  }

  async getAccountSummary(): Promise<AccountSummary> {
    try {
      // Assuming API contract: GET /account/summary
      const data = await this.makeRequest('/account/summary', 'GET');
      return {
        balance: data.balance,
        equity: data.equity,
        margin: data.margin,
        freeMargin: data.freeMargin,
        currency: data.currency,
      };
    } catch (error) {
      return { balance: 0, equity: 0, margin: 0, freeMargin: 0, currency: 'N/A', error: error.message };
    }
  }

  async getOpenPositions(): Promise<OpenPosition[]> {
     try {
      // Assuming API contract: GET /positions/open
      const data = await this.makeRequest('/positions/open', 'GET');
      return (data.positions || []).map((p: any) => ({ // Map to OpenPosition interface
          ticket: p.ticket.toString(),
          symbol: p.symbol,
          type: p.type,
          lots: p.lots,
          openPrice: p.openPrice,
          openTime: p.openTime,
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
          currentPrice: p.currentPrice,
          profit: p.profit,
          swap: p.swap,
          comment: p.comment,
      }));
    } catch (error) {
      console.error('MetaTraderBridgeProvider: Error fetching open positions:', error);
      return [];
    }
  }

  async getServerTime(): Promise<ServerTime> {
    try {
      // Assuming API contract: GET /server/time
      const data = await this.makeRequest('/server/time', 'GET');
      return { time: data.serverTime };
    } catch (error) {
      return { time: '', error: error.message };
    }
  }
}
// --- End MetaTrader Bridge Provider ---


// --- SMA Crossover Strategy Logic ---
interface SMACrossoverSettings {
  smaShortPeriod?: number;
  smaLongPeriod?: number;
  atrPeriod?: number;
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;
}

function analyzeSMACrossoverStrategy(
  relevantHistoricalData: any[], // Data up to (but not including) the decision candle
  decisionPrice: number,         // Typically open of the decision candle
  settings: SMACrossoverSettings,
  currentAtrValue: number | null
): MarketAnalysisResult {
  const {
    smaShortPeriod = 20,
    smaLongPeriod = 50,
    atrMultiplierSL = 1.5,
    atrMultiplierTP = 3,
  } = settings;

  if (relevantHistoricalData.length < smaLongPeriod || currentAtrValue === null) {
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  const closePrices = relevantHistoricalData.map(p => p.close_price || p.close);

  const smaShort = calculateSMA(closePrices, smaShortPeriod)[relevantHistoricalData.length -1];
  const smaLong = calculateSMA(closePrices, smaLongPeriod)[relevantHistoricalData.length -1];

  const prevClosePrices = closePrices.slice(0, -1);
  const smaShortPrev = calculateSMA(prevClosePrices, smaShortPeriod)[prevClosePrices.length -1];
  const smaLongPrev = calculateSMA(prevClosePrices, smaLongPeriod)[prevClosePrices.length -1];

  if (smaShort === null || smaLong === null || smaShortPrev === null || smaLongPrev === null) {
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  let tradeType: 'BUY' | 'SELL' | undefined = undefined;
  if (smaShortPrev <= smaLongPrev && smaShort > smaLong) {
    tradeType = 'BUY';
  } else if (smaShortPrev >= smaLongPrev && smaShort < smaLong) {
    tradeType = 'SELL';
  }

  if (tradeType) {
    const stopLoss = tradeType === 'BUY'
      ? decisionPrice - (currentAtrValue * atrMultiplierSL)
      : decisionPrice + (currentAtrValue * atrMultiplierSL);
    const takeProfit = tradeType === 'BUY'
      ? decisionPrice + (currentAtrValue * atrMultiplierTP)
      : decisionPrice - (currentAtrValue * atrMultiplierTP);

    return {
      shouldTrade: true,
      tradeType: tradeType,
      priceAtDecision: decisionPrice,
      stopLoss: parseFloat(stopLoss.toFixed(4)),
      takeProfit: parseFloat(takeProfit.toFixed(4)),
    };
  }
  return { shouldTrade: false, priceAtDecision: decisionPrice };
}
// --- End SMA Crossover Strategy Logic ---

// --- Breakout Strategy Logic ---
interface BreakoutSettings {
  breakoutLookbackPeriod?: number;
  // atrPeriod is global from sessionSettings
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;
  minChannelWidthATR?: number; // Minimum channel width in ATR multiples
  // breakoutConfirmationATRMultiplier?: number; // Optional: For volatility confirmation
}

function analyzeBreakoutStrategy(
  relevantHistoricalData: Array<{high_price: number, low_price: number, close_price: number, open_price: number}>, // Data up to signal candle
  decisionPrice: number, // Open of the decision candle (candle after signal/breakout)
  settings: BreakoutSettings,
  currentAtrValue: number | null // ATR at the signal candle
): MarketAnalysisResult {
  const {
    breakoutLookbackPeriod = 50,
    atrMultiplierSL = 1.5,
    atrMultiplierTP = 3.0,
    minChannelWidthATR = 1.0, // Example: channel must be at least 1 ATR wide
  } = settings;

  if (relevantHistoricalData.length < breakoutLookbackPeriod + 1 || currentAtrValue === null || currentAtrValue === 0) {
    // Need +1 because the breakout happens on the *last* candle of the lookback period,
    // and we make decision on the *next* candle.
    // console.log("Breakout: Not enough data or ATR is null/zero.");
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  // The signal candle is the last candle in relevantHistoricalData
  const signalCandleIndex = relevantHistoricalData.length - 1;
  const signalCandle = relevantHistoricalData[signalCandleIndex];

  // Define the channel based on data *before* the signal candle
  const lookbackDataForChannel = relevantHistoricalData.slice(Math.max(0, signalCandleIndex - breakoutLookbackPeriod), signalCandleIndex);

  if (lookbackDataForChannel.length < breakoutLookbackPeriod) {
    // console.log("Breakout: Not enough data for channel definition.");
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  for (const candle of lookbackDataForChannel) {
    if (candle.high_price > highestHigh) highestHigh = candle.high_price;
    if (candle.low_price < lowestLow) lowestLow = candle.low_price;
  }

  if (highestHigh === -Infinity || lowestLow === Infinity) {
    // console.log("Breakout: Could not determine channel bounds.");
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  const channelWidth = highestHigh - lowestLow;
  if (channelWidth < (minChannelWidthATR * currentAtrValue)) {
    // console.log(`Breakout: Channel width ${channelWidth.toFixed(4)} too narrow (min: ${(minChannelWidthATR * currentAtrValue).toFixed(4)}, ATR: ${currentAtrValue.toFixed(4)}).`);
    return { shouldTrade: false, priceAtDecision: decisionPrice };
  }

  let tradeType: 'BUY' | 'SELL' | undefined = undefined;

  // Buy Breakout: Signal candle closes above the channel's highest high
  if (signalCandle.close_price > highestHigh) {
    tradeType = 'BUY';
    // console.log(`Breakout BUY signal: Close ${signalCandle.close_price.toFixed(4)} > High ${highestHigh.toFixed(4)}`);
  }
  // Sell Breakout: Signal candle closes below the channel's lowest low
  else if (signalCandle.close_price < lowestLow) {
    tradeType = 'SELL';
    // console.log(`Breakout SELL signal: Close ${signalCandle.close_price.toFixed(4)} < Low ${lowestLow.toFixed(4)}`);
  }

  if (tradeType) {
    const stopLoss = tradeType === 'BUY'
      ? lowestLow - (currentAtrValue * 0.5) // SL below the recent low (or breakout point - ATR)
      // ? highestHigh - (currentAtrValue * atrMultiplierSL) // Alt: SL based on breakout point
      : highestHigh + (currentAtrValue * 0.5); // SL above the recent high
      // : lowestLow + (currentAtrValue * atrMultiplierSL); // Alt: SL based on breakout point

    const takeProfit = tradeType === 'BUY'
      ? decisionPrice + ((decisionPrice - stopLoss) * atrMultiplierTP) // TP as multiple of SL distance
      : decisionPrice - ((stopLoss - decisionPrice) * atrMultiplierTP);

    return {
      shouldTrade: true,
      tradeType: tradeType,
      priceAtDecision: decisionPrice,
      stopLoss: parseFloat(stopLoss.toFixed(4)),
      takeProfit: parseFloat(takeProfit.toFixed(4)),
    };
  }

  return { shouldTrade: false, priceAtDecision: decisionPrice };
}
// --- End Breakout Strategy Logic ---

// --- Market Regime Detection ---
type MarketRegime = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'BREAKOUT_SETUP_UP' | 'BREAKOUT_SETUP_DOWN' | 'UNCLEAR';

interface RegimeDetectionSettings {
  adxPeriod?: number;
  adxTrendThreshold?: number; // ADX value above which market is considered trending
  adxRangeThreshold?: number; // ADX value below which market is considered ranging
  bbPeriod?: number;          // For Bollinger Band Width
  bbStdDevMult?: number;      // For Bollinger Band Width
  // atrPeriod?: number;      // For volatility context (already in global params)
  // emaShortPeriod?: number; // Optional for trend direction confirmation
  // emaLongPeriod?: number;  // Optional
}

// Calculates Bollinger Band Width
function calculateBollingerBandWidth(
  bbValues: Array<{middle: number | null, upper: number | null, lower: number | null}>
): (number | null)[] {
  return bbValues.map(bb => {
    if (bb.upper !== null && bb.lower !== null && bb.middle !== null && bb.middle !== 0) {
      return (bb.upper - bb.lower) / bb.middle;
    }
    return null;
  });
}


function detectMarketRegime(
  ohlcDataForRegime: Array<{high_price: number, low_price: number, close_price: number}>, // Data up to the point of regime detection
  settings: RegimeDetectionSettings,
  currentAtrValue?: number | null // Optional: For context, though not directly used in this simplified version yet
): MarketRegime {
  const {
    adxPeriod = 14,
    adxTrendThreshold = 25,
    adxRangeThreshold = 20,
    bbPeriod = 20, // Default for BBW
    bbStdDevMult = 2 // Default for BBW
  } = settings;

  if (ohlcDataForRegime.length < Math.max(adxPeriod + adxPeriod -1, bbPeriod)) { // ADX needs more data
    // console.warn("Regime Detection: Not enough data.");
    return 'UNCLEAR';
  }

  const adxResult = calculateADX(ohlcDataForRegime, adxPeriod);
  const currentADX = adxResult.adx[ohlcDataForRegime.length - 1];
  const currentPDI = adxResult.pdi[ohlcDataForRegime.length - 1];
  const currentNDI = adxResult.ndi[ohlcDataForRegime.length - 1];

  const bbValues = calculateBollingerBands(ohlcDataForRegime, bbPeriod, bbStdDevMult);
  const bbWidthValues = calculateBollingerBandWidth(bbValues);
  const currentBBW = bbWidthValues[ohlcDataForRegime.length - 1];

  // For breakout setup, look at average BBW over a short period vs current
  const shortLookback = Math.min(10, ohlcDataForRegime.length -1);
  const recentBBWs = bbWidthValues.slice(-shortLookback).filter(w => w !== null) as number[];
  const avgRecentBBW = recentBBWs.length > 0 ? recentBBWs.reduce((a,b) => a+b, 0) / recentBBWs.length : null;


  if (currentADX === null || currentPDI === null || currentNDI === null || currentBBW === null) {
    // console.warn("Regime Detection: Indicator values are null.");
    return 'UNCLEAR';
  }

  // Regime Logic (can be expanded)
  if (currentADX > adxTrendThreshold) {
    if (currentPDI > currentNDI) return 'TRENDING_UP';
    if (currentNDI > currentPDI) return 'TRENDING_DOWN';
  }

  if (currentADX < adxRangeThreshold) {
     // Check for breakout setup: low ADX and very narrow BBW
    if (avgRecentBBW !== null && currentBBW < avgRecentBBW * 0.6 && currentBBW < 0.05) { // Example: BBW is 60% of recent avg AND very tight absolutely
        // Determine potential breakout direction by recent price action or very short term MA
        const lastFewCloses = ohlcDataForRegime.slice(-5).map(c => c.close_price);
        if (lastFewCloses.length >= 2) {
            if (lastFewCloses[lastFewCloses.length-1] > lastFewCloses[0]) return 'BREAKOUT_SETUP_UP';
            return 'BREAKOUT_SETUP_DOWN';
        }
    }
    return 'RANGING';
  }

  // Could add more rules here for VOLATILE_UNCLEAR based on ATR vs BBW etc.
  return 'UNCLEAR';
}
// --- End Market Regime Detection ---


// Refactored: Main Market Analysis Dispatcher
async function analyzeMarketConditions(
  apiKey: string,
  sessionSettings: { // Now expects a more comprehensive settings object
    strategySelectionMode?: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY' | 'ADX_TREND_FOLLOW'; // Added BREAKOUT_ONLY
    // SMA Crossover + ATR settings (can be nested or flat)
    smaShortPeriod?: number;
    smaLongPeriod?: number;
    // Mean Reversion (BB+RSI) + ATR settings
    bbPeriod?: number;
    bbStdDevMult?: number;
    rsiPeriod?: number;
    rsiOversold?: number;
    rsiOverbought?: number;
    // ADX settings (for regime and ADX Trend Follow strategy)
    adxPeriod?: number;
    adxTrendMinLevel?: number; // For ADX Trend Follow
    adxRangeThreshold?: number; // For ADAPTIVE regime
    adxTrendThreshold?: number; // For ADAPTIVE regime
    // General ATR settings (can be overridden by strategy-specific ones if defined)
    atrPeriod?: number;
    atrMultiplierSL?: number;
    atrMultiplierTP?: number;
    // Breakout strategy specific settings
    breakoutLookbackPeriod?: number;
    minChannelWidthATR?: number;
    // breakoutConfirmationATRMultiplier?: number; // If we add this later
  },
  ohlcDataForAnalysis?: any[],
  currentIndexForDecision?: number
): Promise<MarketAnalysisResult> {
  try {
    // Consolidate and default all parameters
    const params = {
        strategySelectionMode: sessionSettings.strategySelectionMode || 'ADAPTIVE',
        // SMA
        smaShortPeriod: sessionSettings.smaShortPeriod || 20,
        smaLongPeriod: sessionSettings.smaLongPeriod || 50,
        // Mean Reversion (BB + RSI)
        bbPeriod: sessionSettings.bbPeriod || 20,
        bbStdDevMult: sessionSettings.bbStdDevMult || 2,
        rsiPeriod: sessionSettings.rsiPeriod || 14,
        rsiOversold: sessionSettings.rsiOversold || 30,
        rsiOverbought: sessionSettings.rsiOverbought || 70,
        // ADX (for ADAPTIVE and potential ADX-filtered strategies)
        adxPeriod: sessionSettings.adxPeriod || 14,
        adxTrendMinLevel: sessionSettings.adxTrendMinLevel || 25, // Used by ADX trend filter if any
        adxRangeThreshold: sessionSettings.adxRangeThreshold || 20, // For ADAPTIVE
        adxTrendThreshold: sessionSettings.adxTrendThreshold || 25, // For ADAPTIVE
        // Breakout
        breakoutLookbackPeriod: sessionSettings.breakoutLookbackPeriod || 50,
        minChannelWidthATR: sessionSettings.minChannelWidthATR || 1.0,
        // Global ATR (used by all strategies for SL/TP)
        atrPeriod: sessionSettings.atrPeriod || 14,
        atrMultiplierSL: sessionSettings.atrMultiplierSL || 1.5,
        atrMultiplierTP: sessionSettings.atrMultiplierTP || 3.0, // Corrected: sessionSettings instead of session.strategy_settings
    };


    let decisionPrice: number;
    let dataForIndicators: any[]; // This will hold data up to signal candle (currentIndex-1 or latest-1)
    let currentCandleOpen: number; // Open price of the candle where action is taken

    if (ohlcDataForAnalysis && currentIndexForDecision !== undefined && currentIndexForDecision >= 0) {
      // --- Backtesting Mode ---
      if (currentIndexForDecision === 0) return { shouldTrade: false }; // Not enough data

      dataForIndicators = ohlcDataForAnalysis.slice(0, currentIndexForDecision); // Data up to (but not including) current decision candle
      currentCandleOpen = ohlcDataForAnalysis[currentIndexForDecision].open_price;
      decisionPrice = currentCandleOpen; // Decision to enter is at the open of currentIndexForDecision candle

      // Ensure enough data for the longest lookback period of any indicator
      const minRequiredLength = Math.max(params.smaLongPeriod, params.atrPeriod + 1, params.bbPeriod, params.rsiPeriod, params.adxPeriod + params.adxPeriod -1); // ADX needs more data due to smoothing of DX
      if (dataForIndicators.length < minRequiredLength) {
        // console.warn(`Backtest: Not enough data for indicators at index ${currentIndexForDecision}. Have ${dataForIndicators.length}, need ~${minRequiredLength}`);
        return { shouldTrade: false, priceAtDecision: decisionPrice };
      }

    } else {
      // --- Live Trading Mode ---
      // Fetch a bit more data than just 'compact' (100) if ADX period is long, to ensure smoothing works.
      // Max of ADX (e.g., 14*2 = 28), BB (e.g. 20), SMA (e.g. 50)
      const lookbackNeeded = Math.max(params.smaLongPeriod, params.bbPeriod, params.adxPeriod * 2, params.rsiPeriod, params.atrPeriod) + 5; // Add a small buffer
      const outputsize = lookbackNeeded > 100 ? 'full' : 'compact'; // 'full' can be very large

      dataForIndicators = await fetchHistoricalGoldPrices(apiKey, '15min', outputsize); // Using 15min as default timeframe for live logic
      decisionPrice = await getCurrentGoldPrice(apiKey); // This is the most recent tick price for decision
      currentCandleOpen = decisionPrice; // In live mode, decision and action are based on latest price

      const minRequiredLengthLive = Math.max(params.smaLongPeriod, params.atrPeriod + 1, params.bbPeriod, params.rsiPeriod, params.adxPeriod + params.adxPeriod -1 );
      if (dataForIndicators.length < minRequiredLengthLive) {
         console.warn(`Live: Not enough historical data from fetch for indicators. Have ${dataForIndicators.length}, need ~${minRequiredLengthLive}`);
        return { shouldTrade: false, priceAtDecision: decisionPrice };
      }
    }

    // Calculate common indicators needed by dispatcher or strategies
    const atrValues = calculateATR(dataForIndicators, params.atrPeriod);
    const currentAtr = atrValues[dataForIndicators.length - 1];

    if (currentAtr === null) {
        // console.warn("ATR is null, cannot proceed with strategy analysis.");
        return { shouldTrade: false, priceAtDecision: decisionPrice };
    }

    // --- Strategy Dispatch Logic ---
    if (params.strategySelectionMode === 'SMA_ONLY') {
      if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("Dispatching to SMA Only Strategy (Live)");
      return analyzeSMACrossoverStrategy(dataForIndicators, decisionPrice, params, currentAtr);
    }
    else if (params.strategySelectionMode === 'MEAN_REVERSION_ONLY') {
      if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("Dispatching to Mean Reversion Strategy (Live)");
       const meanReversionSettings: MeanReversionSettings = {
            bbPeriod: params.bbPeriod,
            bbStdDevMult: params.bbStdDevMult,
            rsiPeriod: params.rsiPeriod,
            rsiOversold: params.rsiOversold,
            rsiOverbought: params.rsiOverbought,
            atrMultiplierSL: params.atrMultiplierSL,
            atrMultiplierTP: params.atrMultiplierTP,
        };
      // For mean reversion, currentIndexForDecision is relative to the *full ohlcDataForAnalysis* if in backtest.
      // But dataSliceForIndicators was already prepared for it.
      // The 'currentIndexForDecision' passed to analyzeMeanReversionStrategy should be dataForIndicators.length
      // as it expects to look at dataForIndicators[dataForIndicators.length-1] as the signal candle.
      // And the actual decision price is currentCandleOpen (from the *next* candle in backtest)
      // This requires careful indexing for analyzeMeanReversionStrategy if it's to use the same `currentIndexForDecision` logic as SMA.
      // Let's adjust `analyzeMeanReversionStrategy` to also receive `relevantHistoricalData` and `decisionPrice`
      // For now, we'll pass the `currentIndexForDecision` that corresponds to the candle *after* the signal candle in the `dataForIndicators` context.
      // This means the `analyzeMeanReversionStrategy` uses `currentIndexForDecision - 1` from its input `ohlcDataForAnalysis` for signal.
      // This is consistent if `dataForIndicators` is passed as its `ohlcDataForAnalysis` and `dataForIndicators.length` as `currentIndexForDecision`.
      // However, `analyzeMeanReversionStrategy` expects the *full* ohlcDataForAnalysis and currentIndexForDecision to slice itself.
      // Let's keep it simple for now: it will use the last data point of dataForIndicators for its signals, and decisionPrice is the next open.

      // If in backtesting mode, the `analyzeMeanReversionStrategy` expects `ohlcDataForAnalysis` and `currentIndexForDecision`
      // where `currentIndexForDecision` is the candle on which action is taken.
      // It internally looks at `signalCandleIndex = currentIndexForDecision - 1`.
      // So, we pass the original `ohlcDataForAnalysis` and `currentIndexForDecision` if in backtest mode.
      // If in live mode, `dataForIndicators` is the historical set, and `decisionPrice` is the live price.
      // `analyzeMeanReversionStrategy` needs to be aware of this.
      // For simplicity, let's assume analyzeMeanReversionStrategy will use the last point of its input data for signal,
      // and a separate decisionPrice.

      // This part needs careful alignment of indexing between backtest and live for Mean Reversion.
      // Let's assume for now that for live mode, analyzeMeanReversionStrategy uses the latest from `dataForIndicators`
      // and `decisionPrice` is the current live price.
      // For backtest mode, it receives `ohlcDataForAnalysis` and `currentIndexForDecision`.

      // The `analyzeMeanReversionStrategy` is already designed to take `ohlcDataForAnalysis` and `currentIndexForDecision`
      // where `currentIndexForDecision` is the candle whose open is the `decisionPrice`.
      // So, for live mode, we'd pass `dataForIndicators` and conceptually `dataForIndicators.length` as `currentIndexForDecision`.
      // And `decisionPrice` would be the external live price.
      // This is getting complex. Let's simplify: the strategy functions will always get data up to the point *before* decision.
      // The `decisionPrice` is then the open of the *next* candle (or current live price).

        const meanReversionSettings: MeanReversionSettings = {
            bbPeriod: params.bbPeriod, bbStdDevMult: params.bbStdDevMult,
            rsiPeriod: params.rsiPeriod, rsiOversold: params.rsiOversold, rsiOverbought: params.rsiOverbought,
            atrMultiplierSL: params.atrMultiplierSL, atrMultiplierTP: params.atrMultiplierTP // Pass global ATR SL/TP
        };

        // In backtest mode, dataForIndicators is ohlcData.slice(0, currentIndexForDecision)
        // The actual decision candle is ohlcData[currentIndexForDecision]
        // analyzeMeanReversionStrategy will use signalCandleIndex = (its_currentIndexForDecision) - 1
        // So, if we pass `dataForIndicators` as its ohlc, and `dataForIndicators.length` as its currentIndex,
        // then signalCandleIndex becomes `dataForIndicators.length - 1`.
        // This is correct: it uses the last candle of `dataForIndicators` as the signal candle.
        // The `decisionPrice` is then `currentCandleOpen` (backtest) or live `decisionPrice`.

        // Simpler: each strategy function gets `dataForSignalCandleAndEarlier` and `decisionPrice`.
        return analyzeMeanReversionStrategy(dataForIndicators, dataForIndicators.length, meanReversionSettings, currentAtr);

    }
    else if (params.strategySelectionMode === 'ADAPTIVE') {
      if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("Dispatching via ADAPTIVE Strategy (Live)");
      const adxSeries = calculateADX(dataForIndicators, params.adxPeriod);
      const currentADX = adxSeries.adx[dataForIndicators.length - 1];

      if (currentADX === null) return { shouldTrade: false, priceAtDecision: decisionPrice };

      console.log(`ADAPTIVE mode: ADX(${params.adxPeriod}) = ${currentADX.toFixed(2)}`);

      if (currentADX > params.adxTrendThreshold) {
        console.log("ADAPTIVE: Detected TRENDING market. Using SMA Crossover.");
        return analyzeSMACrossoverStrategy(dataForIndicators, decisionPrice, params, currentAtr);
      } else if (currentADX < params.adxRangeThreshold) {
        console.log("ADAPTIVE: Detected RANGING market. Using Mean Reversion.");
         const meanReversionSettings: MeanReversionSettings = {
            bbPeriod: params.bbPeriod, bbStdDevMult: params.bbStdDevMult,
            rsiPeriod: params.rsiPeriod, rsiOversold: params.rsiOversold, rsiOverbought: params.rsiOverbought,
            atrMultiplierSL: params.atrMultiplierSL, atrMultiplierTP: params.atrMultiplierTP
        };
        return analyzeMeanReversionStrategy(dataForIndicators, dataForIndicators.length, meanReversionSettings, currentAtr);
      } else {
        console.log("ADAPTIVE: Market regime UNCLEAR (ADX between thresholds). No trade.");
        return { shouldTrade: false, priceAtDecision: decisionPrice };
      }
    }
    else if (params.strategySelectionMode === 'BREAKOUT_ONLY') {
      if (!(ohlcDataForAnalysis && currentIndexForDecision !== undefined)) console.log("Dispatching to Breakout Strategy (Live)");
      const breakoutSettings: BreakoutSettings = {
        breakoutLookbackPeriod: params.breakoutLookbackPeriod,
        atrMultiplierSL: params.atrMultiplierSL,
        atrMultiplierTP: params.atrMultiplierTP,
        minChannelWidthATR: params.minChannelWidthATR,
      };
      return analyzeBreakoutStrategy(dataForIndicators, decisionPrice, breakoutSettings, currentAtr);
    }


    // Default or if mode not recognized, perhaps SMA Crossover or no trade
    console.warn(`Unknown or default strategy selection mode: ${params.strategySelectionMode}. Defaulting to no trade.`);
    return { shouldTrade: false, priceAtDecision: decisionPrice };

  } catch (error) {
    console.error("Error during market analysis dispatcher:", error.message, error.stack);
    // supabaseClient is not directly available here. This log needs to be done by the caller of analyzeMarketConditions
    // if it has access to supabaseClient. For now, the console.error is the primary record.
    // If called from processBotSession, processBotSession can log it.
    // If called from runBacktestAction, runBacktestAction can log it.
    return { shouldTrade: false }; // Default to no trade on error
  }
}


async function processBotSession(supabase: any, session: any, apiKey: string) {
  console.log(`Processing bot session ${session.id} for user ${session.user_id} (Live Mode)`);

  // Get the trade provider, potentially fetching and decrypting credentials if it were METATRADER
  // and if MetaTraderBridgeProvider was refactored to use them.
  // The trading_account_id from the session is crucial here.
  const tradeProvider: ITradeExecutionProvider = await getTradeProvider(
    supabase,
    apiKey, // For SimulatedTradeProvider's internal price fetching if needed
    session.trading_account_id
  );

  // If getTradeProvider throws an error (e.g., cannot decrypt password, account not found),
  // it will be caught by the runBotLogic's try/catch for the session.

  // --- Max Drawdown Control Logic ---
  // Default max drawdown if not specified in strategy_params or session table column
  // Ensure fullStrategyParams is defined before this block if it's going to be used for max_drawdown_percent
  const maxDrawdownPercent = fullStrategyParams.max_drawdown_percent || // Prioritize from strategy_params
                           session.max_drawdown_percent || // Fallback to potential direct column
                           0.10; // Default 10%

  const accountSummary = await tradeProvider.getAccountSummary(session.trading_account_id);
  if (!accountSummary || accountSummary.error || accountSummary.equity <= 0) {
    const errorMsg = `Max Drawdown Check: Could not get valid account equity for session ${session.id}. Error: ${accountSummary?.error || 'Equity is zero or negative'}. Skipping drawdown check.`;
    console.error(errorMsg);
    await logSystemEvent(supabase, 'WARN', 'ProcessBotSession', errorMsg, { session_id: session.id, user_id: session.user_id });
    // Decide if we should proceed or halt session processing here. For now, let's proceed but this is a risk.
  } else {
    let currentSessionInitialEquity = session.session_initial_equity;
    let currentSessionPeakEquity = session.session_peak_equity;

    if (currentSessionInitialEquity === null || currentSessionInitialEquity === undefined) {
      currentSessionInitialEquity = accountSummary.equity;
      currentSessionPeakEquity = accountSummary.equity;
      const { error: updateError } = await supabase
        .from('bot_sessions')
        .update({
            session_initial_equity: currentSessionInitialEquity,
            session_peak_equity: currentSessionPeakEquity
        })
        .eq('id', session.id);
      if (updateError) {
        console.error(`Failed to update initial/peak equity for session ${session.id}:`, updateError);
        await logSystemEvent(supabase, 'ERROR', 'ProcessBotSession', `Failed to update initial/peak equity for session ${session.id}`, { error: updateError.message, stack: updateError.stack }, session.id, session.user_id);
        // Continue, but drawdown might not be accurate for this run
      }
      console.log(`Session ${session.id}: Initialized session_initial_equity and session_peak_equity to ${accountSummary.equity}`);
    } else {
      // Update peak equity if current equity is higher
      if (accountSummary.equity > (currentSessionPeakEquity || 0)) {
        currentSessionPeakEquity = accountSummary.equity;
        const { error: updatePeakError } = await supabase
          .from('bot_sessions')
          .update({ session_peak_equity: currentSessionPeakEquity })
          .eq('id', session.id);
        if (updatePeakError) {
            console.error(`Failed to update peak equity for session ${session.id}:`, updatePeakError);
            await logSystemEvent(supabase, 'ERROR', 'ProcessBotSession', `Failed to update peak equity for session ${session.id}`, { error: updatePeakError.message, stack: updatePeakError.stack }, session.id, session.user_id);
        } else {
            console.log(`Session ${session.id}: Updated session_peak_equity to ${currentSessionPeakEquity}`);
        }
      }
    }

    // Perform drawdown check using the most up-to-date peak equity
    const peakEquityForCalc = currentSessionPeakEquity || currentSessionInitialEquity || accountSummary.equity;
    if (peakEquityForCalc > 0) { // Ensure peak equity is positive to avoid division by zero or incorrect calcs
        const drawdown = (peakEquityForCalc - accountSummary.equity) / peakEquityForCalc;
        console.log(`Session ${session.id}: Current Equity: ${accountSummary.equity}, Peak Equity: ${peakEquityForCalc}, Drawdown: ${(drawdown * 100).toFixed(2)}%, Max DD Allowed: ${(maxDrawdownPercent * 100).toFixed(2)}%`);

        if (drawdown >= maxDrawdownPercent) {
          const drawdownMsg = `Session ${session.id} breached max drawdown limit of ${(maxDrawdownPercent * 100).toFixed(2)}%. Current drawdown: ${(drawdown * 100).toFixed(2)}%. Pausing session.`;
          console.warn(drawdownMsg);
          await logSystemEvent(supabase, 'WARN', 'ProcessBotSession', drawdownMsg, { session_id: session.id, user_id: session.user_id, current_equity: accountSummary.equity, peak_equity: peakEquityForCalc, drawdown_percent: drawdown });

          await supabase.from('notifications').insert({
            user_id: session.user_id,
            type: 'bot_alert',
            title: 'Bot Session Paused - Max Drawdown',
            message: `Bot session ${session.id.substring(0,8)}... for account ${session.trading_account_id.substring(0,8)}... has been paused due to reaching the maximum drawdown limit.`
          });

          const recipientEmail = Deno.env.get('NOTIFICATION_EMAIL_RECIPIENT');
          if (recipientEmail) {
            sendEmail(recipientEmail, `[Trading Bot Alert] Session ${session.id} Paused - Max Drawdown`, drawdownMsg);
          }

          await supabase.from('bot_sessions').update({ status: 'paused_drawdown', session_end: new Date().toISOString() }).eq('id', session.id);
          return; // Stop further processing for this session
        }
    }
  }
  // --- End Max Drawdown Control ---


  const riskSettingsMap = {
    conservative: { maxLotSize: 0.01, stopLossPips: 200 },
    medium: { maxLotSize: 0.05, stopLossPips: 300 },
    risky: { maxLotSize: 0.10, stopLossPips: 500 }
  };

  const settings = riskSettingsMap[session.risk_level] || riskSettingsMap.conservative;

  const { data: openTrades, error: openTradesError } = await supabase
    .from('trades')
    .select('id')
    .eq('user_id', session.user_id)
    .eq('trading_account_id', session.trading_account_id)
    .eq('status', 'open')
    .eq('bot_session_id', session.id); // Ensure we only check trades for *this* bot session

  if (openTradesError) {
    console.error(`Error fetching open trades for session ${session.id}:`, openTradesError);
    // Depending on error severity, might decide to skip or throw
    return;
  }

  if (openTrades && openTrades.length > 0) {
    console.log(`Session ${session.id} for user ${session.user_id} already has ${openTrades.length} open trade(s). Skipping new trade.`);
    return;
  }

  // Call analyzeMarketConditions without backtesting parameters for live mode
  // Pass strategy settings from the session, or use defaults
  // Consolidate all strategy parameters from session.strategy_params, providing defaults
  const fullStrategyParams = {
    strategySelectionMode: session.strategy_selection_mode || 'ADAPTIVE',
    smaShortPeriod: session.strategy_params?.smaShortPeriod || 20,
    smaLongPeriod: session.strategy_params?.smaLongPeriod || 50,
    bbPeriod: session.strategy_params?.bbPeriod || 20,
    bbStdDevMult: session.strategy_params?.bbStdDevMult || 2,
    rsiPeriod: session.strategy_params?.rsiPeriod || 14,
    rsiOversold: session.strategy_params?.rsiOversold || 30,
    rsiOverbought: session.strategy_params?.rsiOverbought || 70,
    adxPeriod: session.strategy_params?.adxPeriod || 14,
    adxTrendMinLevel: session.strategy_params?.adxTrendMinLevel || 25,
    adxRangeThreshold: session.strategy_params?.adxRangeThreshold || 20,
    adxTrendThreshold: session.strategy_params?.adxTrendThreshold || 25,
    breakoutLookbackPeriod: session.strategy_params?.breakoutLookbackPeriod || 50,
    minChannelWidthATR: session.strategy_params?.minChannelWidthATR || 1.0,
    atrPeriod: session.strategy_params?.atrPeriod || 14,
    atrMultiplierSL: session.strategy_params?.atrMultiplierSL || 1.5,
    atrMultiplierTP: session.strategy_params?.atrMultiplierTP || 3.0,
    risk_per_trade_percent: session.strategy_params?.risk_per_trade_percent || 0.01, // Default 1% risk
  };

  const analysisResult = await analyzeMarketConditions(apiKey, fullStrategyParams);

  if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision) {
    const tradeType = analysisResult.tradeType;
    const openPrice = analysisResult.priceAtDecision;

    // Use SL from analysisResult if available (now ATR-based)
    const stopLossPrice = analysisResult.stopLoss;
    const takeProfitPrice = analysisResult.takeProfit; // Optional

    if (!stopLossPrice) {
        console.error(`Session ${session.id}: No stopLossPrice provided by analysisResult. Skipping trade.`);
        return;
    }

    // --- Dynamic Lot Sizing Calculation ---
    let lotSize = settings.maxLotSize; // Fallback to existing maxLotSize from risk_level
    const riskPerTradePercent = fullStrategyParams.risk_per_trade_percent; // e.g., 0.01 for 1%

    try {
      const accountSummary = await tradeProvider.getAccountSummary(session.trading_account_id);
      if (accountSummary && accountSummary.equity > 0) {
        const accountEquity = accountSummary.equity;
        const stopLossDistancePrice = Math.abs(openPrice - stopLossPrice);

        // Define value per full price point movement for 1 lot of XAUUSD.
        // Assuming 1 lot = 100 oz, $1 price move = $100 P/L.
        const valuePerFullPointForOneLot = 100;

        if (stopLossDistancePrice > 0) { // Avoid division by zero
          const riskAmountInCurrency = accountEquity * riskPerTradePercent;
          const slDistanceInCurrencyForOneLot = stopLossDistancePrice * valuePerFullPointForOneLot;

          if (slDistanceInCurrencyForOneLot > 0) {
            let calculatedLotSize = riskAmountInCurrency / slDistanceInCurrencyForOneLot;

            // Apply constraints: round to 2 decimal places, min 0.01, max from risk_level settings
            calculatedLotSize = Math.max(0.01, parseFloat(calculatedLotSize.toFixed(2)));
            calculatedLotSize = Math.min(settings.maxLotSize, calculatedLotSize);
            lotSize = calculatedLotSize;
            console.log(`Session ${session.id}: Dynamic lot size calculated: ${lotSize}. Equity: ${accountEquity}, Risk %: ${riskPerTradePercent*100}%, SL Distance: ${stopLossDistancePrice.toFixed(4)}`);
          } else {
            console.warn(`Session ${session.id}: Stop loss distance in currency for one lot is zero. Using fallback lot size: ${lotSize}`);
          }
        } else {
           console.warn(`Session ${session.id}: Stop loss distance is zero. Using fallback lot size: ${lotSize}`);
        }
      } else {
        console.warn(`Session ${session.id}: Could not fetch account equity or equity is zero. Using fallback lot size: ${lotSize}. Error: ${accountSummary?.error}`);
      }
    } catch (summaryError) {
      console.error(`Session ${session.id}: Error fetching account summary for dynamic lot sizing. Using fallback lot size ${lotSize}. Error: ${summaryError.message}`);
    }
    // --- End Dynamic Lot Sizing ---

    if (lotSize < 0.01) {
        console.warn(`Session ${session.id}: Calculated lot size ${lotSize} is less than minimum 0.01. Adjusting to 0.01.`);
        lotSize = 0.01;
    }

    console.log(`Executing ${tradeType} for session ${session.id}: Price=${openPrice.toFixed(4)}, SL=${stopLossPrice.toFixed(4)}, TP=${takeProfitPrice?.toFixed(4) || 'N/A'}, Lot=${lotSize}`);

    const executionParams: ExecuteOrderParams = {
      userId: session.user_id,
      tradingAccountId: session.trading_account_id,
      symbol: 'XAUUSD',
      tradeType: tradeType,
      lotSize: lotSize, // Use the dynamically calculated or fallback lot size
      openPrice: openPrice,
      stopLossPrice: stopLossPrice,
      takeProfitPrice: takeProfitPrice,
      botSessionId: session.id,
    };

    const executionResult = await tradeProvider.executeOrder(executionParams);

    if (executionResult.success && executionResult.tradeId) {
      console.log(`Trade executed for session ${session.id}, DB Trade ID: ${executionResult.tradeId}, Ticket: ${executionResult.ticketId}`);

      // Notification content update to include SL/TP
      const notificationMessage =
        `${tradeType} ${lotSize} ${executionParams.symbol} @ ${openPrice.toFixed(4)} ` +
        `SL: ${stopLossPrice.toFixed(4)}` +
        `${takeProfitPrice ? ` TP: ${takeProfitPrice.toFixed(4)}` : ''}` +
        ` by bot (Session ${session.id})`;

      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_trade_executed',
        title: 'Bot Trade Executed (Simulated)',
        message: notificationMessage
      });
      await supabase
        .from('bot_sessions')
        .update({ total_trades: (session.total_trades || 0) + 1, last_trade_time: new Date().toISOString() })
        .eq('id', session.id);

      // Send email notification
      const recipientEmail = Deno.env.get('NOTIFICATION_EMAIL_RECIPIENT');
      if (recipientEmail) {
        const emailSubject = `[Trading Bot] Trade Executed: ${tradeType} ${lotSize} ${executionParams.symbol}`;
        const emailHtmlContent = `
          <h1>Trade Executed</h1>
          <p>A trade was executed by the automated bot:</p>
          <ul>
            <li>Session ID: ${session.id}</li>
            <li>User ID: ${session.user_id}</li>
            <li>Symbol: ${executionParams.symbol}</li>
            <li>Type: ${tradeType}</li>
            <li>Lot Size: ${lotSize}</li>
            <li>Open Price: $${openPrice.toFixed(4)}</li>
            <li>Stop Loss: $${executionParams.stopLossPrice.toFixed(4)}</li>
            <li>Database Trade ID: ${executionResult.tradeId}</li>
            <li>Ticket ID: ${executionResult.ticketId}</li>
          </ul>
        `;
        sendEmail(recipientEmail, emailSubject, emailHtmlContent)
          .then(async (emailRes) => { // Made async to await logSystemEvent
            if (emailRes.success) {
              console.log(`Trade execution email sent to ${recipientEmail}, Message ID: ${emailRes.messageId}`);
            } else {
              const errorMessage = `Failed to send trade execution email for session ${session.id}: ${emailRes.error}`;
              console.error(errorMessage);
              await logSystemEvent(supabase, 'ERROR', 'SendEmailFailure', errorMessage, { session_id: session.id, user_id: session.user_id, recipient: recipientEmail, subject: emailSubject }, session.id, session.user_id);
            }
          })
          .catch(async (err) => { // Made async
            const errorMessage = `Exception while sending trade execution email for session ${session.id}: ${err.message}`;
            console.error(errorMessage);
            await logSystemEvent(supabase, 'ERROR', 'SendEmailException', errorMessage, { session_id: session.id, user_id: session.user_id, recipient: recipientEmail, subject: emailSubject, stack: err.stack }, session.id, session.user_id);
          });
      } else {
        console.warn("NOTIFICATION_EMAIL_RECIPIENT not set. Skipping trade execution email.");
      }

    } else {
      const execErrorMsg = `Error executing trade for session ${session.id}: ${executionResult.error}`;
      console.error(execErrorMsg);
      await logSystemEvent(supabase, 'ERROR', 'TradeExecutionFailure', execErrorMsg, { session_id: session.id, user_id: session.user_id, params: executionParams }, session.id, session.user_id);
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_trade_error',
        title: 'Bot Trade Failed (Simulated)',
        message: `Failed to execute ${tradeType} for bot session ${session.id}: ${executionResult.error}`
      });
    }
  } else {
    console.log(`No trade signal for session ${session.id} based on current market conditions.`);
  }
}

function generateTicketId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

async function fetchAndStoreHistoricalData(supabase: any, data: any, apiKey: string) {
  const {
    symbol = 'XAUUSD', // Assuming XAU/USD for Alpha Vantage FX
    fromCurrency = 'XAU',
    toCurrency = 'USD',
    interval = '15min', // e.g., '1min', '5min', '15min', '30min', '60min', 'daily', 'weekly', 'monthly'
    outputsize = 'compact', // 'compact' for last 100, 'full' for full history
  } = data;

  let avFunction = '';
  let timeSeriesKeyPattern = ''; // Used to extract data from AV response

  switch (interval) {
    case '1min':
    case '5min':
    case '15min':
    case '30min':
    case '60min':
      avFunction = 'FX_INTRADAY';
      timeSeriesKeyPattern = `Time Series FX (${interval})`;
      break;
    case 'daily':
      avFunction = 'FX_DAILY';
      timeSeriesKeyPattern = `Time Series FX (Daily)`;
      break;
    case 'weekly':
      avFunction = 'FX_WEEKLY';
      timeSeriesKeyPattern = `Time Series FX (Weekly)`;
      break;
    case 'monthly':
      avFunction = 'FX_MONTHLY';
      timeSeriesKeyPattern = `Time Series FX (Monthly)`;
      break;
    default:
      throw new Error(`Unsupported interval: ${interval}`);
  }

  const url = `https://www.alphavantage.co/query?function=${avFunction}&from_symbol=${fromCurrency}&to_symbol=${toCurrency}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;

  try {
    console.log(`Fetching historical data from Alpha Vantage: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error for historical data: ${response.status} ${response.statusText}`);
    }
    const avData = await response.json();

    if (avData['Error Message'] || avData['Information']) {
        const message = avData['Error Message'] || avData['Information'];
        // Information can be a rate limit message, e.g., "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute and 500 calls per day."
        console.warn(`Alpha Vantage API message: ${message}`);
        if (message.includes("API call frequency")) {
             throw new Error(`Alpha Vantage API rate limit likely hit: ${message}`);
        }
        // For other messages that are not clearly errors but indicate no data, treat as warning but continue if possible
        // This part might need refinement based on typical AV non-error messages for empty data
    }

    const timeSeries = avData[timeSeriesKeyPattern];

    if (!timeSeries) {
      console.warn("Alpha Vantage API did not return expected time series data for key:", timeSeriesKeyPattern, "Response:", avData);
      // It's possible AV returns an empty object if no data, or a specific message.
      // If it's an error or rate limit, the above checks should catch it.
      // If it's genuinely no data for a valid query, we can return success with 0 inserted.
      return new Response(JSON.stringify({ success: true, message: "No time series data returned from Alpha Vantage, or key mismatch.", inserted: 0, response: avData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const recordsToInsert = Object.entries(timeSeries).map(([ts, values]: [string, any]) => {
      const record: any = {
        symbol: symbol, // The user-defined symbol like XAUUSD
        timeframe: interval,
        timestamp: new Date(ts).toISOString(), // Ensure ISO format for DB
        open_price: parseFloat(values["1. open"]),
        high_price: parseFloat(values["2. high"]),
        low_price: parseFloat(values["3. low"]),
        close_price: parseFloat(values["4. close"]),
      };
      // Alpha Vantage intraday for FX does not typically include volume. Daily does.
      if (values["5. volume"]) {
        record.volume = parseFloat(values["5. volume"]);
      } else if (avFunction === 'FX_DAILY' && values["5. volume"]) { // specifically for daily where volume is expected
        record.volume = parseFloat(values["5. volume"]);
      } else {
        record.volume = 0; // Default to 0 if not present
      }
      return record;
    });

    if (recordsToInsert.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No records to insert.", inserted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Attempting to insert/upsert ${recordsToInsert.length} records into price_data.`);

    // Upsert based on a unique constraint on (symbol, timeframe, timestamp)
    // If the constraint doesn't exist, it will just insert.
    const { error: upsertError, count } = await supabase
      .from('price_data')
      .upsert(recordsToInsert, {
        onConflict: 'symbol,timeframe,timestamp', // Specify conflict columns
        // ignoreDuplicates: false, // default is false, ensures update on conflict
      });

    if (upsertError) {
      console.error('Error upserting price data:', upsertError);
      throw upsertError;
    }

    console.log(`Successfully upserted ${count ?? recordsToInsert.length} records.`);
    return new Response(JSON.stringify({ success: true, inserted: count ?? recordsToInsert.length, message: "Historical data fetched and stored." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in fetchAndStoreHistoricalData:", error.message, error.stack);
    // supabaseClient is 'supabase' in this scope
    await logSystemEvent(
      supabase,
      'ERROR',
      'FetchAndStoreHistoricalData',
      `Failed to fetch/store historical data: ${error.message}`,
      { stack: error.stack, params: data }
    );
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}