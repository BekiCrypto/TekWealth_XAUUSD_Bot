import React from 'react';
import { 
  Users, 
  DollarSign, 
  TrendingUp, 
  Activity,
  Crown,
  AlertTriangle,
  CheckCircle,
  XCircle
} from 'lucide-react';

export function AdminDashboard() {
  const stats = [
    {
      title: 'Total Subscribers',
      value: '1,247',
      change: '+12.5%',
      trend: 'up',
      icon: Users,
      color: 'blue'
    },
    {
      title: 'Monthly Revenue',
      value: '$734,250',
      change: '+8.3%',
      trend: 'up',
      icon: DollarSign,
      color: 'green'
    },
    {
      title: 'Active Trades',
      value: '2,891',
      change: '+15.2%',
      trend: 'up',
      icon: Activity,
      color: 'yellow'
    },
    {
      title: 'Total Profit',
      value: '$2.4M',
      change: '+22.1%',
      trend: 'up',
      icon: TrendingUp,
      color: 'purple'
    }
  ];

  const recentSubscribers = [
    { id: 1, name: 'John Anderson', plan: 'High Risk', status: 'active', joinDate: '2024-01-15' },
    { id: 2, name: 'Sarah Johnson', plan: 'Medium Risk', status: 'active', joinDate: '2024-01-14' },
    { id: 3, name: 'Michael Chen', plan: 'Conservative', status: 'pending', joinDate: '2024-01-14' },
    { id: 4, name: 'Emily Davis', plan: 'Medium Risk', status: 'active', joinDate: '2024-01-13' },
    { id: 5, name: 'Robert Wilson', plan: 'High Risk', status: 'suspended', joinDate: '2024-01-12' }
  ];

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Crown className="w-8 h-8 text-yellow-400" />
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
        </div>
        <p className="text-gray-400">System overview and subscriber management</p>
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
                  stat.trend === 'up' ? 'text-green-400' : 'text-red-400'
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

      {/* Recent Activity */}
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Recent Subscribers */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Recent Subscribers</h2>
          <div className="space-y-4">
            {recentSubscribers.map((subscriber) => (
              <div key={subscriber.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-gray-600 to-gray-700 rounded-full flex items-center justify-center">
                    <span className="text-sm font-semibold text-white">
                      {subscriber.name.split(' ').map(n => n[0]).join('')}
                    </span>
                  </div>
                  <div>
                    <p className="font-medium text-white">{subscriber.name}</p>
                    <p className="text-sm text-gray-400">{subscriber.plan}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">{subscriber.joinDate}</span>
                  {subscriber.status === 'active' && <CheckCircle className="w-5 h-5 text-green-400" />}
                  {subscriber.status === 'pending' && <AlertTriangle className="w-5 h-5 text-yellow-400" />}
                  {subscriber.status === 'suspended' && <XCircle className="w-5 h-5 text-red-400" />}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* System Status */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">System Status</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                <span className="text-white">Trading Engine</span>
              </div>
              <span className="text-green-400 text-sm">Online</span>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                <span className="text-white">MT4/5 Connection</span>
              </div>
              <span className="text-green-400 text-sm">Connected</span>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                <span className="text-white">Payment Gateway</span>
              </div>
              <span className="text-green-400 text-sm">Active</span>
            </div>
            
            <div className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
                <span className="text-white">Server Load</span>
              </div>
              <span className="text-yellow-400 text-sm">73%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}