import { supabase } from '../lib/supabase';
import { Database } from '../types/database';

type TradingAccount = Database['public']['Tables']['trading_accounts']['Row'];
type Trade = Database['public']['Tables']['trades']['Row'];
type BotSession = Database['public']['Tables']['bot_sessions']['Row'];

export class TradingService {
  private static instance: TradingService;
  private priceSocket: WebSocket | null = null;
  private priceCallbacks: ((price: number) => void)[] = [];

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
    // Encrypt password before storing
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
      // Test connection
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
      // Get current price
      const currentPrice = await this.getCurrentPrice(tradeData.symbol);
      
      // Generate ticket ID
      const ticketId = this.generateTicketId();

      // Insert trade record
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

      // Send trade to MT4/MT5 (simulated for now)
      await this.sendTradeToMT(trade);

      // Create notification
      await this.createTradeNotification(tradeData.userId, trade);

      return { data: trade, error: null };
    } catch (error) {
      console.error('Error executing trade:', error);
      return { data: null, error };
    }
  }

  async closeTrade(tradeId: string, closePrice?: number) {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (fetchError || !trade) throw fetchError;

      const finalClosePrice = closePrice || await this.getCurrentPrice(trade.symbol);
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

      if (!error) {
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
      // Start bot logic here
      this.initializeBotLogic(data);
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
  async getCurrentPrice(symbol: string = 'XAUUSD'): Promise<number> {
    try {
      // In production, this would connect to a real price feed
      // For now, we'll simulate gold price around $2045
      const basePrice = 2045;
      const variation = (Math.random() - 0.5) * 10; // ±$5 variation
      return basePrice + variation;
    } catch (error) {
      console.error('Error fetching current price:', error);
      return 2045; // Fallback price
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

  // Real-time Price Updates
  subscribeToPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks.push(callback);
    
    if (!this.priceSocket) {
      this.initializePriceSocket();
    }
  }

  unsubscribeFromPriceUpdates(callback: (price: number) => void) {
    this.priceCallbacks = this.priceCallbacks.filter(cb => cb !== callback);
    
    if (this.priceCallbacks.length === 0 && this.priceSocket) {
      this.priceSocket.close();
      this.priceSocket = null;
    }
  }

  // Private Methods

  // ##################################################################################
  // # CRITICAL SECURITY WARNING #
  // ##################################################################################
  // The `encryptPassword` method below uses `btoa` (Base64 encoding), WHICH IS NOT #
  // ENCRYPTION AND IS COMPLETELY INSECURE for storing passwords.                     #
  // THIS IS FOR DEMONSTRATION PURPOSES ONLY AND MUST BE REPLACED with a secure       #
  // server-side hashing mechanism (e.g., Argon2, bcrypt) or proper credential        #
  // management (e.g., OAuth, API keys) BEFORE ANY PRODUCTION USE.                    #
  // Storing passwords this way will lead to severe security vulnerabilities.         #
  // ##################################################################################
  private async encryptPassword(password: string): Promise<string> {
    // In production, use proper encryption (SERVER-SIDE HASHING, NOT THIS!)
    console.warn('[SECURITY_RISK] Using btoa for password encoding. DEMO ONLY. NOT FOR PRODUCTION.');
    return btoa(password); // Simple base64 encoding for demo - HIGHLY INSECURE
  }

  private async testConnection(accountId: string): Promise<boolean> {
    // Simulate connection test
    await new Promise(resolve => setTimeout(resolve, 1000));
    return Math.random() > 0.1; // 90% success rate
  }

  private generateTicketId(): string {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  private async sendTradeToMT(trade: Trade): Promise<void> {
    // TODO: PRODUCTION - Implement actual MetaTrader 4/5 integration.
    // This requires a server-side component or direct integration if the MT platform offers an API.
    // This is a placeholder.
    console.log('[TODO_PROD] Simulating sending trade to MT platform:', trade);
  }

  private calculateProfitLoss(trade: Trade, closePrice: number): number {
    const priceDiff = trade.trade_type === 'BUY' 
      ? closePrice - trade.open_price
      : trade.open_price - closePrice;
    
    // Simplified P&L calculation (actual would depend on contract size, etc.)
    return priceDiff * trade.lot_size * 100;
  }

  private async createTradeNotification(userId: string, trade: Trade, action: 'opened' | 'closed' = 'opened') {
    const title = `Trade ${action.charAt(0).toUpperCase() + action.slice(1)}`;
    const message = `${trade.trade_type} ${trade.lot_size} lots of ${trade.symbol} at ${trade.open_price}`;

    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'trade_alert',
      title,
      message
    });
  }

  private initializeBotLogic(session: BotSession) {
    // Bot trading logic would go here
    console.log('Initializing bot session:', session);
  }

  private initializePriceSocket() {
    // TODO: PRODUCTION - Connect to a real-time price feed WebSocket server.
    // This is a placeholder that simulates price updates using getCurrentPrice (which is also simulated).
    console.log('[TODO_PROD] Initializing simulated price socket.');
    setInterval(async () => { // Made async to await getCurrentPrice
      try {
        const price = await this.getCurrentPrice(); // getCurrentPrice is async
        this.priceCallbacks.forEach(callback => callback(price));
      } catch (error) {
        console.error('Error in simulated price socket update:', error);
      }
    }, 5000); // Update every 5 seconds
  }
}

export const tradingService = TradingService.getInstance();