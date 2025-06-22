import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Helper function to get environment variables
function getEnv(variableName: string): string {
  const value = Deno.env.get(variableName)
  if (!value) {
    throw new Error(`Environment variable ${variableName} is not set.`)
  }
  return value
}

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
    try {
      const response = await fetch(`${this.bridgeUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const errorText = await response.text(); // Get text first for better debugging
        let errorData;
        try {
            errorData = JSON.parse(errorText);
        } catch (e) {
            errorData = { error: "Failed to parse error response from bridge", details: errorText };
        }
        console.error(`MetaTraderBridgeProvider Error: ${response.status} ${response.statusText}`, errorData);
        throw new Error(`Bridge API Error (${endpoint}): ${response.status} - ${errorData.error || response.statusText}`);
      }
      // Handle cases where response might be empty for 202/204 status
      if (response.status === 202 || response.status === 204) {
          return { success: true, message: `Request to ${endpoint} accepted.` }; // Or an empty object if preferred
      }
      return await response.json();
    } catch (error) {
      console.error(`MetaTraderBridgeProvider Request Failed (${endpoint}):`, error);
      throw error;
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
         const price = await getCurrentGoldPrice(alphaVantageApiKey);
         return new Response(JSON.stringify({ price }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
         });

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

      default:
        throw new Error(`Unknown action: ${action}`)
    }
  } catch (error) {
    console.error('Trading engine error:', error.message, error.stack)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})

async function fetchCurrentGoldPriceFromAPI(apiKey: string): Promise<number> {
  // Using Alpha Vantage CURRENCY_EXCHANGE_RATE endpoint for XAU to USD
  const url = `https://www.alphavantage.co/query?function=CURRENCY_EXCHANGE_RATE&from_currency=XAU&to_currency=USD&apikey=${apiKey}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage API error: ${response.statusText}`);
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
    console.log("Fetched new gold price from API:", price);
    return price;
  } catch (error) {
    console.error("Error fetching gold price from Alpha Vantage:", error);
    // If API fails, try to return the last cached price if not too old
    if (latestGoldPrice && (Date.now() - latestGoldPrice.timestamp < PRICE_CACHE_DURATION_MS * 2)) {
      console.warn("Returning cached gold price due to API error.");
      return latestGoldPrice.price;
    }
    throw error; // Re-throw if no usable cache
  }
}

// --- Action Handlers for ITradeExecutionProvider methods ---
// Helper to get the configured trade provider
function getTradeProvider(supabase: any, alphaVantageApiKeyForSimulated: string): ITradeExecutionProvider {
  const providerType = Deno.env.get('TRADE_PROVIDER_TYPE')?.toUpperCase() || 'SIMULATED';
  if (providerType === 'METATRADER') {
    const bridgeUrl = Deno.env.get('MT_BRIDGE_URL');
    const bridgeApiKeyEnv = Deno.env.get('MT_BRIDGE_API_KEY');
    if (!bridgeUrl || !bridgeApiKeyEnv) {
      console.warn("MetaTrader provider configured but URL or API key missing. Falling back to SIMULATED.");
      return new SimulatedTradeProvider(supabase, alphaVantageApiKeyForSimulated);
    }
    return new MetaTraderBridgeProvider(bridgeUrl, bridgeApiKeyEnv);
  }
  return new SimulatedTradeProvider(supabase, alphaVantageApiKeyForSimulated);
}

