import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

// --- Types ---
type TradingAccount = Database['public']['Tables']['trading_accounts']['Row'];
type Trade = Database['public']['Tables']['trades']['Row'];
export type BotSession = Database['public']['Tables']['bot_sessions']['Row'] & {
  strategy_params?: StrategyParams;
  strategy_selection_mode?: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
  trading_accounts?: { server_name: string, platform: string };
};
type Notification = Database['public']['Tables']['notifications']['Row'];

export interface StrategyParams {
  atrPeriod?: number;
  atrMultiplierSL?: number;
  atrMultiplierTP?: number;
  smaShortPeriod?: number;
  smaLongPeriod?: number;
  bbPeriod?: number;
  bbStdDevMult?: number;
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  adxPeriod?: number;
  adxTrendMinLevel?: number;
  adxRangeThreshold?: number;
  adxTrendThreshold?: number;
  breakoutLookbackPeriod?: number;
  atrSpikeMultiplier?: number;
}

export interface CloseOrderProviderParams {
  ticketId: string;
  lots?: number;
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

  // --- Trading Accounts ---
  async addTradingAccount(accountData: {
    platform: 'MT4' | 'MT5';
    serverName: string;
    loginId: string;
    password: string;
    userId: string;
    accountId?: string;
  }) {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: {
          action: 'upsert_trading_account_action',
          data: {
            userId: accountData.userId,
            accountId: accountData.accountId,
            platform: accountData.platform,
            serverName: accountData.serverName,
            loginId: accountData.loginId,
            passwordPlainText: accountData.password,
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data) throw new Error("No data returned from upsert_trading_account_action");
      return { data, error: null };
    } catch (error: any) {
      console.error('Error adding/updating trading account:', error);
      return { data: null, error };
    }
  }

  async updateTradingAccount(accountId: string, userId: string, updateData: {
    platform?: 'MT4' | 'MT5';
    serverName?: string;
    loginId?: string;
    password?: string;
    isActive?: boolean;
  }) {
    const payload: any = {
      action: 'upsert_trading_account_action',
      data: {
        userId,
        accountId,
        ...updateData,
        passwordPlainText: updateData.password,
      },
    };

    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', payload);
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
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

  // --- Bot Sessions ---
  async startBot(params: {
    userId: string;
    tradingAccountId: string;
    riskLevel: 'conservative' | 'medium' | 'risky';
    strategySelectionMode: BotSession['strategy_selection_mode'];
    strategyParams: StrategyParams;
  }) {
    try {
      const { data, error } = await supabase.from('bot_sessions').insert({
        user_id: params.userId,
        trading_account_id: params.tradingAccountId,
        risk_level: params.riskLevel,
        strategy_selection_mode: params.strategySelectionMode,
        strategy_params: params.strategyParams,
        status: 'active',
        session_start: new Date().toISOString(),
      }).select().single();

      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error starting bot session:', error);
      return { data: null, error };
    }
  }

  async stopBot(sessionId: string) {
    try {
      const { data, error } = await supabase.from('bot_sessions').update({
        status: 'stopped',
        session_end: new Date().toISOString(),
      }).eq('id', sessionId).select().single();
      if (error) throw error;
      return { data, error: null };
    } catch (error: any) {
      console.error('Error stopping bot session:', error);
      return { data: null, error };
    }
  }

  async getActiveUserBotSessions(userId: string) {
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

  // --- Market Data ---
  async getCurrentPrice(symbol: string = 'XAUUSD'): Promise<number | null> {
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'get_current_price_action', data: { symbol } },
      });
      if (error) throw error;
      return data?.price ?? null;
    } catch (error: any) {
      console.error('Error fetching current price:', error);
      return null;
    }
  }

  async fetchHistoricalData(params: {
    symbol?: string;
    fromCurrency?: string;
    toCurrency?: string;
    interval?: string;
    outputsize?: string;
  }) {
    return this.invoke('fetch_historical_data_action', params);
  }

  // --- Backtesting ---
  async runBacktest(params: {
    userId?: string;
    symbol?: string;
    timeframe?: string;
    startDate: string;
    endDate: string;
    strategySelectionMode: BotSession['strategy_selection_mode'];
    strategyParams: StrategyParams;
    riskSettings: {
      riskLevel?: 'conservative' | 'medium' | 'risky';
      maxLotSize?: number;
    };
    commissionPerLot?: number;
    slippagePoints?: number;
  }) {
    return this.invoke('run_backtest_action', params);
  }

  async getBacktestReport(reportId: string) {
    return this.invoke('get_backtest_report_action', { reportId });
  }

  async listBacktests(userId?: string) {
    return this.invoke('list_backtests_action', { userId });
  }

  // --- Notifications ---
  async getUserNotifications(userId: string, limit = 20) {
    return supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
  }

  async markNotificationAsRead(notificationId: string) {
    return supabase
      .from('notifications')
      .update({ is_read: true, updated_at: new Date().toISOString() })
      .eq('id', notificationId)
      .select()
      .single();
  }

  // --- Admin Functions ---
  async adminGetEnvVariablesStatus() {
    return this.invoke('admin_get_env_variables_status', {});
  }

  async adminListUsersOverview() {
    return this.invoke('admin_list_users_overview', {});
  }

  // --- Real-Time Price Subscriptions ---
  subscribeToPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks.push(callback);
    if (!this.priceUpdateInterval) {
      this.priceUpdateInterval = setInterval(async () => {
        const price = await this.getCurrentPrice();
        if (price !== null) {
          this.priceCallbacks.forEach(cb => cb(price));
        }
      }, 15000);
    }
  }

  unsubscribeFromPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks = this.priceCallbacks.filter(cb => cb !== callback);
    if (this.priceCallbacks.length === 0 && this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
  }

  // --- Supabase Function Helper ---
  private async invoke(action: string, data: any) {
    try {
      const { data: result, error } = await supabase.functions.invoke('trading-engine', {
        body: { action, data },
      });
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      return { data: result, error: null };
    } catch (error: any) {
      console.error(`Error invoking '${action}':`, error);
      return { data: null, error };
    }
  }
}

export const tradingService = TradingService.getInstance();