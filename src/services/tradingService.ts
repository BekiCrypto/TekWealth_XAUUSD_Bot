import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

type TradingAccount = Database['public']['Tables']['trading_accounts']['Row'];
type Trade = Database['public']['Tables']['trades']['Row'];
type BotSession = Database['public']['Tables']['bot_sessions']['Row'];

export class TradingService {
  private static instance: TradingService;
  // Remove WebSocket simulation as we'll use polling for now
  // private priceSocket: WebSocket | null = null;
  private priceCallbacks: ((price: number) => void)[] = [];
  private priceUpdateInterval: any | null = null; // To store interval ID

  static getInstance(): TradingService {
    if (!TradingService.instance) {
      TradingService.instance = new TradingService();
    }
    return TradingService.instance;
  }

  // Trading Account Management
  async addTradingAccount(accountData: {
    platform: 'MT4' | 'MT5';
    serverName: string;
    loginId: string;
    password: string;
    userId: string;
  }) {
    const encryptedPassword = await this.encryptPassword(accountData.password);
    
    const { data, error } = await supabase
      .from('trading_accounts')
      .insert({
        user_id: accountData.userId,
        platform: accountData.platform,
        server_name: accountData.serverName,
        login_id: accountData.loginId,
        password_encrypted: encryptedPassword
      })
      .select()
      .single();

    if (!error && data) {
      await this.testConnection(data.id);
    }
    return { data, error };
  }

