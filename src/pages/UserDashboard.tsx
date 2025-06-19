import React from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  Activity, 
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';

export function UserDashboard() {
  const [balanceVisible, setBalanceVisible] = React.useState(true);

  const portfolioData = [
    { time: '00:00', value: 10000 },
    { time: '04:00', value: 10250 },
    { time: '08:00', value: 10180 },
    { time: '12:00', value: 10420 },
    { time: '16:00', value: 10380 },
    { time: '20:00', value: 10650 },
    { time: '24:00', value: 10590 }
  ];

  const stats = [
    {
      title: 'Account Balance',
      value: balanceVisible ? '$10,590.50' : '••••••',
      change: '+5.9%',
      trend: 'up',
      icon: DollarSign,
      color: 'green'
    },
    {
      title: 'Today\'s P&L',
      value: balanceVisible ? '+$247.80' : '••••••',
      change: '+2.4%',
      trend: 'up',
      icon: TrendingUp,
      color: 'green'
    },
    {
      title: 'Active Positions',
      value: '3',
      change: 'XAUUSD',
      trend: 'neutral',
      icon: Activity,
      color: 'blue'
    },
    {
      title: 'Win Rate',
      value: '87.5%',
      change: 'Last 30 days',
      trend: 'up',
      icon: AlertCircle,
      color: 'yellow'
    }
  ];

  const activePositions = [
    {
      id: 1,
      symbol: 'XAUUSD',
      type: 'BUY',
      lots: 0.5,
      openPrice: 2045.23,
      currentPrice: 2048.15,
      profit: '+146.00',
      time: '2 hours ago'
    },
    {
      id: 2,
      symbol: 'XAUUSD',
      type: 'SELL',
      lots: 0.3,
      openPrice: 2047.80,
      currentPrice: 2046.92,
      profit: '+26.40',
      time: '45 minutes ago'
    },
    {
      id: 3,
      symbol: 'XAUUSD',
      type: 'BUY',
      lots: 0.7,
      openPrice: 2044.55,
      currentPrice: 2048.15,
      profit: '+252.00',
      time: '3 hours ago'
    }
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Trading Dashboard</h1>
          <p className="text-gray-400">Monitor your gold trading performance</p>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setBalanceVisible(!balanceVisible)}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            {balanceVisible ? <EyeOff className="w-5 h-5 text-gray-400" /> : <Eye className="w-5 h-5 text-gray-400" />}
          </button>
          <button className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 px-4 py-2 rounded-lg font-medium transition-colors">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const colorClasses = {
            blue: 'from-blue-500 to-blue-600',
            green: 'from-green-500 to-green-600',
            yellow: 'from-yellow-500 to-yellow-600',
            purple: 'from-purple-500 to-purple-600'
          };

          return (
            <div key={index} className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[stat.color]} rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className={`text-sm font-medium ${
                  stat.trend === 'up' ? 'text-green-400' : stat.trend === 'down' ? 'text-red-400' : 'text-gray-400'
                }`}>
                  {stat.change}
                </span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-1">{stat.value}</h3>
              <p className="text-gray-400 text-sm">{stat.title}</p>
            </div>
          );
        })}
      </div>

      {/* Portfolio Chart and Active Positions */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Portfolio Performance */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Portfolio Performance (24h)</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={portfolioData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="time" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#EAB308" 
                  strokeWidth={3}
                  dot={{ fill: '#EAB308', strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active Positions */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Active Positions</h2>
          <div className="space-y-4">
            {activePositions.map((position) => (
              <div key={position.id} className="p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-1 rounded text-sm font-medium ${
                      position.type === 'BUY' 
                        ? 'bg-green-500/20 text-green-400' 
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {position.type}
                    </span>
                    <span className="font-semibold text-white">{position.symbol}</span>
                    <span className="text-gray-400">{position.lots} lots</span>
                  </div>
                  <span className="text-green-400 font-semibold">{position.profit}</span>
                </div>
                <div className="flex items-center justify-between text-sm text-gray-400">
                  <span>Entry: {position.openPrice}</span>
                  <span>Current: {position.currentPrice}</span>
                  <span>{position.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}