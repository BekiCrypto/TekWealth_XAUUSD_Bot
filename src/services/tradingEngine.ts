import { supabase } from '../lib/supabase';
import { Database } from '../types/database';
import { notificationService } from './notificationService';

type TradingAccount = Database['public']['Tables']['trading_accounts']['Row'];
type Trade = Database['public']['Tables']['trades']['Row'];
type BotSession = Database['public']['Tables']['bot_sessions']['Row'];

interface MarketData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: Date;
}

// IMPORTANT: This TradingEngine class runs on the client-side.
// For a real financial application, core trading logic, real-time data processing,
// and order execution should be handled by a secure, reliable server-side system.
// This client-side engine is suitable for simulation, UI demonstration, or if
// it's designed to communicate with a robust backend that handles actual trading.

interface TradingSignal {
  action: 'BUY' | 'SELL' | 'CLOSE' | 'HOLD';
  confidence: number;
  stopLoss?: number;
  takeProfit?: number;
  lotSize?: number;
  reason: string;
}

interface RiskParameters {
  maxLotSize: number;
  maxDailyTrades: number;
  maxDailyLoss: number;
  stopLossPoints: number;
  takeProfitPoints: number;
  maxDrawdown: number;
}

export class TradingEngine {
  private static instance: TradingEngine;
  private marketData: Map<string, MarketData> = new Map();
  private activeSessions: Map<string, BotSession> = new Map();
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private engineRunning = false;

  static getInstance(): TradingEngine {
    if (!TradingEngine.instance) {
      TradingEngine.instance = new TradingEngine();
    }
    return TradingEngine.instance;
  }

  // Engine Control
  async startEngine() {
    if (this.engineRunning) return;
    
    console.log('🚀 Starting Trading Engine...');
    this.engineRunning = true;
    
    // Load active bot sessions
    await this.loadActiveSessions();
    
    // Start price feed
    this.startPriceFeed();
    
    // Start main trading loop
    this.startTradingLoop();
    
    console.log('✅ Trading Engine started successfully');
  }

  async stopEngine() {
    if (!this.engineRunning) return;
    
    console.log('🛑 Stopping Trading Engine...');
    this.engineRunning = false;
    
    // Stop price feed
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
      this.priceUpdateInterval = null;
    }
    
    // Close all open positions safely
    await this.emergencyCloseAllPositions();
    
