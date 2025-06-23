import React, { useState, useEffect, useCallback } from 'react';
import { tradingService, StrategyParams, BotSession as BotSessionType } from '../services/tradingService';
import { useAuth } from '../hooks/useAuth';
import { Bot, Play, /* Pause, Settings, AlertTriangle, CheckCircle, TrendingUp, Shield, Zap, */ PlusCircle, XCircle, RefreshCw, /* Activity */ } from 'lucide-react'; // Removed unused icons
import { toast } from 'sonner'; // Import toast

// Define a more specific type for the form state within this component
interface NewSessionConfig {
  tradingAccountId: string;
  riskLevel: 'conservative' | 'medium' | 'risky';
  strategySelectionMode: 'ADAPTIVE' | 'SMA_ONLY' | 'MEAN_REVERSION_ONLY' | 'BREAKOUT_ONLY';
  strategyParams: Partial<StrategyParams>; // Use Partial for form state, ensure all defaults for submission
}

// Define a type for Trading Accounts fetched for the dropdown
type TradingAccountSimple = {
  id: string;
  server_name: string;
  login_id: string;
  platform: string;
};

// Type for displaying recent trades
type DisplayTrade = {
    id: string;
    time: string;
    action: string;
    symbol: string;
    lots: number;
    price: number;
    pnl?: string | number;
    status?: string;
};


