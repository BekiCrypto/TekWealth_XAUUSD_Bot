import React, { useState } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Calendar, 
  Download
  // Filter // Removed unused import
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

export function Analytics() {
  const [timeframe, setTimeframe] = useState('7d');

  const portfolioData = [
    { date: '2024-01-08', value: 10000, profit: 0 },
    { date: '2024-01-09', value: 10150, profit: 150 },
    { date: '2024-01-10', value: 10080, profit: -70 },
    { date: '2024-01-11', value: 10280, profit: 200 },
    { date: '2024-01-12', value: 10420, profit: 140 },
    { date: '2024-01-13', value: 10380, profit: -40 },
    { date: '2024-01-14', value: 10590, profit: 210 }
  ];

  const tradingHours = [
    { hour: '00:00', trades: 2 },
    { hour: '02:00', trades: 1 },
    { hour: '04:00', trades: 3 },
    { hour: '06:00', trades: 5 },
    { hour: '08:00', trades: 8 },
    { hour: '10:00', trades: 12 },
    { hour: '12:00', trades: 15 },
    { hour: '14:00', trades: 18 },
    { hour: '16:00', trades: 14 },
    { hour: '18:00', trades: 9 },
    { hour: '20:00', trades: 6 },
    { hour: '22:00', trades: 4 }
  ];

  const riskDistribution = [
    { name: 'Conservative', value: 45, color: '#10B981' },
    { name: 'Medium', value: 35, color: '#EAB308' },
    { name: 'Risky', value: 20, color: '#EF4444' }
  ];

  const performanceMetrics = [
    { label: 'Total Return', value: '5.9%', change: '+2.1%', trend: 'up' },
    { label: 'Sharpe Ratio', value: '1.84', change: '+0.12', trend: 'up' },
    { label: 'Max Drawdown', value: '2.3%', change: '-0.5%', trend: 'up' },
    { label: 'Win Rate', value: '87.5%', change: '+3.2%', trend: 'up' }
  ];

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-8 h-8 text-yellow-400" />
          <div>
            <h1 className="text-3xl font-bold text-white">Performance Analytics</h1>
            <p className="text-gray-400">Detailed insights into your trading performance</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <select 
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
          >
            <option value="1d">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
          
          <button className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 px-4 py-2 rounded-lg font-medium transition-colors">
            <Download className="w-4 h-4" />
            Export Report
          </button>
        </div>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {performanceMetrics.map((metric, index) => (
          <div key={index} className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <TrendingUp className="w-8 h-8 text-yellow-400" />
              <span className={`text-sm font-medium ${
                metric.trend === 'up' ? 'text-green-400' : 'text-red-400'
              }`}>
                {metric.change}
              </span>
            </div>
            <h3 className="text-2xl font-bold text-white mb-1">{metric.value}</h3>
            <p className="text-gray-400 text-sm">{metric.label}</p>
          </div>
        ))}
      </div>

      {/* Charts Grid */}
      <div className="grid lg:grid-cols-2 gap-8 mb-8">
        {/* Portfolio Performance */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Portfolio Performance</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={portfolioData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9CA3AF" />
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

        {/* Trading Activity by Hour */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Trading Activity by Hour</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tradingHours}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="hour" stroke="#9CA3AF" />
                <YAxis stroke="#9CA3AF" />
                <Bar dataKey="trades" fill="#EAB308" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Risk Distribution and Recent Performance */}
      <div className="grid lg:grid-cols-3 gap-8">
        {/* Risk Distribution */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Risk Distribution</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={riskDistribution}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}%`}
                >
                  {riskDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily P&L Summary */}
        <div className="lg:col-span-2 bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Daily P&L Summary</h2>
          <div className="space-y-4">
            {portfolioData.slice(-7).map((day, index) => (
              <div key={index} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-4">
                  <Calendar className="w-5 h-5 text-gray-400" />
                  <span className="text-gray-300">{day.date}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-gray-400">Balance: ${day.value.toLocaleString()}</span>
                  <span className={`font-semibold ${
                    day.profit >= 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {day.profit >= 0 ? '+' : ''}${day.profit}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}