async function handleProviderCloseOrder(supabase: any, data: any, alphaVantageApiKey: string) {
  const provider = getTradeProvider(supabase, alphaVantageApiKey);
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
    from: { email: fromEmail, name: 'TekWealth Trading Bot' }, // Optional: Add a sender name
    subject: subject,
    content: [{ type: 'text/html', value: htmlContent }],
  };

  try {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendGridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    });

    if (response.status === 202) { // SendGrid returns 202 Accepted on success
      console.log(`Email sent successfully to ${to}. Subject: ${subject}`);
      // SendGrid does not return a message ID in the V3 mail/send response body directly for 202.
      // It's available via X-Message-Id header, which we can try to get if needed, or via event webhooks.
      // For simplicity, we'll just confirm success based on status.
      const messageId = response.headers.get('x-message-id');
      return { success: true, messageId: messageId || undefined };
    } else {
      const errorBody = await response.json();
      console.error(`Failed to send email. Status: ${response.status}`, errorBody);
      return { success: false, error: `SendGrid API Error: ${response.status} - ${JSON.stringify(errorBody)}` };
    }
  } catch (error) {
    console.error('Error sending email via SendGrid:', error);
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
    userId, // For potential future use (e.g. saving reports per user)
    symbol = 'XAUUSD',
    timeframe = '15min', // Should match the strategy's timeframe
    startDate, // ISO Date string
    endDate,   // ISO Date string
    strategySettings = { shortPeriod: 20, longPeriod: 50 }, // Default SMA settings
    // Default risk settings, now includes ATR multipliers
    riskSettings = {
      riskLevel: 'conservative',
      maxLotSize: 0.01,
      // stopLossPips is now less relevant if ATR is used, but keep for other strategies or fallback
      stopLossPips: 200,
      atrMultiplierSL: 1.5, // Default ATR SL multiplier
      atrMultiplierTP: 3.0    // Default ATR TP multiplier
    }
  } = data;

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
        let slHit = false;
        let slPrice = 0;
        if (openTrade.tradeType === 'BUY' && currentLowPrice <= openTrade.stopLossPrice) {
          slHit = true;
          slPrice = openTrade.stopLossPrice;
        } else if (openTrade.tradeType === 'SELL' && currentHighPrice >= openTrade.stopLossPrice) {
          slHit = true;
          slPrice = openTrade.stopLossPrice;
        }

        if (slHit) {
          const priceDiff = openTrade.tradeType === 'BUY' ? slPrice - openTrade.entryPrice : openTrade.entryPrice - slPrice;
          tradesForDb.push({
            ...openTrade,
            exitTime: currentTime,
            exitPrice: slPrice,
            profitOrLoss: priceDiff * openTrade.lotSize * 100,
            closeReason: 'SL',
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
        .then(emailRes => {
          if (emailRes.success) console.log(`Backtest completion email sent to ${recipientEmail}, Message ID: ${emailRes.messageId}`);
          else console.error(`Failed to send backtest completion email: ${emailRes.error}`);
        })
        .catch(err => console.error(`Exception while sending backtest completion email: ${err.message}`));
    } else {
      console.warn("NOTIFICATION_EMAIL_RECIPIENT not set. Skipping backtest completion email.");
    }

    return new Response(JSON.stringify(finalResults), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in runBacktestAction:", error.message, error.stack);
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
  const { data: sessions, error } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('status', 'active')

  if (error) throw error
  if (!sessions || sessions.length === 0) return new Response(JSON.stringify({ processed: 0, message: "No active sessions" }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })


  let processedCount = 0;
  for (const session of sessions) {
    try {
      await processBotSession(supabase, session, apiKey)
      processedCount++;
    } catch (sessionError) {
      console.error(`Error processing bot session ${session.id}:`, sessionError.message, sessionError.stack)
      // Optionally, update session status to 'error' or log error to DB
      await supabase.from('notifications').insert({
        user_id: session.user_id,
        type: 'bot_error',
        title: 'Bot Session Error',
        message: `Error in bot session ${session.id}: ${sessionError.message}`
      });
    }
  }

  return new Response(JSON.stringify({ processed: processedCount }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function fetchHistoricalGoldPrices(apiKey: string, interval: string = '15min', outputsize: string = 'compact'): Promise<any[]> {
  // Using Alpha Vantage TIME_SERIES_INTRADAY for XAU (often needs a proxy like XAUUSD or a specific broker symbol if AV supports it directly)
  // For XAU/USD, Alpha Vantage provides FX_INTRADAY
  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=XAU&to_symbol=USD&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}&datatype=json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Alpha Vantage historical data API error: ${response.statusText}`);
    }
    const data = await response.json();
    const timeSeriesKey = `Time Series FX (${interval})`;
    const timeSeries = data[timeSeriesKey];

    if (!timeSeries) {
      console.warn("Alpha Vantage API did not return expected historical data:", data);
      throw new Error("Could not fetch historical gold prices from Alpha Vantage. Check symbol or API response format.");
    }
    // Convert to array of { timestamp, open, high, low, close, volume }
    // Alpha Vantage returns data with "1. open", "2. high", etc.
    return Object.entries(timeSeries).map(([timestamp, values]: [string, any]) => ({
      timestamp,
      open: parseFloat(values["1. open"]),
      high: parseFloat(values["2. high"]),
      low: parseFloat(values["3. low"]),
      close: parseFloat(values["4. close"]),
    })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Ensure ascending order
  } catch (error) {
    console.error("Error fetching historical gold prices:", error);
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


// Refactored: Main Market Analysis Dispatcher
async function analyzeMarketConditions(
  apiKey: string,
  sessionSettings: { // Now expects a more comprehensive settings object
    strategySelectionMode?: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'ADX_TREND_FOLLOW';
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
  },
  ohlcDataForAnalysis?: any[],
  currentIndexForDecision?: number
): Promise<MarketAnalysisResult> {
  try {
    // Consolidate and default all parameters
    const params = {
        strategySelectionMode: sessionSettings.strategySelectionMode || 'ADAPTIVE',
        smaShortPeriod: sessionSettings.smaShortPeriod || 20,
        smaLongPeriod: sessionSettings.smaLongPeriod || 50,
        bbPeriod: sessionSettings.bbPeriod || 20,
        bbStdDevMult: sessionSettings.bbStdDevMult || 2,
        rsiPeriod: sessionSettings.rsiPeriod || 14,
        rsiOversold: sessionSettings.rsiOversold || 30,
        rsiOverbought: sessionSettings.rsiOverbought || 70,
        adxPeriod: sessionSettings.adxPeriod || 14,
        adxTrendMinLevel: sessionSettings.adxTrendMinLevel || 25,
        adxRangeThreshold: sessionSettings.adxRangeThreshold || 20,
        adxTrendThreshold: sessionSettings.adxTrendThreshold || 25,
        atrPeriod: sessionSettings.atrPeriod || 14,
        atrMultiplierSL: sessionSettings.atrMultiplierSL || 1.5,
        atrMultiplierTP: session.strategy_settings?.atrMultiplierTP || 3.0, // Example: TP might be more strategy specific
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
            atrMultiplierSL: params.atrMultiplierSL, atrMultiplierTP: params.atrMultiplierTP
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

    // Default or if mode not recognized, perhaps SMA Crossover or no trade
    console.warn(`Unknown or default strategy selection mode: ${params.strategySelectionMode}. Defaulting to no trade.`);
    return { shouldTrade: false, priceAtDecision: decisionPrice };

  } catch (error) {
    console.error("Error during market analysis dispatcher:", error.message, error.stack);
    return { shouldTrade: false }; // Default to no trade on error
  }
}


async function processBotSession(supabase: any, session: any, apiKey: string) {
  console.log(`Processing bot session ${session.id} for user ${session.user_id} (Live Mode)`);

  let tradeProvider: ITradeExecutionProvider;
  const providerType = Deno.env.get('TRADE_PROVIDER_TYPE')?.toUpperCase() || 'SIMULATED';

  if (providerType === 'METATRADER') {
    const bridgeUrl = Deno.env.get('MT_BRIDGE_URL');
    const bridgeApiKey = Deno.env.get('MT_BRIDGE_API_KEY');
    if (!bridgeUrl || !bridgeApiKey) {
      console.error("MetaTrader provider selected, but MT_BRIDGE_URL or MT_BRIDGE_API_KEY is not set. Falling back to SIMULATED.");
      tradeProvider = new SimulatedTradeProvider(supabase, apiKey); // apiKey for AlphaVantage for simulated close price
    } else {
      console.log(`Using MetaTraderBridgeProvider with URL: ${bridgeUrl}`);
      tradeProvider = new MetaTraderBridgeProvider(bridgeUrl, bridgeApiKey);
    }
  } else {
    console.log("Using SimulatedTradeProvider.");
    tradeProvider = new SimulatedTradeProvider(supabase, apiKey); // apiKey for AlphaVantage for simulated close price
  }


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
  const strategyParams = {
    smaShortPeriod: session.strategy_settings?.smaShortPeriod || 20,
    smaLongPeriod: session.strategy_settings?.smaLongPeriod || 50,
    atrPeriod: session.strategy_settings?.atrPeriod || 14,
    atrMultiplierSL: session.risk_settings?.atrMultiplierSL || 1.5, // Get from risk_settings
    atrMultiplierTP: session.risk_settings?.atrMultiplierTP || 3.0,   // Get from risk_settings
  };
  const analysisResult = await analyzeMarketConditions(apiKey, strategyParams);

  if (analysisResult.shouldTrade && analysisResult.tradeType && analysisResult.priceAtDecision) {
    const tradeType = analysisResult.tradeType;
    const openPrice = analysisResult.priceAtDecision;
    const lotSize = settings.maxLotSize; // This is from the general riskSettingsMap (conservative, medium, risky)

    // Use SL/TP from analysisResult if available (now ATR-based)
    const stopLossPrice = analysisResult.stopLoss;
    const takeProfitPrice = analysisResult.takeProfit; // Optional

    if (!stopLossPrice) {
        console.error(`Session ${session.id}: No stopLossPrice provided by analysisResult. Skipping trade.`);
        return;
    }

    console.log(`Executing ${tradeType} for session ${session.id}: Price=${openPrice.toFixed(4)}, SL=${stopLossPrice.toFixed(4)}, TP=${takeProfitPrice?.toFixed(4) || 'N/A'}, Lot=${lotSize}`);

    const executionParams: ExecuteOrderParams = {
      userId: session.user_id,
      tradingAccountId: session.trading_account_id,
      symbol: 'XAUUSD',
      tradeType: tradeType,
      lotSize: lotSize,
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
          .then(emailRes => {
            if (emailRes.success) console.log(`Trade execution email sent to ${recipientEmail}, Message ID: ${emailRes.messageId}`);
            else console.error(`Failed to send trade execution email: ${emailRes.error}`);
          })
          .catch(err => console.error(`Exception while sending trade execution email: ${err.message}`));
      } else {
        console.warn("NOTIFICATION_EMAIL_RECIPIENT not set. Skipping trade execution email.");
      }

    } else {
      console.error(`Error executing trade for session ${session.id}:`, executionResult.error);
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

  if (['1min', '5min', '15min', '30min', '60min'].includes(interval)) {
    avFunction = 'FX_INTRADAY';
    timeSeriesKeyPattern = `Time Series FX (${interval})`;
  } else if (interval === 'daily') {
    avFunction = 'FX_DAILY';
    timeSeriesKeyPattern = `Time Series FX (Daily)`;
  } else if (interval === 'weekly') {
    avFunction = 'FX_WEEKLY';
    timeSeriesKeyPattern = `Time Series FX (Weekly)`;
  } else if (interval === 'monthly') {
    avFunction = 'FX_MONTHLY';
    timeSeriesKeyPattern = `Time Series FX (Monthly)`;
  } else {
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
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
}