export function TradingBot() {
  const { user } = useAuth();
  const [activeBotSessions, setActiveBotSessions] = useState<BotSessionType[]>([]);
  const [tradingAccounts, setTradingAccounts] = useState<TradingAccountSimple[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState<string | null>(null); // Store ID of session being stopped
  const [error, setError] = useState<string | null>(null);

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [newSessionConfig, setNewSessionConfig] = useState<NewSessionConfig>({
    tradingAccountId: '',
    riskLevel: 'medium',
    strategySelectionMode: 'ADAPTIVE',
    strategyParams: { // Provide comprehensive defaults
      smaShortPeriod: 20, smaLongPeriod: 50,
      bbPeriod: 20, bbStdDevMult: 2,
      rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
      adxPeriod: 14, adxTrendMinLevel: 25, adxRangeThreshold: 20, adxTrendThreshold: 25,
      atrPeriod: 14, atrMultiplierSL: 1.5, atrMultiplierTP: 3.0,
      breakoutLookbackPeriod: 50, atrSpikeMultiplier: 1.5,
    },
  });

  const [liveBotStats, setLiveBotStats] = useState<any>({ tradesToday: 0, successRate: '0%', profitToday: '$0.00', openPositions: 0 });
  const [recentLiveTrades, setRecentLiveTrades] = useState<DisplayTrade[]>([]);


  const fetchUserTradingData = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const [sessionsRes, accountsRes, tradesRes, openPositionsRes] = await Promise.all([
        tradingService.getActiveUserBotSessions(user.id),
        tradingService.getTradingAccounts(user.id),
        tradingService.getUserTrades(user.id, 10), // Fetch recent 10 trades for activity
        // Assuming first trading account if multiple, or needs selection for stats
        // For now, just an example, ideally this is tied to a selected account or all accounts
        tradingAccounts.length > 0 ? tradingService.listProviderOpenPositions(tradingAccounts[0].id) : Promise.resolve({data: [], error: null}),
      ]);

      if (sessionsRes.error) throw new Error(`Failed to fetch bot sessions: ${sessionsRes.error.message}`);
      setActiveBotSessions(sessionsRes.data || []);

      if (accountsRes.error) throw new Error(`Failed to fetch trading accounts: ${accountsRes.error.message}`);
      const fetchedAccounts = (accountsRes.data as TradingAccountSimple[] || []);
      setTradingAccounts(fetchedAccounts);
      if (fetchedAccounts.length > 0 && !newSessionConfig.tradingAccountId) {
        setNewSessionConfig(prev => ({...prev, tradingAccountId: fetchedAccounts[0].id}));
      }

      if (tradesRes.error) console.error("Error fetching recent trades:", tradesRes.error);
      else {
        const displayTrades: DisplayTrade[] = (tradesRes.data || []).map((t: any) => ({
            id: t.id,
            time: new Date(t.open_time || t.created_at).toLocaleTimeString(),
            action: t.trade_type,
            symbol: t.symbol,
            lots: t.lot_size,
            price: t.open_price,
            pnl: t.profit_loss !== null ? (t.profit_loss >= 0 ? `+$${t.profit_loss.toFixed(2)}` : `-$${Math.abs(t.profit_loss).toFixed(2)}`) : 'N/A',
            status: t.status
        }));
        setRecentLiveTrades(displayTrades);
        // Basic stats calculation (example)
        const todayStr = new Date().toISOString().split('T')[0];
        const tradesToday = displayTrades.filter(t => (t.entryTime || t.time).startsWith(todayStr)).length;
        // More complex P&L and success rate would require more data or backend aggregation
        setLiveBotStats(prev => ({...prev, tradesToday }));
      }

      if(openPositionsRes.error) console.error("Error fetching open positions", openPositionsRes.error);
      else {
        setLiveBotStats(prev => ({...prev, openPositions: (openPositionsRes.data || []).length }));
      }

    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [user, newSessionConfig.tradingAccountId, tradingAccounts]); // Added tradingAccounts to dependency

  useEffect(() => {
    if(user?.id) {
        fetchUserTradingData();
    }
    // Optional: Set up an interval to refresh data periodically
    // const intervalId = setInterval(fetchUserTradingData, 30000); // Refresh every 30s
    // return () => clearInterval(intervalId);
  }, [user, fetchUserTradingData]);


  const handleStartBot = async () => {
    if (!user?.id || !newSessionConfig.tradingAccountId) {
      setError("User or Trading Account not selected.");
      return;
    }
    setIsStartingSession(true); setError(null);
    try {
      const paramsToSubmit = {
        userId: user.id,
        tradingAccountId: newSessionConfig.tradingAccountId,
        riskLevel: newSessionConfig.riskLevel,
        strategySelectionMode: newSessionConfig.strategySelectionMode,
        // Ensure all strategyParams have defaults if not set in UI, or are fully populated
        strategyParams: {
            ...{ // Default structure to ensure all keys exist
                smaShortPeriod: 20, smaLongPeriod: 50,
                bbPeriod: 20, bbStdDevMult: 2,
                rsiPeriod: 14, rsiOversold: 30, rsiOverbought: 70,
                adxPeriod: 14, adxTrendMinLevel: 25, adxRangeThreshold: 20, adxTrendThreshold: 25,
                atrPeriod: 14, atrMultiplierSL: 1.5, atrMultiplierTP: 3.0,
                breakoutLookbackPeriod: 50, atrSpikeMultiplier: 1.5,
            },
            ...newSessionConfig.strategyParams
        } as StrategyParams,
      };
      const response = await tradingService.startBot(paramsToSubmit);
      if (response.error) throw response.error;
      setShowConfigModal(false);
      fetchUserTradingData();
      toast.success("Bot session started successfully!");
    } catch (err: any) {
      const errorMessage = err.message || "Failed to start bot session.";
      setError(errorMessage);
      toast.error(`Error starting bot: ${errorMessage}`);
    } finally {
      setIsStartingSession(false);
    }
  };

  const handleStopBot = async (sessionId: string) => {
    setIsStoppingSession(sessionId); setError(null);
    try {
      const response = await tradingService.stopBot(sessionId);
      if (response.error) throw response.error;
      fetchUserTradingData();
      toast.success("Bot session stopped successfully!");
    } catch (err: any) {
      const errorMessage = err.message || "Failed to stop bot session.";
      setError(errorMessage);
      toast.error(`Error stopping bot: ${errorMessage}`);
    } finally {
      setIsStoppingSession(null);
    }
  };

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const inputType = e.target.type;

    let parsedValue: string | number | undefined = value;
    if (inputType === 'number') {
        parsedValue = value === '' ? undefined : parseFloat(value);
    }

    setNewSessionConfig(prev => {
        const newConfig = JSON.parse(JSON.stringify(prev));

        if (name === 'tradingAccountId' || name === 'riskLevel' || name === 'strategySelectionMode') {
            (newConfig as any)[name] = parsedValue;
        } else { // Assumes all other fields are direct children of strategyParams
            (newConfig.strategyParams as any)[name] = parsedValue;
        }
        return newConfig;
    });
  };

  const renderStrategyParamsInputsModal = (currentStrategyParams: Partial<StrategyParams>) => {
    const inputClass = "w-full bg-gray-700 p-1 rounded text-xs border border-gray-600 focus:border-yellow-500 focus:outline-none";
    const labelClass = "block text-xs text-gray-400";
    const fieldsetWrapperClass = "mt-2 p-3 border border-gray-700 rounded";
    const legendClass = "text-sm font-medium text-gray-300 px-1";

    return (
      <>
        <fieldset className={fieldsetWrapperClass}>
          <legend className={legendClass}>Global ATR (for SL/TP)</legend>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={labelClass}>ATR Period:</label><input type="number" name="atrPeriod" value={currentStrategyParams.atrPeriod ?? 14} onChange={handleConfigChange} className={inputClass} /></div>
            <div><label className={labelClass}>SL Mult:</label><input type="number" step="0.1" name="atrMultiplierSL" value={currentStrategyParams.atrMultiplierSL ?? 1.5} onChange={handleConfigChange} className={inputClass} /></div>
            <div><label className={labelClass}>TP Mult:</label><input type="number" step="0.1" name="atrMultiplierTP" value={currentStrategyParams.atrMultiplierTP ?? 3.0} onChange={handleConfigChange} className={inputClass} /></div>
          </div>
        </fieldset>

        {(newSessionConfig.strategySelectionMode === 'SMA_ONLY' || newSessionConfig.strategySelectionMode === 'ADAPTIVE') && (
          <fieldset className={fieldsetWrapperClass}>
            <legend className={legendClass}>SMA Crossover</legend>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelClass}>SMA Short:</label><input type="number" name="smaShortPeriod" value={currentStrategyParams.smaShortPeriod ?? 20} onChange={handleConfigChange} className={inputClass} /></div>
              <div><label className={labelClass}>SMA Long:</label><input type="number" name="smaLongPeriod" value={currentStrategyParams.smaLongPeriod ?? 50} onChange={handleConfigChange} className={inputClass} /></div>
            </div>
             {(newSessionConfig.strategySelectionMode === 'ADAPTIVE') && <div className="mt-1"><label className={labelClass}>ADX Confirm (SMA):</label><input type="number" name="adxTrendMinLevel" value={currentStrategyParams.adxTrendMinLevel ?? 25} onChange={handleConfigChange} className={inputClass}/></div>}
          </fieldset>
        )}

        {(newSessionConfig.strategySelectionMode === 'MEAN_REVERSION_ONLY' || newSessionConfig.strategySelectionMode === 'ADAPTIVE') && (
          <fieldset className={fieldsetWrapperClass}>
            <legend className={legendClass}>Mean Reversion (BB+RSI)</legend>
             <div className="grid grid-cols-2 gap-2 mb-1">
                <div><label className={labelClass}>BB Period:</label><input type="number" name="bbPeriod" value={currentStrategyParams.bbPeriod ?? 20} onChange={handleConfigChange} className={inputClass} /></div>
                <div><label className={labelClass}>BB StdDev:</label><input type="number" step="0.1" name="bbStdDevMult" value={currentStrategyParams.bbStdDevMult ?? 2} onChange={handleConfigChange} className={inputClass} /></div>
             </div>
             <div className="grid grid-cols-3 gap-2">
                <div><label className={labelClass}>RSI Period:</label><input type="number" name="rsiPeriod" value={currentStrategyParams.rsiPeriod ?? 14} onChange={handleConfigChange} className={inputClass} /></div>
                <div><label className={labelClass}>RSI O/Sold:</label><input type="number" name="rsiOversold" value={currentStrategyParams.rsiOversold ?? 30} onChange={handleConfigChange} className={inputClass} /></div>
                <div><label className={labelClass}>RSI O/Bought:</label><input type="number" name="rsiOverbought" value={currentStrategyParams.rsiOverbought ?? 70} onChange={handleConfigChange} className={inputClass} /></div>
             </div>
          </fieldset>
        )}
        {(newSessionConfig.strategySelectionMode === 'BREAKOUT_ONLY' || newSessionConfig.strategySelectionMode === 'ADAPTIVE') && (
            <fieldset className={fieldsetWrapperClass}>
                <legend className={legendClass}>Breakout</legend>
                <div className="grid grid-cols-2 gap-2">
                    <div><label className={labelClass}>Lookback:</label><input type="number" name="breakoutLookbackPeriod" value={currentStrategyParams.breakoutLookbackPeriod ?? 50} onChange={handleConfigChange} className={inputClass} /></div>
                    <div><label className={labelClass}>ATR Spike Mult:</label><input type="number" step="0.1" name="atrSpikeMultiplier" value={currentStrategyParams.atrSpikeMultiplier ?? 1.5} onChange={handleConfigChange} className={inputClass} /></div>
                </div>
            </fieldset>
        )}
        {newSessionConfig.strategySelectionMode === 'ADAPTIVE' && (
          <fieldset className={fieldsetWrapperClass}>
            <legend className={legendClass}>Adaptive Regime (ADX)</legend>
            <div className="grid grid-cols-3 gap-2">
                <div><label className={labelClass}>ADX Period:</label><input type="number" name="adxPeriod" value={currentStrategyParams.adxPeriod ?? 14} onChange={handleConfigChange} className={inputClass} /></div>
                <div><label className={labelClass}>Range Thresh:</label><input type="number" name="adxRangeThreshold" value={currentStrategyParams.adxRangeThreshold ?? 20} onChange={handleConfigChange} className={inputClass} /></div>
                <div><label className={labelClass}>Trend Thresh:</label><input type="number" name="adxTrendThreshold" value={currentStrategyParams.adxTrendThreshold ?? 25} onChange={handleConfigChange} className={inputClass} /></div>
            </div>
          </fieldset>
        )}
      </>
    );
  };


  if (isLoading && activeBotSessions.length === 0) return <div className="p-8 text-white animate-pulse">Loading trading bot data...</div>;


  return (
    <div className="p-8 text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Bot className="w-10 h-10 text-yellow-400" />
          <div>
            <h1 className="text-3xl font-bold">Trading Bot Control</h1>
            <p className="text-gray-400">Manage your automated XAUUSD trading system</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
            <button onClick={fetchUserTradingData} disabled={isLoading} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50">
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
                onClick={() => setShowConfigModal(true)}
                className="flex items-center gap-2 px-6 py-3 rounded-lg font-medium bg-yellow-500 hover:bg-yellow-600 text-gray-900 transition-all"
            >
                <PlusCircle className="w-5 h-5" />
                Start New Bot Session
            </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg">{error}</div>}

      {/* Active Bot Sessions */}
      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Active Bot Sessions</h2>
        {activeBotSessions.length === 0 && !isLoading && <p className="text-gray-400">No active bot sessions. Click "Start New Bot Session" to create one.</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {activeBotSessions.map(session => (
            <div key={session.id} className="bg-gray-800/70 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-xl">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-xs text-gray-400">Session ID: {session.id.substring(0,8)}...</p>
                  <h3 className="text-lg font-semibold text-yellow-400">
                    {session.trading_accounts?.server_name || session.trading_account_id.substring(0,8)+'...'} ({session.trading_accounts?.platform || 'N/A'})
                  </h3>
                </div>
                <span className="px-3 py-1 text-xs font-semibold bg-green-500/20 text-green-400 rounded-full">Active</span>
              </div>
              <div className="text-sm space-y-1 text-gray-300 mb-4">
                <p><strong>Risk Level:</strong> <span className="capitalize">{session.risk_level}</span></p>
                <p><strong>Strategy:</strong> <span className="capitalize">{(session.strategy_selection_mode || 'N/A').replace(/_/g, ' ')}</span></p>
                <p className="text-xs text-gray-500">Started: {new Date(session.session_start || '').toLocaleString()}</p>
                {/* Consider showing a summary of key strategy_params here if concise */}
              </div>
              <button
                onClick={() => handleStopBot(session.id)}
                disabled={isStoppingSession === session.id}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium bg-red-600 hover:bg-red-700 text-white transition-all disabled:opacity-50"
              >
                {isStoppingSession === session.id ? <RefreshCw className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5" />}
                {isStoppingSession === session.id ? 'Stopping...' : 'Stop Bot'}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Live Stats & Recent Trades */}
      <div className="grid lg:grid-cols-3 gap-8 mt-12">
        <div className="lg:col-span-1 bg-gray-800/70 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-white mb-4">Live Bot Stats</h2>
            <div className="space-y-2 text-gray-300">
                <p>Trades Today: <span className="font-semibold text-white">{liveBotStats.tradesToday}</span></p>
                <p>Open Positions: <span className="font-semibold text-white">{liveBotStats.openPositions}</span></p>
                <p>Success Rate (Overall): <span className="font-semibold text-white">{liveBotStats.successRate}</span></p>
                <p>Profit Today: <span className={`font-semibold ${liveBotStats.profitToday?.startsWith('+$') ? 'text-green-400' : 'text-red-400'}`}>{liveBotStats.profitToday}</span></p>
                 <p className="text-xs text-gray-500 mt-2">(Stats are indicative and update periodically. Detailed P&L on Dashboard.)</p>
            </div>
        </div>
        <div className="lg:col-span-2 bg-gray-800/70 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-xl">
          <h2 className="text-xl font-semibold text-white mb-6">Recent Bot Activity (Last 10)</h2>
          {recentLiveTrades.length === 0 && <p className="text-gray-400">No recent bot trades to display.</p>}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {recentLiveTrades.map((trade) => (
              <div key={trade.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="text-gray-400 text-xs font-mono">{trade.time}</div>
                  <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                    trade.action === 'BUY' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>
                    {trade.action}
                  </div>
                  <div className="text-white text-sm font-medium">{trade.symbol}</div>
                  <div className="text-gray-400 text-xs">{trade.lots} lots @ {trade.price}</div>
                </div>
                <div className={`text-xs font-semibold ${trade.pnl?.startsWith('+$') ? 'text-green-400' : trade.pnl?.startsWith('-$') ? 'text-red-400' : 'text-gray-300'}`}>
                    {trade.status === 'open' ? 'OPEN' : trade.pnl}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* New Bot Session Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 p-6 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-white">Start New Bot Session</h2>
              <button onClick={() => setShowConfigModal(false)} className="text-gray-400 hover:text-white">
                <XCircle className="w-7 h-7" />
              </button>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Trading Account:</label>
                <select name="tradingAccountId" value={newSessionConfig.tradingAccountId} onChange={handleConfigChange} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-white focus:border-yellow-500 focus:outline-none">
                  <option value="">Select Account</option>
                  {tradingAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.server_name} ({acc.login_id}) - {acc.platform}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Base Risk Level (for Lot Size):</label>
                <select name="riskLevel" value={newSessionConfig.riskLevel} onChange={handleConfigChange} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-white focus:border-yellow-500 focus:outline-none">
                  <option value="conservative">Conservative</option>
                  <option value="medium">Medium</option>
                  <option value="risky">Risky</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">Strategy Selection Mode:</label>
                <select name="strategySelectionMode" value={newSessionConfig.strategySelectionMode} onChange={handleConfigChange} className="w-full bg-gray-700 p-2 rounded border border-gray-600 text-white focus:border-yellow-500 focus:outline-none">
                  <option value="ADAPTIVE">Adaptive (Regime Switching)</option>
                  <option value="SMA_ONLY">SMA Crossover Only</option>
                  <option value="MEAN_REVERSION_ONLY">Mean Reversion Only</option>
                  <option value="BREAKOUT_ONLY">Breakout Only</option>
                </select>
              </div>

              <div className="text-gray-300 font-medium mt-3 mb-1">Strategy Parameters:</div>
              {renderStrategyParamsInputsModal(newSessionConfig.strategyParams)}

            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button onClick={() => setShowConfigModal(false)} className="px-5 py-2.5 rounded-lg bg-gray-600 hover:bg-gray-500 text-white font-medium transition-colors">Cancel</button>
              <button
                onClick={handleStartBot}
                disabled={isStartingSession || !newSessionConfig.tradingAccountId}
                className="px-5 py-2.5 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-medium transition-colors disabled:opacity-60"
              >
                {isStartingSession ? <RefreshCw className="w-5 h-5 animate-spin inline mr-2" /> : <Play className="w-5 h-5 inline mr-2" />}
                {isStartingSession ? 'Starting...' : 'Start Bot'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}