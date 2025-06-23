import React from 'react';
import { 
  BarChart3, 
  Bot, 
  Settings, 
  Users, 
  TrendingUp, 
  Shield,
  LogOut,
  Crown,
  Cpu
} from 'lucide-react';
import { useAuthContext } from './auth/AuthProvider';

interface NavigationProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  userRole: 'admin' | 'subscriber' | null;
}

export function Navigation({ currentPage, onNavigate, userRole }: NavigationProps) {
  const { signOut } = useAuthContext();

  const handleLogout = async () => {
    await signOut();
  };

  const adminItems = [
    { id: 'admin', label: 'Admin Panel', icon: Crown },
    { id: 'engine', label: 'Trading Engine', icon: Cpu },
    { id: 'analytics', label: 'System Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const userItems = [
    { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
    { id: 'bot', label: 'Trading Bot', icon: Bot },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const menuItems = userRole === 'admin' ? adminItems : userItems;

  return (
    <nav className="fixed left-0 top-0 h-screen w-64 bg-gray-900 border-r border-gray-800 p-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center">
          <Shield className="w-6 h-6 text-gray-900" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">GoldBot Pro</h1>
          <p className="text-xs text-gray-400 capitalize">{userRole} Panel</p>
        </div>
      </div>

      <div className="space-y-2">
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="absolute bottom-6 left-6 right-6">
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