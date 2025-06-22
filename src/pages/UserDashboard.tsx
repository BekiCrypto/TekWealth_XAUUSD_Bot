import React, { useState, useEffect, useCallback } from 'react';
import { tradingService } from '../services/tradingService';
import { useAuth } from '../hooks/useAuth';
import { 
  TrendingUp, 
  DollarSign, 
  Activity, 
  AlertCircle,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2, // For loading spinner
  ServerCrash // For error icon
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';

// Define interfaces for the data we expect from the service
interface AccountSummary {
  balance?: number;
  equity?: number;
  profit?: number; // Today's P&L or overall P&L depending on provider
  currency?: string;
  // other fields as provided by getProviderAccountSummary
}

interface OpenPosition {
  ticket: string; // Assuming 'ticket' is the unique ID
  symbol: string;
  type: 'BUY' | 'SELL'; // Or string if more types
  volume: number; // lots
  openPrice: number;
  currentPrice?: number; // May not always be available from listOpenPositions
  profit?: number;
  openTime?: string; // Or Date
  // other fields
}

export function UserDashboard() {
  const { user } = useAuth();
  const [balanceVisible, setBalanceVisible] = useState(true);
  const [accountSummary, setAccountSummary] = useState<AccountSummary | null>(null);
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Placeholder for portfolio chart data - will remain static for now
  const portfolioData = [
    { time: '00:00', value: accountSummary?.equity ?? 10000 }, // Use equity if available
    { time: '04:00', value: (accountSummary?.equity ?? 10000) * 1.025 },
    { time: '08:00', value: (accountSummary?.equity ?? 10000) * 1.018 },
    { time: '12:00', value: (accountSummary?.equity ?? 10000) * 1.042 },
    { time: '16:00', value: (accountSummary?.equity ?? 10000) * 1.038 },
    { time: '20:00', value: (accountSummary?.equity ?? 10000) * 1.065 },
    { time: '24:00', value: (accountSummary?.equity ?? 10000) * 1.059 }
  ];

  const fetchDashboardData = useCallback(async () => {
    if (!user?.id) return;

    setIsLoading(true);
    setError(null);
    try {
      // TODO: Determine which tradingAccountId to use if multiple. For now, undefined = default.
      const summaryRes = await tradingService.getProviderAccountSummary();
      if (summaryRes.error) throw new Error(`Account Summary: ${summaryRes.error.message || 'Failed to fetch'}`);
      // The actual structure of summaryRes.data depends on your Supabase function and MT provider
      // Assuming it returns something like { balance: 10000, equity: 10500, profit: 50, currency: 'USD' }
      setAccountSummary(summaryRes.data?.summary || summaryRes.data || {});


      const positionsRes = await tradingService.listProviderOpenPositions();
      if (positionsRes.error) throw new Error(`Open Positions: ${positionsRes.error.message || 'Failed to fetch'}`);
      // Assuming positionsRes.data is an array of OpenPosition
      setOpenPositions(positionsRes.data?.positions || positionsRes.data || []);

    } catch (err: any) {
      setError(err.message || 'An unknown error occurred.');
      setAccountSummary(null); // Clear data on error
      setOpenPositions([]);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const formatCurrency = (value?: number, currency?: string) => {
    if (value === undefined || value === null) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(value);
  };

  const getStatColor = (value?: number) => {
    if (value === undefined || value === null) return 'text-gray-400';
    if (value > 0) return 'text-green-400';
    if (value < 0) return 'text-red-400';
    return 'text-gray-400';
  };


  const dynamicStats = [
    {
      title: 'Account Balance',
      value: balanceVisible ? formatCurrency(accountSummary?.balance, accountSummary?.currency) : '••••••',
      // Change/trend for balance might not be directly available, using P/L for trend indication
      change: accountSummary?.profit !== undefined ? `${formatCurrency(accountSummary.profit, accountSummary?.currency)}` : 'N/A',
      trend: accountSummary?.profit > 0 ? 'up' : accountSummary?.profit < 0 ? 'down' : 'neutral',
      icon: DollarSign,
      color: 'green' // Static color, dynamic text color handles actual trend
    },
    {
      title: 'Today\'s P&L', // Or Floating P/L based on provider
      value: balanceVisible ? formatCurrency(accountSummary?.profit, accountSummary?.currency) : '••••••',
      // P&L percentage change would require previous day's P&L or balance, hard to get simply
      change: accountSummary?.profit !== undefined ? (accountSummary.profit / (accountSummary.balance || 1) * 100).toFixed(2) + '%' : 'N/A',
      trend: accountSummary?.profit > 0 ? 'up' : accountSummary?.profit < 0 ? 'down' : 'neutral',
      icon: TrendingUp,
      color: 'green'
    },
    {
      title: 'Active Positions',
      value: openPositions.length.toString(),
      change: 'XAUUSD Focus', // Placeholder, could be dynamic if positions are for multiple symbols
      trend: 'neutral',
      icon: Activity,
      color: 'blue'
    },
    {
      title: 'Win Rate', // Placeholder - requires trade history
      value: 'N/A',
      change: 'Last 30 days',
      trend: 'neutral',
      icon: AlertCircle,
      color: 'yellow'
    }
  ];


  return (
    <div className="p-8 text-white">
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
          <button
            onClick={fetchDashboardData}
            disabled={isLoading}
            className="flex items-center gap-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-lg flex items-center gap-3">
          <ServerCrash className="w-6 h-6 text-red-400" />
          <div>
            <h3 className="font-semibold text-red-400">Error Fetching Data</h3>
            <p className="text-red-500 text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {dynamicStats.map((stat, index) => {
          const Icon = stat.icon;
          const colorClasses = { // Base gradient colors for icons
            blue: 'from-blue-500 to-blue-600',
            green: 'from-green-500 to-green-600',
            yellow: 'from-yellow-500 to-yellow-600',
            purple: 'from-purple-500 to-purple-600'
          };
          const valueColor = stat.title.includes('P&L') || stat.title.includes('Balance') ? getStatColor(accountSummary?.profit) : 'text-white';
          const changeColor = stat.trend === 'up' ? 'text-green-400' : stat.trend === 'down' ? 'text-red-400' : 'text-gray-400';


          return (
            <div key={index} className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 bg-gradient-to-br ${colorClasses[stat.color as keyof typeof colorClasses]} rounded-lg flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <span className={`text-sm font-medium ${changeColor}`}>
                  {isLoading && (stat.title.includes('Balance') || stat.title.includes('P&L') || stat.title.includes('Active')) ? <Loader2 className="w-4 h-4 animate-spin" /> : stat.change}
                </span>
              </div>
              <h3 className={`text-2xl font-bold mb-1 ${isLoading && (stat.title.includes('Balance') || stat.title.includes('P&L') || stat.title.includes('Active')) ? 'animate-pulse text-gray-600' : valueColor}`}>
                {isLoading && (stat.title.includes('Balance') || stat.title.includes('P&L') || stat.title.includes('Active')) ? 'Loading...' : stat.value}
              </h3>
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
          {isLoading && <div className="h-80 flex items-center justify-center text-gray-500"><Loader2 className="w-8 h-8 animate-spin mr-2"/>Loading chart data...</div>}
          {!isLoading && error && <div className="h-80 flex items-center justify-center text-red-500">Error loading chart data.</div>}
          {!isLoading && !error && (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={portfolioData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                  <XAxis dataKey="time" stroke="#9CA3AF" />
                  <YAxis stroke="#9CA3AF" domain={['dataMin - 100', 'dataMax + 100']} />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#EAB308"
                    strokeWidth={3}
                    dot={{ fill: '#EAB308', strokeWidth: 2, r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Active Positions */}
        <div className="bg-gray-900/50 backdrop-blur-xl border border-gray-800 rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-6">Active Positions ({openPositions.length})</h2>
          {isLoading && <div className="space-y-4">
            {[...Array(3)].map((_, i) => ( // Placeholder skeleton loaders
                <div key={i} className="p-4 bg-gray-800/50 rounded-lg animate-pulse">
                    <div className="h-4 bg-gray-700 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-700 rounded w-1/2"></div>
                </div>
            ))}
          </div>}
          {!isLoading && error && <p className="text-red-500">Error loading positions.</p>}
          {!isLoading && !error && openPositions.length === 0 && <p className="text-gray-400">No active positions.</p>}
          {!isLoading && !error && openPositions.length > 0 && (
            <div className="space-y-4 max-h-80 overflow-y-auto">
              {openPositions.map((position) => (
                <div key={position.ticket} className="p-4 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        position.type === 'BUY'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}>
                        {position.type}
                      </span>
                      <span className="font-semibold text-white">{position.symbol}</span>
                      <span className="text-gray-400">{position.volume} lots</span>
                    </div>
                    <span className={`${getStatColor(position.profit)} font-semibold`}>
                      {formatCurrency(position.profit, accountSummary?.currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-400">
                    <span>Entry: {position.openPrice}</span>
                    <span>Current: {position.currentPrice || 'N/A'}</span> {/* Handle if currentPrice isn't available */}
                    <span title={position.openTime ? new Date(position.openTime).toLocaleString() : ''}>
                        {position.openTime ? new Date(position.openTime).toLocaleTimeString() : 'N/A'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}