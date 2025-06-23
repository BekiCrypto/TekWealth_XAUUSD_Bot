import React from 'react';
import { 
  Cpu, 
  Activity, 
  BarChart3, 
  Settings,
  AlertTriangle,
  CheckCircle,
  Zap
} from 'lucide-react';
import { TradingEngineControl } from '../components/TradingEngineControl';
import { MarketDataWidget } from '../components/MarketDataWidget';

export function TradingEnginePage() {
  const engineMetrics = [
    {
      title: 'Engine Uptime',
      value: '24h 15m',
      change: 'Continuous',
      icon: Activity,
      color: 'green'
    },
    {
      title: 'Trades Executed',
      value: '1,247',
      change: '+23 today',
      icon: BarChart3,
      color: 'blue'
    },
    {
      title: 'Success Rate',
      value: '89.7%',
      change: '+2.1%',
      icon: CheckCircle,
      color: 'green'
    },
    {
      title: 'Avg Execution',
      value: '12ms',
      change: 'Ultra-fast',
      icon: Zap,
      color: 'yellow'
    }
  ];

  const systemComponents = [
    {
      name: 'Price Feed',
      status: 'online',
      latency: '5ms',
      description: 'Real-time market data streaming'
    },
    {
      name: 'Risk Manager',
      status: 'online',
      latency: '2ms',
      description: 'Position sizing and risk control'
    },
    {
      name: 'Signal Generator',
      status: 'online',
      latency: '8ms',
      description: 'Technical analysis and signals'
    },
    {
      name: 'Order Router',
      status: 'online',
      latency: '12ms',
      description: 'Trade execution and routing'
    },
    {
      name: 'Database',
      status: 'online',
      latency: '15ms',
      description: 'Data persistence and logging'
    },
    {
      name: 'Notification Service',
      status: 'online',
      latency: '25ms',
      description: 'User alerts and reporting'
    }
  ];

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-8">
        <Cpu className="w-8 h-8 text-yellow-400" />
        <div>
          <h1 className="text-3xl font-bold text-white">Trading Engine</h1>
          <p className="text-gray-400">Advanced AI-powered trading system management</p>
        </div>
      </div>

      {/* Engine Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {engineMetrics.map((metric, index) => {
          const Icon = metric.icon;
          const colorClasses = {
            blue: 'from-blue-500 to-blue-600',
            green: 'from-green-500 to-green-600',
            yellow: 'from-yellow-500 to-yellow-600',
            purple: 'from-purple-500 to-purple-600'
          };

          return (
            <div key={index} className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[metric.color]} rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className="text-sm font-medium text-gray-400">
                  {metric.change}
                </span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">{metric.value}</h3>
              <p className="text-gray-400 text-sm">{metric.title}</p>
            </div>
          );
        })}
      </div>

      {/* Main Controls and Market Data */}
      <div className="grid lg:grid-cols-2 gap-8 mb-8">
        <TradingEngineControl />
        <MarketDataWidget />
      </div>

      {/* System Components Status */}
      <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-6 h-6 text-blue-400" />
          <h2 className="text-xl font-semibold text-white">System Components</h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {systemComponents.map((component, index) => (
            <div key={index} className="p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium text-white">{component.name}</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    component.status === 'online' ? 'bg-green-400' : 'bg-red-400'
                  }`}></div>
                  <span className={`text-xs font-medium ${
                    component.status === 'online' ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {component.status.toUpperCase()}
                  </span>
                </div>
              </div>
              
              <p className="text-sm text-gray-400 mb-2">{component.description}</p>
              
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Latency</span>
                <span className="text-yellow-400 font-medium">{component.latency}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Engine Logs */}
      <div className="mt-8 bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Activity className="w-6 h-6 text-green-400" />
          <h2 className="text-xl font-semibold text-white">Recent Engine Activity</h2>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {[
            { time: '14:23:45', level: 'INFO', message: 'Price feed updated: XAUUSD $2047.23' },
            { time: '14:23:42', level: 'SUCCESS', message: 'Trade executed: BUY 0.3 lots at $2047.15' },
            { time: '14:23:38', level: 'INFO', message: 'Signal generated: Bullish momentum detected' },
            { time: '14:23:35', level: 'INFO', message: 'Risk check passed for user session #1247' },
            { time: '14:23:30', level: 'SUCCESS', message: 'Position closed: +$89.50 profit' },
            { time: '14:23:25', level: 'INFO', message: 'Market analysis completed: RSI 45.2, SMA crossover' },
            { time: '14:23:20', level: 'WARNING', message: 'High volatility detected: Adjusting position sizes' },
            { time: '14:23:15', level: 'INFO', message: 'Session #1248 activated: Medium risk level' }
          ].map((log, index) => (
            <div key={index} className="flex items-center gap-4 p-3 bg-gray-800/30 rounded-lg font-mono text-sm">
              <span className="text-gray-400">{log.time}</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                log.level === 'SUCCESS' ? 'bg-green-500/20 text-green-400' :
                log.level === 'WARNING' ? 'bg-yellow-500/20 text-yellow-400' :
                log.level === 'ERROR' ? 'bg-red-500/20 text-red-400' :
                'bg-blue-500/20 text-blue-400'
              }`}>
                {log.level}
              </span>
              <span className="text-gray-300 flex-1">{log.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}