  async getTradingAccounts(userId: string) {
    const { data, error } = await supabase
      .from('trading_accounts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true);
    return { data, error };
  }

  async updateAccountBalance(accountId: string, balanceData: {
    account_balance: number;
    equity: number;
    margin: number;
    free_margin: number;
  }) {
    const { data, error } = await supabase
      .from('trading_accounts')
      .update({
        ...balanceData,
        last_sync: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', accountId)
      .select()
      .single();
    return { data, error };
  }

  // Trading Operations
  async executeTrade(tradeData: {
    userId: string;
    tradingAccountId: string;
    symbol: string;
    tradeType: 'BUY' | 'SELL';
    lotSize: number;
    stopLoss?: number;
    takeProfit?: number;
  }) {
    try {
      const currentPrice = await this.getCurrentPrice(tradeData.symbol);
      if (currentPrice === null) { // Check if price fetch failed
        throw new Error("Could not fetch current price to execute trade.");
      }
      
      const ticketId = this.generateTicketId();
      const { data: trade, error } = await supabase
        .from('trades')
        .insert({
          user_id: tradeData.userId,
          trading_account_id: tradeData.tradingAccountId,
          ticket_id: ticketId,
          symbol: tradeData.symbol,
          trade_type: tradeData.tradeType,
          lot_size: tradeData.lotSize,
          open_price: currentPrice,
          stop_loss: tradeData.stopLoss,
          take_profit: tradeData.takeProfit,
          status: 'open'
        })
        .select()
        .single();

      if (error) throw error;
      await this.sendTradeToMT(trade); // Still simulated
      await this.createTradeNotification(tradeData.userId, trade);
      return { data: trade, error: null };
    } catch (error) {
      console.error('Error executing trade:', error);
      return { data: null, error };
    }
  }

  async closeTrade(tradeId: string, closePriceInput?: number) {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (fetchError || !trade) throw fetchError;

      const finalClosePrice = closePriceInput ?? await this.getCurrentPrice(trade.symbol);
      if (finalClosePrice === null) { // Check if price fetch failed
         throw new Error("Could not fetch current price to close trade.");
      }
      const profitLoss = this.calculateProfitLoss(trade, finalClosePrice);

      const { data, error } = await supabase
        .from('trades')
        .update({
          close_price: finalClosePrice,
          profit_loss: profitLoss,
          status: 'closed',
          close_time: new Date().toISOString()
        })
        .eq('id', tradeId)
        .select()
        .single();

      if (!error && data) {
        await this.createTradeNotification(trade.user_id, data, 'closed');
      }
      return { data, error };
    } catch (error) {
      console.error('Error closing trade:', error);
      return { data: null, error };
    }
  }

  async getUserTrades(userId: string, limit = 50) {
    const { data, error } = await supabase
      .from('trades')
      .select(`
        *,
        trading_accounts (
          platform,
          server_name
        )
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    return { data, error };
  }

  // Bot Session Management
  async startBotSession(sessionData: {
    userId: string;
    tradingAccountId: string;
    riskLevel: 'conservative' | 'medium' | 'risky';
    settings: any;
  }) {
    const { data, error } = await supabase
      .from('bot_sessions')
      .insert({
        user_id: sessionData.userId,
        trading_account_id: sessionData.tradingAccountId,
        risk_level: sessionData.riskLevel,
        settings: sessionData.settings,
        status: 'active'
      })
      .select()
      .single();

    if (!error) {
      this.initializeBotLogic(data); // Placeholder
    }
    return { data, error };
  }

  async stopBotSession(sessionId: string) {
    const { data, error } = await supabase
      .from('bot_sessions')
      .update({
        status: 'stopped',
        session_end: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single();
    return { data, error };
  }

  async getBotSession(userId: string) {
    const { data, error } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();
    return { data, error };
  }

  // Price Data Management
  async getCurrentPrice(_symbol: string = 'XAUUSD'): Promise<number | null> { // Ensure symbol is used if becomes relevant
    try {
      const { data, error } = await supabase.functions.invoke('trading-engine', {
        body: { action: 'get_current_price_action' },
      });

      if (error) {
        console.error('Error invoking trading-engine for price:', error);
        throw error;
      }

      if (data && typeof data.price === 'number') {
        return data.price;
      } else {
        console.error('Invalid price data received from trading-engine:', data);
        return null; // Fallback or indicate error
      }
    } catch (error) {
      console.error('Error fetching current price from backend:', error);
      return null; // Fallback or indicate error
    }
  }

  async storePriceData(priceData: {
    symbol: string;
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
    timeframe?: string;
  }) {
    const { data, error } = await supabase
      .from('price_data')
      .insert({
        symbol: priceData.symbol,
        timestamp: priceData.timestamp,
        open_price: priceData.open,
        high_price: priceData.high,
        low_price: priceData.low,
        close_price: priceData.close,
        volume: priceData.volume || 0,
        timeframe: priceData.timeframe as any || '1m'
      });
    return { data, error };
  }

  async getPriceHistory(symbol: string = 'XAUUSD', timeframe: string = '1h', limit = 100) {
    const { data, error } = await supabase
      .from('price_data')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('timestamp', { ascending: false })
      .limit(limit);
    return { data, error };
  }

  // Real-time Price Updates (Polling the backend)
  subscribeToPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks.push(callback);
    
    if (!this.priceUpdateInterval) { // Only start interval if not already running
      this.initializePricePolling();
    }
  }

  unsubscribeFromPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks = this.priceCallbacks.filter(cb => cb !== callback);
    
    if (this.priceCallbacks.length === 0 && this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
  }

  // Private Methods
  private async encryptPassword(password: string): Promise<string> {
    // DEPRECATED: Storing or directly handling user passwords for external platforms like MT4/MT5
    // is highly discouraged due to security risks.
    // For broker API keys, they should be stored encrypted at rest (e.g., using Supabase Vault or AES-256 encryption)
    // and managed server-side, not passed through or stored in the client if possible.
    // This function is a placeholder and should not be used for real credential handling.
    console.warn("encryptPassword method is a placeholder and should not be used for production credentials.");
    return `placeholder-for-${password}`; // Return a non-sensitive placeholder
  }

  private async testConnection(_accountId: string): Promise<boolean> { // accountId not used
    await new Promise(resolve => setTimeout(resolve, 1000));
    return Math.random() > 0.1;
  }

  private generateTicketId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  private async sendTradeToMT(_trade: Trade): Promise<void> { // trade not used
    console.log('Simulating sending trade to MT platform...');
  }

  private calculateProfitLoss(trade: Trade, closePrice: number): number {
    const priceDiff = trade.trade_type === 'BUY' 
      ? closePrice - (trade.open_price ?? 0) // Handle null open_price defensively
      : (trade.open_price ?? 0) - closePrice;
    return priceDiff * (trade.lot_size ?? 0) * 100; // Handle null lot_size
  }

  private async createTradeNotification(userId: string, trade: Trade, action: 'opened' | 'closed' = 'opened') {
    const title = `Trade ${action.charAt(0).toUpperCase() + action.slice(1)}`;
    // Ensure trade.open_price is defined before using it in message
    const message = `${trade.trade_type} ${trade.lot_size} lots of ${trade.symbol} ${action === 'opened' ? `at ${trade.open_price}` : ''}`;

    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'trade_alert',
      title,
      message
    });
  }

  private initializeBotLogic(_session: BotSession) { // session not used
    console.log('Simulating initializing bot session logic...');
  }

  private initializePricePolling() {
    // Poll the backend for price updates
    this.priceUpdateInterval = setInterval(async () => {
      const price = await this.getCurrentPrice(); // Fetches from backend
      if (price !== null) {
        this.priceCallbacks.forEach(callback => callback(price));
      }
    }, 15000); // Poll every 15 seconds - adjust as needed, mindful of function invocation costs
  }
}

export const tradingService = TradingService.getInstance();