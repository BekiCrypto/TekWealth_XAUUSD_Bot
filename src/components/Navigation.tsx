import React from 'react';
import {
  BarChart3,
  Bot,
  Settings,
  TrendingUp,
  Shield,
  LogOut,
  Crown,
  Cpu,
  UserCircle
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { useAuthContext } from '../contexts/AuthContext';

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole: 'admin' | 'subscriber' | null;
  userName?: string;
}

export function Navigation({ currentPage, onNavigate, userRole, userName }: NavigationProps) {
  const { signOut } = useAuthContext();

  const handleLogout = async () => {
    await signOut();
  };

  const adminItems = [
    { id: 'admin', label: 'Admin Panel', icon: Crown },
    { id: 'engine', label: 'Trading Engine', icon: Cpu },
    { id: 'analytics', label: 'System Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Global Settings', icon: Settings },
  ];

  const userItems = [
    { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
    { id: 'bot', label: 'Trading Bot', icon: Bot },
    { id: 'backtesting', label: 'Backtesting', icon: BarChart3 },
    { id: 'settings', label: 'Account Settings', icon: Settings },
  ];

  const menuItems = userRole === 'admin' ? adminItems : userItems;

  return (
    <nav className="fixed left-0 top-0 h-screen w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
      {/* Header Section */}
      <div className="p-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center">
            <Shield className="w-6 h-6 text-gray-900" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">GoldBot Pro</h1>
            <p className="text-xs text-gray-400 capitalize">{userRole} Panel</p>
          </div>
        </div>

        {/* Optional User Info & Notification Bell */}
        <div className="mt-4 flex justify-between items-center">
          {userName && (
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <UserCircle size={20} />
              <span>{userName.split(' ')[0]}</span>
            </div>
          )}
          <div className={!userName ? "ml-auto" : ""}>
            <NotificationBell />
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="flex-grow p-6 space-y-2 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 shadow-md'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Footer Section (Logout) */}
      <div className="p-6 border-t border-gray-800">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-gray-300 hover:bg-red-500/20 hover:text-red-400 transition-all"
        >
          <LogOut className="w-5 h-5" />
          <span className="font-medium">Logout</span>
        </button>
      </div>
    </nav>
  );
}