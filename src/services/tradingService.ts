import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

// Re-export or define relevant types
type TradingAccount = Database['public']['Tables']['trading_accounts']['Row'];
type Trade = Database['public']['Tables']['trades']['Row'];
export type BotSession = Database['public']['Tables']['bot_sessions']['Row'] & {
  strategy_params?: StrategyParams; // Already a JSONB in DB, so can be typed here
  strategy_selection_mode?: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
  trading_accounts?: { server_name: string, platform: string }; // For joined data
};
type Notification = Database['public']['Tables']['notifications']['Row'];

// Interface for the comprehensive strategy parameters expected by the backend
// This should align with what `analyzeMarketConditions` and `runBacktestAction` expect.
export interface StrategyParams {
  // Common params that might be used by dispatcher or individual strategies
  atrPeriod?: number;
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;

  // SMA Crossover specific
  smaShortPeriod?: number;
  smaLongPeriod?: number;

  // Mean Reversion (Bollinger Bands + RSI) specific
  bbPeriod?: number;
  bbStdDevMult?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;

  // ADX settings (for regime detection and ADX-filtered strategies)
  adxPeriod?: number;
  adxTrendMinLevel?: number; // For confirming trend in strategies
  adxRangeThreshold?: number; // For ADAPTIVE regime: below this is range
  adxTrendThreshold?: number; // For ADAPTIVE regime: above this is trend

  // Breakout strategy specific (example)
  breakoutLookbackPeriod?: number;
  atrSpikeMultiplier?: number; // For breakout confirmation
}

// For `closeTradeOrderProvider`
export interface CloseOrderProviderParams {
  ticketId: string;
  lots?: number;
  // Add other params if your ITradeExecutionProvider->closeOrder expects more
}


export class TradingService {
  private static instance: TradingService;
  private priceCallbacks: ((price: number) => void)[] = [];
  private priceUpdateInterval: any | null = null;

  static getInstance(): TradingService {
    if (!TradingService.instance) {
      TradingService.instance = new TradingService();
    }
    return TradingService.instance;
  }

  // --- Trading Account Management ---
  async addTradingAccount(accountData: {
    platform: 'MT4' | 'MT5';
    serverName: string;
    loginId: string;
    password: string; // This is the plain text password from the user
    userId: string;
    accountId?: string; // Optional: for updating an existing account
  }) {
    try {
      // The backend will handle encryption using Supabase Vault.
      // Send the plain text password to the backend action.
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: {
          action: 'upsert_trading_account_action',
          data: {
            userId: accountData.userId,
            accountId: accountData.accountId, // Pass if updating
            platform: accountData.platform,
            serverName: accountData.serverName,
            loginId: accountData.loginId,
            passwordPlainText: accountData.password, // Key name change for clarity
            // isActive: true, // Defaulted in backend if not provided
          },
        },
      });

      if (error) throw error;

      // The 'data' returned from the function should be the saved account details (excluding password_encrypted)
      // The old this.testConnection might not be relevant or might need adjustment
      // if (!error && data) { await this.testConnection(data.id); } // data.id might not exist if function returns error structure
      if (data && data.id) { // Assuming function returns the account object with its ID
         // console.log("Trading account upserted successfully:", data);
         // await this.testConnection(data.id); // testConnection is a placeholder, consider removing or implementing properly
      } else if (data && data.error) { // If the function itself returns an error object in its data field
        throw new Error(data.error);
      } else if (!data) {
        throw new Error("No data returned from upsert_trading_account_action");
      }