    console.log('✅ Trading Engine stopped safely');
  }

  // Market Data Management
  private startPriceFeed() {
    this.priceUpdateInterval = setInterval(async () => {
      await this.updateMarketData();
    }, 1000); // Update every second
  }

  private async updateMarketData() {
    try {
      // TODO: PRODUCTION - Replace with actual real-time price feed (e.g., WebSocket).
      // This is a simulated price feed.
      const basePrice = 2045; // Simulated base price for XAUUSD
      const volatility = 0.5; // Simulated price movement range
      const spread = 0.3;     // Simulated spread
      
      const randomFactor = (Math.random() - 0.5) * 2; // Generates a random number between -1 and 1
      const price = basePrice + (randomFactor * volatility);
      
      const currentMarketData: MarketData = {
        symbol: 'XAUUSD',
        bid: parseFloat((price - spread / 2).toFixed(2)), // Ensure two decimal places for currency
        ask: parseFloat((price + spread / 2).toFixed(2)), // Ensure two decimal places
        spread: parseFloat(spread.toFixed(2)),
        timestamp: new Date()
      };

      this.marketData.set('XAUUSD', currentMarketData);

      // Store price data in database (optional for client-side simulation, could be noisy)
      // Consider if this is essential for the client-side engine's operation or if it's for historical logging.
      // For a pure client-side simulation, storing every tick might be excessive.
      // await this.storePriceData(currentMarketData);

      // Analyze market for all active sessions based on the new market data
      await this.analyzeMarketForAllSessions();

    } catch (error) {
      console.error('Error in updateMarketData:', error);
    }
  }

  private async storePriceData(data: MarketData) {
    // This function stores the simulated price data.
    // For a production system with a real price feed, this might be handled by a server-side data ingestion service.
    const price = parseFloat(((data.bid + data.ask) / 2).toFixed(2));
    
    const { error } = await supabase.from('price_data').insert({
      symbol: data.symbol,
      timestamp: data.timestamp.toISOString(),
      open_price: price, // For tick data, open, high, low, close might all be the same.
      high_price: price, // Adjust if aggregating into candles (e.g., 1m, 5m).
      low_price: price,
      close_price: price,
      volume: Math.floor(Math.random() * 1000), // Simulated volume
      timeframe: 'tick' // Indicate this is tick data, or aggregate to '1m' etc.
    });
    if (error) {
      console.warn('Error storing price data (simulation):', error.message); // Downgrade to warn as it's sim data
    }
  }

  // Trading Logic
  private async startTradingLoop() {
    console.log('Trading loop initiated.');
    const tradingLoop = async () => {
      if (!this.engineRunning) {
        console.log('Trading engine stopped, exiting trading loop.');
        return;
      }

      try {
        // Process all active sessions
        for (const [_sessionId, session] of this.activeSessions) { // Use _sessionId if not directly used
          await this.processSession(session);
        }

        // Check for position management (SL/TP hits)
        await this.manageOpenPositions();

      } catch (error) {
        console.error('Critical error in trading loop:', error);
        // Consider more robust error handling here, e.g., pausing specific sessions or the engine
        // if errors are persistent.
      } finally {
        // Schedule next iteration regardless of error, but ensure engine is still running.
        if (this.engineRunning) {
          setTimeout(tradingLoop, 5000); // Run every 5 seconds
        }
      }
    };

    // Start the first iteration.
    setTimeout(tradingLoop, 5000); // Initial delay before first run
  }

  private async processSession(session: BotSession) {
    try {
      // Get risk parameters for this session
      const riskParams = this.getRiskParameters(session.risk_level);
      
      // Check daily limits
      const dailyStats = await this.getDailyStats(session.user_id);
      if (dailyStats.trades >= riskParams.maxDailyTrades) {
        return; // Daily trade limit reached
      }

      if (dailyStats.loss >= riskParams.maxDailyLoss) {
        await this.pauseSession(session.id, 'Daily loss limit reached');
        return;
      }

      // Get trading signal
      const signal = await this.generateTradingSignal(session);
      
      if (signal.action === 'BUY' || signal.action === 'SELL') {
        await this.executeTrade(session, signal, riskParams);
      }

    } catch (error) {
      console.error(`Error processing session ${session.id}:`, error);
    }
  }

  private async generateTradingSignal(session: BotSession): Promise<TradingSignal> {
    const marketData = this.marketData.get('XAUUSD');
    if (!marketData) {
      return { action: 'HOLD', confidence: 0, reason: 'No market data' };
    }

    // Get recent price history for analysis
    const { data: priceHistory } = await supabase
      .from('price_data')
      .select('*')
      .eq('symbol', 'XAUUSD')
      .order('timestamp', { ascending: false })
      .limit(20);

    if (!priceHistory || priceHistory.length < 10) {
      return { action: 'HOLD', confidence: 0, reason: 'Insufficient price history' };
    }

    // Technical Analysis
    const prices = priceHistory.map(p => p.close_price);
    const sma5 = this.calculateSMA(prices, 5);
    const sma10 = this.calculateSMA(prices, 10);
    const rsi = this.calculateRSI(prices, 14);
    
    // Trading logic based on risk level
    const signal = this.analyzeSignals(session.risk_level, {
      currentPrice: (marketData.bid + marketData.ask) / 2,
      sma5,
      sma10,
      rsi,
      spread: marketData.spread
    });

    return signal;
  }

  private analyzeSignals(riskLevel: string, indicators: any): TradingSignal {
    const { currentPrice, sma5, sma10, rsi, spread } = indicators;
    
    // Conservative strategy
    if (riskLevel === 'conservative') {
      if (sma5 > sma10 && rsi < 30 && spread < 0.5) {
        return {
          action: 'BUY',
          confidence: 0.7,
          stopLoss: currentPrice - 10,
          takeProfit: currentPrice + 15,
          lotSize: 0.1,
          reason: 'Conservative bullish signal'
        };
      }
      if (sma5 < sma10 && rsi > 70 && spread < 0.5) {
        return {
          action: 'SELL',
          confidence: 0.7,
          stopLoss: currentPrice + 10,
          takeProfit: currentPrice - 15,
          lotSize: 0.1,
          reason: 'Conservative bearish signal'
        };
      }
    }
    
    // Medium risk strategy
    else if (riskLevel === 'medium') {
      if (sma5 > sma10 && rsi < 40) {
        return {
          action: 'BUY',
          confidence: 0.8,
          stopLoss: currentPrice - 20,
          takeProfit: currentPrice + 30,
          lotSize: 0.3,
          reason: 'Medium risk bullish signal'
        };
      }
      if (sma5 < sma10 && rsi > 60) {
        return {
          action: 'SELL',
          confidence: 0.8,
          stopLoss: currentPrice + 20,
          takeProfit: currentPrice - 30,
          lotSize: 0.3,
          reason: 'Medium risk bearish signal'
        };
      }
    }
    
    // Risky strategy
    else if (riskLevel === 'risky') {
      if (sma5 > sma10) {
        return {
          action: 'BUY',
          confidence: 0.9,
          stopLoss: currentPrice - 30,
          takeProfit: currentPrice + 50,
          lotSize: 0.5,
          reason: 'High risk bullish signal'
        };
      }
      if (sma5 < sma10) {
        return {
          action: 'SELL',
          confidence: 0.9,
          stopLoss: currentPrice + 30,
          takeProfit: currentPrice - 50,
          lotSize: 0.5,
          reason: 'High risk bearish signal'
        };
      }
    }

    return { action: 'HOLD', confidence: 0, reason: 'No clear signal' };
  }

  private async executeTrade(session: BotSession, signal: TradingSignal, riskParams: RiskParameters) {
    try {
      const marketData = this.marketData.get('XAUUSD');
      if (!marketData) return;

      const price = signal.action === 'BUY' ? marketData.ask : marketData.bid;
      const lotSize = Math.min(signal.lotSize || 0.1, riskParams.maxLotSize);

      // Create trade record
      const { data: trade, error } = await supabase
        .from('trades')
        .insert({
          user_id: session.user_id,
          trading_account_id: session.trading_account_id,
          ticket_id: this.generateTicketId(),
          symbol: 'XAUUSD',
          trade_type: signal.action,
          lot_size: lotSize,
          open_price: price,
          stop_loss: signal.stopLoss,
          take_profit: signal.takeProfit,
          status: 'open'
        })
        .select()
        .single();

      if (error) throw error;

      // Update session statistics
      await this.updateSessionStats(session.id, {
        total_trades: session.total_trades + 1
      });

      // Send notification
      await notificationService.createNotification({
        userId: session.user_id,
        type: 'trade_alert',
        title: 'Trade Executed',
        message: `${signal.action} ${lotSize} lots of XAUUSD at $${price.toFixed(2)} - ${signal.reason}`
      });

      console.log(`✅ Trade executed: ${signal.action} ${lotSize} lots at ${price}`);

    } catch (error) {
      console.error('Error executing trade:', error);
    }
  }

  // Position Management
  private async manageOpenPositions() {
    try {
      const { data: openTrades } = await supabase
        .from('trades')
        .select('*')
        .eq('status', 'open');

      if (!openTrades) return;

      const marketData = this.marketData.get('XAUUSD');
      if (!marketData) return;

      for (const trade of openTrades) {
        await this.checkTradeExit(trade, marketData);
      }

    } catch (error) {
      console.error('Error managing positions:', error);
    }
  }

  private async checkTradeExit(trade: Trade, marketData: MarketData) {
    const currentPrice = trade.trade_type === 'BUY' ? marketData.bid : marketData.ask;
    let shouldClose = false;
    let closeReason = '';

    // Check stop loss
    if (trade.stop_loss) {
      if (trade.trade_type === 'BUY' && currentPrice <= trade.stop_loss) {
        shouldClose = true;
        closeReason = 'Stop loss hit';
      } else if (trade.trade_type === 'SELL' && currentPrice >= trade.stop_loss) {
        shouldClose = true;
        closeReason = 'Stop loss hit';
      }
    }

    // Check take profit
    if (trade.take_profit && !shouldClose) {
      if (trade.trade_type === 'BUY' && currentPrice >= trade.take_profit) {
        shouldClose = true;
        closeReason = 'Take profit hit';
      } else if (trade.trade_type === 'SELL' && currentPrice <= trade.take_profit) {
        shouldClose = true;
        closeReason = 'Take profit hit';
      }
    }

    // Check time-based exit (optional)
    const tradeAge = Date.now() - new Date(trade.open_time).getTime();
    const maxTradeTime = 24 * 60 * 60 * 1000; // 24 hours
    if (tradeAge > maxTradeTime && !shouldClose) {
      shouldClose = true;
      closeReason = 'Time-based exit';
    }

    if (shouldClose) {
      await this.closeTrade(trade.id, currentPrice, closeReason);
    }
  }

  private async closeTrade(tradeId: string, closePrice: number, reason: string) {
    try {
      const { data: trade, error: fetchError } = await supabase
        .from('trades')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (fetchError || !trade) return;

      const profitLoss = this.calculateProfitLoss(trade, closePrice);

      const { error } = await supabase
        .from('trades')
        .update({
          close_price: closePrice,
          profit_loss: profitLoss,
          status: 'closed',
          close_time: new Date().toISOString()
        })
        .eq('id', tradeId);

      if (error) throw error;

      // Update session statistics
      const session = this.activeSessions.get(trade.trading_account_id);
      if (session) {
        const isWinning = profitLoss > 0;
        await this.updateSessionStats(session.id, {
          winning_trades: session.winning_trades + (isWinning ? 1 : 0),
          losing_trades: session.losing_trades + (isWinning ? 0 : 1),
          total_profit: session.total_profit + profitLoss
        });
      }

      // Send notification
      await notificationService.createNotification({
        userId: trade.user_id,
        type: 'trade_alert',
        title: 'Trade Closed',
        message: `Trade closed: ${profitLoss >= 0 ? 'Profit' : 'Loss'} $${Math.abs(profitLoss).toFixed(2)} - ${reason}`
      });

      console.log(`✅ Trade closed: ${reason}, P&L: $${profitLoss.toFixed(2)}`);

    } catch (error) {
      console.error('Error closing trade:', error);
    }
  }

  // Utility Methods
  private calculateSMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[0] || 0;
    const sum = prices.slice(0, period).reduce((a, b) => a + b, 0);
    return sum / period;
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const change = prices[i - 1] - prices[i];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateProfitLoss(trade: Trade, closePrice: number): number {
    const priceDiff = trade.trade_type === 'BUY' 
      ? closePrice - trade.open_price
      : trade.open_price - closePrice;
    
    // Gold trading: $1 per pip per 0.01 lot
    return priceDiff * trade.lot_size * 100;
  }

  private getRiskParameters(riskLevel: string): RiskParameters {
    const params = {
      conservative: {
        maxLotSize: 0.1,
        maxDailyTrades: 5,
        maxDailyLoss: 100,
        stopLossPoints: 10,
        takeProfitPoints: 15,
        maxDrawdown: 5
      },
      medium: {
        maxLotSize: 0.3,
        maxDailyTrades: 10,
        maxDailyLoss: 300,
        stopLossPoints: 20,
        takeProfitPoints: 30,
        maxDrawdown: 10
      },
      risky: {
        maxLotSize: 0.5,
        maxDailyTrades: 20,
        maxDailyLoss: 500,
        stopLossPoints: 30,
        takeProfitPoints: 50,
        maxDrawdown: 20
      }
    };

    return params[riskLevel] || params.medium;
  }

  private async getDailyStats(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    
    const { data: trades } = await supabase
      .from('trades')
      .select('profit_loss')
      .eq('user_id', userId)
      .gte('created_at', today + 'T00:00:00.000Z')
      .lt('created_at', today + 'T23:59:59.999Z');

    const totalTrades = trades?.length || 0;
    const totalLoss = trades?.reduce((sum, t) => {
      const pnl = t.profit_loss || 0;
      return sum + (pnl < 0 ? Math.abs(pnl) : 0);
    }, 0) || 0;

    return { trades: totalTrades, loss: totalLoss };
  }

  private async loadActiveSessions() {
    const { data: sessions } = await supabase
      .from('bot_sessions')
      .select('*')
      .eq('status', 'active');

    if (sessions) {
      sessions.forEach(session => {
        this.activeSessions.set(session.id, session);
      });
    }
  }

  private async updateSessionStats(sessionId: string, updates: Partial<BotSession>) {
    await supabase
      .from('bot_sessions')
      .update(updates)
      .eq('id', sessionId);

    // Update local cache
    const session = this.activeSessions.get(sessionId);
    if (session) {
      this.activeSessions.set(sessionId, { ...session, ...updates });
    }
  }

  private async pauseSession(sessionId: string, reason: string) {
    await supabase
      .from('bot_sessions')
      .update({ status: 'stopped', session_end: new Date().toISOString() })
      .eq('id', sessionId);

    this.activeSessions.delete(sessionId);
    console.log(`⏸️ Session ${sessionId} paused: ${reason}`);
  }

  private async emergencyCloseAllPositions() {
    const { data: openTrades } = await supabase
      .from('trades')
      .select('*')
      .eq('status', 'open');

    if (openTrades) {
      const marketData = this.marketData.get('XAUUSD');
      const emergencyPrice = marketData ? (marketData.bid + marketData.ask) / 2 : 2045;

      for (const trade of openTrades) {
        await this.closeTrade(trade.id, emergencyPrice, 'Emergency closure');
      }
    }
  }

  private generateTicketId(): string {
    return Date.now().toString() + Math.random().toString(36).substr(2, 9);
  }

  // Public API
  async addSession(sessionData: {
    userId: string;
    tradingAccountId: string;
    riskLevel: 'conservative' | 'medium' | 'risky';
    settings: any;
  }) {
    const { data: session, error } = await supabase
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

    if (!error && session) {
      this.activeSessions.set(session.id, session);
    }

    return { data: session, error };
  }

  async removeSession(sessionId: string) {
    await supabase
      .from('bot_sessions')
      .update({ status: 'stopped', session_end: new Date().toISOString() })
      .eq('id', sessionId);

    this.activeSessions.delete(sessionId);
  }

  getCurrentPrice(symbol: string = 'XAUUSD'): number {
    const data = this.marketData.get(symbol);
    return data ? (data.bid + data.ask) / 2 : 2045;
  }

  getEngineStatus() {
    return {
      running: this.engineRunning,
      activeSessions: this.activeSessions.size,
      lastPriceUpdate: this.marketData.get('XAUUSD')?.timestamp,
      marketData: Object.fromEntries(this.marketData)
    };
  }
}

export const tradingEngine = TradingEngine.getInstance();