import React, { useState } from 'react';
import { 
  Bot, 
  Play, 
  Pause, 
  Settings, 
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Shield,
  Zap
} from 'lucide-react';

export function TradingBot() {
  const [botActive, setBotActive] = useState(true);
  const [riskLevel, setRiskLevel] = useState('medium');

  const botStats = [
    { label: 'Trades Today', value: '12', color: 'blue' },
    { label: 'Success Rate', value: '91.7%', color: 'green' },
    { label: 'Profit Today', value: '+$423.50', color: 'green' },
    { label: 'Max Drawdown', value: '2.1%', color: 'yellow' }
  ];

  const recentTrades = [
    {
      id: 1,
      time: '14:23:15',
      action: 'BUY',
      symbol: 'XAUUSD',
      lots: 0.5,
      price: 2045.23,
      result: 'profit',
      pnl: '+$89.50'
    },
    {
      id: 2,
      time: '14:18:42',
      action: 'SELL',
      symbol: 'XAUUSD',
      lots: 0.3,
      price: 2047.80,
      result: 'profit',
      pnl: '+$45.20'
    },
    {
      id: 3,
      time: '14:12:33',
      action: 'BUY',
      symbol: 'XAUUSD',
      lots: 0.7,
      price: 2044.55,
      result: 'loss',
      pnl: '-$28.30'
    },
    {
      id: 4,
      time: '14:05:12',
      action: 'SELL',
      symbol: 'XAUUSD',
      lots: 0.4,
      price: 2048.90,
      result: 'profit',
      pnl: '+$67.80'
    }
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <Bot className="w-8 h-8 text-yellow-400" />
          <div>
            <h1 className="text-3xl font-bold text-white">Trading Bot Control</h1>
            <p className="text-gray-400">Manage your automated gold trading system</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            botActive 
              ? 'bg-green-500/20 border border-green-500/30' 
              : 'bg-red-500/20 border border-red-500/30'
          }`}>
            <div className={`w-3 h-3 rounded-full ${botActive ? 'bg-green-400' : 'bg-red-400'}`}></div>
            <span className={`font-medium ${botActive ? 'text-green-400' : 'text-red-400'}`}>
              {botActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          
          <button
            onClick={() => setBotActive(!botActive)}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium transition-all ${
              botActive 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
          >
            {botActive ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            {botActive ? 'Stop Bot' : 'Start Bot'}
          </button>
        </div>
      </div>

      {/* Bot Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {botStats.map((stat, index) => {
          const colorClasses = {
            blue: 'from-blue-500 to-blue-600',
            green: 'from-green-500 to-green-600',
            yellow: 'from-yellow-500 to-yellow-600'
          };

          return (
            <div key={index} className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[stat.color]} rounded-lg flex items-center justify-center mb-4`}>
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">{stat.value}</h3>
              <p className="text-gray-400 text-sm">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Bot Configuration */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Settings className="w-6 h-6 text-yellow-400" />
            <h2 className="text-xl font-semibold text-white">Bot Configuration</h2>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Risk Level</label>
              <div className="space-y-2">
                {[
                  { id: 'conservative', label: 'Conservative', icon: Shield, desc: 'Low risk, steady returns' },
                  { id: 'medium', label: 'Medium', icon: TrendingUp, desc: 'Balanced approach' },
                  { id: 'risky', label: 'Risky', icon: Zap, desc: 'High risk, high reward' }
                ].map((option) => {
                  const Icon = option.icon;
                  return (
                    <label key={option.id} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-800">
                      <input
                        type="radio"
                        name="riskLevel"
                        value={option.id}
                        checked={riskLevel === option.id}
                        onChange={(e) => setRiskLevel(e.target.value)}
                        className="text-yellow-500"
                      />
                      <Icon className="w-5 h-5 text-gray-400" />
                      <div>
                        <div className="text-white font-medium">{option.label}</div>
                        <div className="text-gray-400 text-sm">{option.desc}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Max Daily Loss</label>
              <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white">
                <option>5% of balance</option>
                <option>10% of balance</option>
                <option>15% of balance</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Position Size</label>
              <select className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white">
                <option>Auto (Recommended)</option>
                <option>Fixed 0.1 lots</option>
                <option>Fixed 0.5 lots</option>
                <option>Fixed 1.0 lots</option>
              </select>
            </div>
          </div>
        </div>

        {/* Recent Bot Activity */}
        <div className="lg:col-span-2 bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Recent Bot Activity</h2>
          
          <div className="space-y-3">
            {recentTrades.map((trade) => (
              <div key={trade.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="text-gray-400 text-sm font-mono">{trade.time}</div>
                  <div className={`px-2 py-1 rounded text-sm font-medium ${
                    trade.action === 'BUY' 
                      ? 'bg-green-500/20 text-green-400' 
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {trade.action}
                  </div>
                  <div className="text-white font-medium">{trade.symbol}</div>
                  <div className="text-gray-400">{trade.lots} lots @ {trade.price}</div>
                </div>
                
                <div className="flex items-center gap-3">
                  <span className={`font-semibold ${
                    trade.result === 'profit' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {trade.pnl}
                  </span>
                  {trade.result === 'profit' ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}