      return { data, error: null };
    } catch (error: any) {
      console.error('Error adding/updating trading account:', error);
      return { data: null, error };
    }
  }

  // Method to update an existing trading account (could be merged with addTradingAccount if accountId is always passed)
  async updateTradingAccount(accountId: string, userId: string, updateData: {
    platform?: 'MT4' | 'MT5';
    serverName?: string;
    loginId?: string;
    password?: string; // Plain text password if updating
    isActive?: boolean;
  }) {
     const payload: any = {
        action: 'upsert_trading_account_action',
        data: {
            userId,
            accountId,
            platform: updateData.platform,
            serverName: updateData.serverName,
            loginId: updateData.loginId,
            isActive: updateData.isActive,
        }
     };
     if (updateData.password) {
         payload.data.passwordPlainText = updateData.password;
     }

    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', payload);
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      if (!data) throw new Error("No data returned from update_trading_account_action");
      return { data, error: null };
    } catch (error: any) {
      console.error(`Error updating trading account ${accountId}:`, error);
      return { data: null, error };
    }
  }


  async getTradingAccounts(userId: string) {
    return supabase.from('trading_accounts').select('*').eq('user_id', userId).eq('is_active', true);
  }

  // --- Bot Session Management ---
  async startBot(params: {
    userId: string;
    tradingAccountId: string;
    riskLevel: 'conservative' | 'medium' | 'risky';
    strategySelectionMode: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
    strategyParams: StrategyParams;
  }) {
    try {
      const { data, error } = await supabase
        .from('bot_sessions')
        .insert({
          user_id: params.userId,
          trading_account_id: params.tradingAccountId,
          risk_level: params.riskLevel,
          strategy_selection_mode: params.strategySelectionMode,
          strategy_params: params.strategyParams,
          status: 'active',
          session_start: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      console.log('Bot session started:', data);
      return { data, error: null };
    } catch (error: any) {
      console.error('Error starting bot session:', error);
      return { data: null, error };
    }
  }

  async stopBot(sessionId: string) {
    try {
      const { data, error } = await supabase
        .from('bot_sessions')
        .update({ status: 'stopped', session_end: new Date().toISOString() })
        .eq('id', sessionId)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error stopping bot session:', error);
      return { data: null, error };
    }
  }

  async getActiveUserBotSessions(userId: string): Promise<{ data: BotSession[] | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('bot_sessions')
        .select('*, trading_accounts(server_name, platform)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('session_start', { ascending: false });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching active bot sessions:', error);
      return { data: null, error };
    }
  }

  // --- Provider-based Actions (from trading-engine) ---
  async getProviderAccountSummary(tradingAccountId?: string) {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'provider_get_account_summary', data: { tradingAccountId } },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching account summary via provider:', error);
      return { data: null, error };
    }
  }

  async listProviderOpenPositions(tradingAccountId?: string) {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'provider_list_open_positions', data: { tradingAccountId } },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error listing open positions via provider:', error);
      return { data: null, error };
    }
  }

  async closeTradeOrderProvider(params: CloseOrderProviderParams) {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'provider_close_order', data: params },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error closing order via provider:', error);
      return { data: null, error };
    }
  }

  async fetchProviderServerTime() {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'provider_get_server_time', data: {} },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching server time via provider:', error);
      return { data: null, error };
    }
  }

  // --- User Trades (from `trades` table, typically for simulated trades) ---
  async getUserTrades(userId: string, limit = 50) {
    return supabase.from('trades').select('*, trading_accounts(platform, server_name)').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
  }


  // --- Notification Methods ---
  async getUserNotifications(userId: string, limit = 20): Promise<{ data: Notification[] | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching user notifications:', error);
      return { data: null, error };
    }
  }

  async markNotificationAsRead(notificationId: string) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true, updated_at: new Date().toISOString() })
        .eq('id', notificationId)
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error marking notification as read:', error);
      return { data: null, error };
    }
  }

  // --- Price Data Management ---
  async getCurrentPrice(_symbol: string = 'XAUUSD'): Promise<number | null> {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'get_current_price_action' },
      });
      if (error) { console.error('Error invoking trading-engine for price:', error); throw error; }
      if (data && typeof data.price === 'number') { return data.price; }
      else { console.error('Invalid price data received:', data); return null; }
    } catch (error: any) { console.error('Error fetching current price:', error); return null; }
  }

  async fetchHistoricalData(params: { // For populating backtest data
    symbol?: string;
    fromCurrency?: string;
    toCurrency?: string;
    interval?: string;
    outputsize?: string;
  }) {
     try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'fetch_historical_data_action', data: params }
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) { console.error('Error fetching historical data:', error); return { data: null, error };}
   }

  // --- Backtesting Service Methods ---
  async runBacktest(params: {
    userId?: string;
    symbol?: string;
    timeframe?: string;
    startDate: string;
    endDate: string;
    strategySelectionMode: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
    strategyParams: StrategyParams;
    riskSettings: {
        riskLevel?: 'conservative' | 'medium' | 'risky';
        maxLotSize?: number;
    };
    commissionPerLot?: number; // New
    slippagePoints?: number;   // New
  }) {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'run_backtest_action', data: params },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) { console.error('Error running backtest:', error); return { data: null, error };}
  }

  async getBacktestReport(reportId: string) {
     try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: {  action: 'get_backtest_report_action', data: { reportId }  },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) { console.error('Error fetching backtest report:', error); return { data: null, error };}
  }

  async listBacktests(userId?: string) {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'list_backtests_action', data: { userId } },
      });
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) { console.error('Error listing backtests:', error); return { data: null, error };}
  }

  // --- Real-time Price Updates (Polling) ---
  subscribeToPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks.push(callback);
    if (!this.priceUpdateInterval) { this.initializePricePolling(); }
  }

  unsubscribeFromPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks = this.priceCallbacks.filter(cb => cb !== callback);
    if (this.priceCallbacks.length === 0 && this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
  }

  // --- Private Methods ---
  private async testConnection(_accountId: string): Promise<boolean> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    return Math.random() > 0.1;
  }
  private generateTicketId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
  private async sendTradeToMT(_trade: Trade): Promise<void> { // kept for legacy executeTrade
    console.log('Simulating sending legacy trade to MT platform...');
  }
  private calculateProfitLoss(trade: Trade, closePrice: number): number { // kept for legacy closeTrade
    const priceDiff = trade.trade_type === 'BUY' ? closePrice - (trade.open_price ?? 0) : (trade.open_price ?? 0) - closePrice;
    return priceDiff * (trade.lot_size ?? 0) * 100;
  }
  private async createTradeNotification(userId: string, trade: Trade, action: 'opened' | 'closed' = 'opened') {
     const title = `Trade ${action.charAt(0).toUpperCase() + action.slice(1)} (Legacy)`;
     const message = `${trade.trade_type} ${trade.lot_size} lots of ${trade.symbol} ${action === 'opened' ? `at ${trade.open_price}` : ''}`;
     await supabase.from('notifications').insert({ user_id: userId, type: 'trade_alert', title, message });
  }
  private initializeBotLogic(_session: BotSession) {
    console.log('Simulating initializing bot session logic (from tradingService)...');
  }
  private initializePricePolling() {
    this.priceUpdateInterval = setInterval(async () => {
      const price = await this.getCurrentPrice();
      if (price !== null) { this.priceCallbacks.forEach(callback => callback(price)); }
    }, 15000);
  }

  // --- Admin Service Methods ---
  async adminGetEnvVariablesStatus(): Promise<{ data: Array<{name: string, status: string}> | null; error: any }> {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'admin_get_env_variables_status' },
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error); // Handle errors returned in the data payload
      return { data, error: null };
    } catch (error: any) {
      console.error('Error fetching ENV variable statuses:', error);
      return { data: null, error };
    }
  }

  async adminListUsersOverview(): Promise<{ data: Array<{id: string, email?: string, created_at: string, last_sign_in_at?: string}> | null; error: any }> {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'admin_list_users_overview' },
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error); // Handle errors returned in the data payload
      return { data, error: null };
    } catch (error: any) {
      console.error('Error listing users overview:', error);
      return { data: null, error };
    }
  }
}

export const tradingService = TradingService.getInstance();