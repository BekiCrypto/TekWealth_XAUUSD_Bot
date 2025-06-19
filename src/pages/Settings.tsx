import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  User, 
  Shield, 
  Bell, 
  Smartphone,
  Key,
  Wallet,
  Save
} from 'lucide-react';

export function Settings() {
  const [brokerCredentials, setBrokerCredentials] = useState({
    server: '',
    login: '',
    password: '',
    platform: 'MT4'
  });

  const [notifications, setNotifications] = useState({
    tradeAlerts: true,
    dailyReports: true,
    systemUpdates: false,
    priceAlerts: true
  });

  const [profile, setProfile] = useState({
    name: 'John Anderson',
    email: 'john@example.com',
    phone: '+1 (555) 123-4567',
    timezone: 'UTC-5'
  });

  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="w-8 h-8 text-yellow-400" />
        <div>
          <h1 className="text-3xl font-bold text-white">Settings</h1>
          <p className="text-gray-400">Manage your account and trading preferences</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Profile Settings */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <User className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Profile Information</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Full Name</label>
              <input
                type="text"
                value={profile.name}
                onChange={(e) => setProfile({...profile, name: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
              <input
                type="email"
                value={profile.email}
                onChange={(e) => setProfile({...profile, email: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
              <input
                type="tel"
                value={profile.phone}
                onChange={(e) => setProfile({...profile, phone: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Timezone</label>
              <select
                value={profile.timezone}
                onChange={(e) => setProfile({...profile, timezone: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              >
                <option value="UTC-8">Pacific Time (UTC-8)</option>
                <option value="UTC-7">Mountain Time (UTC-7)</option>
                <option value="UTC-6">Central Time (UTC-6)</option>
                <option value="UTC-5">Eastern Time (UTC-5)</option>
                <option value="UTC+0">GMT (UTC+0)</option>
                <option value="UTC+1">Central European Time (UTC+1)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Broker Credentials */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Key className="w-6 h-6 text-green-400" />
            <h2 className="text-xl font-semibold text-white">Broker Credentials</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Trading Platform</label>
              <select
                value={brokerCredentials.platform}
                onChange={(e) => setBrokerCredentials({...brokerCredentials, platform: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              >
                <option value="MT4">MetaTrader 4</option>
                <option value="MT5">MetaTrader 5</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Server</label>
              <input
                type="text"
                placeholder="e.g., broker-server.com:443"
                value={brokerCredentials.server}
                onChange={(e) => setBrokerCredentials({...brokerCredentials, server: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Login ID</label>
              <input
                type="text"
                placeholder="Your MT4/5 login number"
                value={brokerCredentials.login}
                onChange={(e) => setBrokerCredentials({...brokerCredentials, login: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
              <input
                type="password"
                placeholder="Your MT4/5 password"
                value={brokerCredentials.password}
                onChange={(e) => setBrokerCredentials({...brokerCredentials, password: e.target.value})}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
              />
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-blue-400 mb-2">
                <Shield className="w-5 h-5" />
                <span className="font-medium">Security Note</span>
              </div>
              <p className="text-sm text-blue-300">
                Your credentials are encrypted and stored securely. We recommend using a dedicated trading account for automated trading.
              </p>
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Bell className="w-6 h-6 text-purple-400" />
            <h2 className="text-xl font-semibold text-white">Notifications</h2>
          </div>

          <div className="space-y-4">
            {Object.entries(notifications).map(([key, value]) => {
              const labels = {
                tradeAlerts: 'Trade Alerts',
                dailyReports: 'Daily Reports',
                systemUpdates: 'System Updates',
                priceAlerts: 'Price Alerts'
              };

              return (
                <label key={key} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg cursor-pointer">
                  <span className="text-gray-300">{labels[key]}</span>
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(e) => setNotifications({...notifications, [key]: e.target.checked})}
                    className="w-5 h-5 text-yellow-500 bg-gray-700 border-gray-600 rounded focus:ring-yellow-500"
                  />
                </label>
              );
            })}
          </div>
        </div>

        {/* Subscription & Billing */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <Wallet className="w-6 h-6 text-yellow-400" />
            <h2 className="text-xl font-semibold text-white">Subscription & Billing</h2>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-green-400">Medium Risk Plan</span>
                <span className="text-green-400">Active</span>
              </div>
              <p className="text-sm text-gray-300">$599/month • Next billing: Jan 15, 2024</p>
            </div>

            <div className="p-4 bg-gray-800/50 rounded-lg">
              <h3 className="font-medium text-white mb-2">Payment Method</h3>
              <p className="text-gray-300 text-sm">USDT (BEP20)</p>
              <p className="text-gray-400 text-xs">Wallet: 0x742d...a8f2</p>
            </div>

            <button className="w-full bg-gray-800 hover:bg-gray-700 text-white py-3 px-4 rounded-lg transition-colors">
              Manage Subscription
            </button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="mt-8 flex justify-end">
        <button className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 px-6 py-3 rounded-lg font-medium transition-colors">
          <Save className="w-5 h-5" />
          Save Changes
        </button>
      </div>
    </div>
  );
}