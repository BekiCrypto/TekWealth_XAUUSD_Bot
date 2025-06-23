import React, { useState, useEffect } from 'react';
import { 
  Play, 
  Pause, 
  Activity, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Settings,
  BarChart3
} from 'lucide-react';
import { tradingEngine } from '../services/tradingEngine';

export function TradingEngineControl() {
  const [engineStatus, setEngineStatus] = useState({
    running: false,
    activeSessions: 0,
    lastPriceUpdate: null,
    marketData: {}
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Update status every 5 seconds
    const interval = setInterval(() => {
      const status = tradingEngine.getEngineStatus();
      setEngineStatus(status);
    }, 5000);

    // Initial status check
    const status = tradingEngine.getEngineStatus();
    setEngineStatus(status);

    return () => clearInterval(interval);
  }, []);

  const handleEngineToggle = async () => {
    setLoading(true);
    try {
      if (engineStatus.running) {
        await tradingEngine.stopEngine();
      } else {
        await tradingEngine.startEngine();
      }
      
      // Update status immediately
      setTimeout(() => {
        const status = tradingEngine.getEngineStatus();
        setEngineStatus(status);
      }, 1000);
    } catch (error) {
      console.error('Error toggling engine:', error);
    } finally {
      setLoading(false);
    }
  };

  const currentPrice = engineStatus.marketData?.XAUUSD ? 
    ((engineStatus.marketData.XAUUSD.bid + engineStatus.marketData.XAUUSD.ask) / 2).toFixed(2) : 
    '2045.00';

  return (
    <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-yellow-400" />
          <h2 className="text-xl font-semibold text-white">Trading Engine</h2>
        </div>
        
        <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${
          engineStatus.running 
            ? 'bg-green-500/20 border border-green-500/30' 
            : 'bg-red-500/20 border border-red-500/30'
        }`}>
          <div className={`w-2 h-2 rounded-full ${
            engineStatus.running ? 'bg-green-400' : 'bg-red-400'
          }`}></div>
          <span className={`text-sm font-medium ${
            engineStatus.running ? 'text-green-400' : 'text-red-400'
          }`}>
            {engineStatus.running ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Engine Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-gray-400">XAUUSD Price</span>
          </div>
          <div className="text-lg font-bold text-white">${currentPrice}</div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-gray-400">Active Sessions</span>
          </div>
          <div className="text-lg font-bold text-white">{engineStatus.activeSessions}</div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-green-400" />
            <span className="text-sm text-gray-400">Spread</span>
          </div>
          <div className="text-lg font-bold text-white">
            {engineStatus.marketData?.XAUUSD?.spread?.toFixed(1) || '0.3'}
          </div>
        </div>

        <div className="bg-gray-800/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-gray-400">Last Update</span>
          </div>
          <div className="text-sm font-medium text-white">
            {engineStatus.lastPriceUpdate ? 
              new Date(engineStatus.lastPriceUpdate).toLocaleTimeString() : 
              'Never'
            }
          </div>
        </div>
      </div>

      {/* Engine Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleEngineToggle}
          disabled={loading}
          className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all disabled:opacity-50 ${
            engineStatus.running 
              ? 'bg-red-500 hover:bg-red-600 text-white' 
              : 'bg-green-500 hover:bg-green-600 text-white'
          }`}
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : engineStatus.running ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5" />
          )}
          {loading ? 'Processing...' : engineStatus.running ? 'Stop Engine' : 'Start Engine'}
        </button>

        <button className="flex items-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors">
          <Settings className="w-5 h-5" />
          Engine Settings
        </button>
      </div>

      {/* Status Messages */}
      {engineStatus.running && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">
              Trading engine is active and monitoring {engineStatus.activeSessions} session(s)
            </span>
          </div>
        </div>
      )}

      {!engineStatus.running && (
        <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">
              Trading engine is stopped. No automated trading is occurring.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}