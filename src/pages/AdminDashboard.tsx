import React, { useState, useEffect } from 'react';
import { tradingService } from '../services/tradingService';
import { useAuth } from '../hooks/useAuth'; // To ensure only authenticated users see it (further role check is on backend)
import { ShieldCheck, Users, AlertTriangle, Loader2, Settings2 } from 'lucide-react';

interface EnvVarStatus {
  name: string;
  status: 'SET' | 'NOT SET';
}

interface UserOverview {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
}

interface SystemLog {
  id: string;
  created_at: string;
  log_level: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  context: string;
  message: string;
  details?: any;
  session_id?: string;
  user_id?: string;
}

interface SystemLogsFilters {
  limit: number;
  offset: number;
  log_level?: string;
  context?: string;
  // startDate?: string; // For future date range filtering
  // endDate?: string;
}

export function AdminDashboard() {
  const { user, userRole }
    = useAuth();
  const [envVarStatuses, setEnvVarStatuses] = useState<EnvVarStatus[]>([]);
  const [users, setUsers] = useState<UserOverview[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [totalLogs, setTotalLogs] = useState(0);
  const [logFilters, setLogFilters] = useState<SystemLogsFilters>({ limit: 25, offset: 0 });

  const [isLoadingEnv, setIsLoadingEnv] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  const [errorEnv, setErrorEnv] = useState<string | null>(null);
  const [errorUsers, setErrorUsers] = useState<string | null>(null);
  const [errorLogs, setErrorLogs] = useState<string | null>(null);


  useEffect(() => {
    // Basic frontend check, actual authorization happens on the backend via JWT
    if (userRole !== 'admin') {
      // Redirect or show unauthorized message if not admin
      // For now, just log and don't fetch data
      console.warn("User is not admin, Admin Dashboard access denied on frontend.");
      // Set empty states or specific error messages if preferred for UI
      setEnvVarStatuses([]);
      setUsers([]);
      setErrorEnv("Access Denied: You must be an administrator to view this page.");
      setErrorUsers("Access Denied: You must be an administrator to view this page.");
      return;
    }

    const fetchEnvData = async () => {
      setIsLoadingEnv(true);
      setErrorEnv(null);
      try {
        const { data, error } = await tradingService.adminGetEnvVariablesStatus();
        if (error) throw error; // Let catch block handle it
        if (data) {
          setEnvVarStatuses(data);
        } else {
          // This case might happen if the function returns { data: null, error: null } on success with no items,
          // or if the data field is unexpectedly null.
          setEnvVarStatuses([]);
        }
      } catch (err: any) {
        console.error("AdminDashboard fetchEnvData error:", err);
        setErrorEnv(err.message || 'Failed to fetch ENV variable statuses.');
        setEnvVarStatuses([]); // Clear data on error
      } finally {
        setIsLoadingEnv(false);
      }
    };

    const fetchUsersData = async () => {
      setIsLoadingUsers(true);
      setErrorUsers(null);
      try {
        const { data, error } = await tradingService.adminListUsersOverview();
        if (error) throw error; // Let catch block handle it
        if (data) {
          setUsers(data);
        } else {
          setUsers([]);
        }
      } catch (err: any) {
        console.error("AdminDashboard fetchUsersData error:", err);
        setErrorUsers(err.message || 'Failed to fetch users overview.');
        setUsers([]); // Clear data on error
      } finally {
        setIsLoadingUsers(false);
      }
    };

    if(user && userRole === 'admin') { // Ensure user and role are loaded before fetching
        fetchEnvData();
        fetchUsersData();
        fetchSystemLogs(); // Call new function
    }
  }, [user, userRole, logFilters]); // Rerun if user, role, or logFilters change

  const fetchSystemLogs = async () => {
    if (userRole !== 'admin') return;
    setIsLoadingLogs(true);
    setErrorLogs(null);
    try {
      const { data, error } = await tradingService.adminGetSystemLogs(logFilters);
      if (error) throw error;
      if (data && data.logs) {
        setSystemLogs(data.logs);
        setTotalLogs(data.count || 0); // Assuming backend sends total count for pagination
      } else {
        setSystemLogs([]);
        setTotalLogs(0);
      }
    } catch (err: any) {
      console.error("AdminDashboard fetchSystemLogs error:", err);
      setErrorLogs(err.message || 'Failed to fetch system logs.');
      setSystemLogs([]);
      setTotalLogs(0);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const handleLogFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setLogFilters(prev => ({ ...prev, [e.target.name]: e.target.value, offset: 0 })); // Reset offset on filter change
  };

  const handleLogPageChange = (newOffset: number) => {
    setLogFilters(prev => ({ ...prev, offset: newOffset }));
  };


  // If userRole is not yet loaded, show a generic loading.
  if (userRole === null && !user) { // Check user as well, as userRole might be null initially even if user is loaded
      return <div className="p-8 text-white"><Loader2 className="animate-spin mr-2 inline" />Loading admin data...</div>;
  }
  // If role is loaded but not admin, show access denied.
  if (userRole !== 'admin') {
      return (
        <div className="p-8 text-white flex flex-col items-center justify-center min-h-[calc(100vh-theme(spacing.16))]"> {/* Adjust height as needed */}
            <AlertTriangle size={48} className="text-red-500 mb-4" />
            <h1 className="text-2xl font-bold mb-2">Access Denied</h1>
            <p className="text-gray-400">You do not have permission to view this page.</p>
        </div>
      );
  }

  return (
    <div className="p-8 text-white">
      <div className="flex items-center gap-3 mb-8">
        <Settings2 className="w-10 h-10 text-yellow-400" />
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-gray-400">System overview and management tools.</p>
        </div>
      </div>

      {/* Environment Variables Status */}
      <div className="mb-10 bg-gray-800/70 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-xl">
        <h2 className="text-2xl font-semibold mb-4 flex items-center">
          <ShieldCheck className="w-7 h-7 mr-3 text-blue-400" />
          Environment Variables Status
        </h2>
        {isLoadingEnv && <div className="flex items-center text-gray-400"><Loader2 className="animate-spin mr-2"/>Loading ENV statuses...</div>}
        {errorEnv && <div className="text-red-400 p-3 bg-red-900/30 border border-red-700 rounded"><AlertTriangle className="inline mr-2"/>{errorEnv}</div>}
        {!isLoadingEnv && !errorEnv && envVarStatuses.length > 0 && (
          <ul className="space-y-2">
            {envVarStatuses.map(envVar => (
              <li key={envVar.name} className="flex justify-between items-center p-2 bg-gray-700/50 rounded hover:bg-gray-600/50 transition-colors">
                <span className="font-mono text-sm text-gray-300">{envVar.name}</span>
                <span className={`px-3 py-0.5 text-xs font-semibold rounded-full ${
                  envVar.status === 'SET' ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'
                }`}>
                  {envVar.status}
                </span>
              </li>
            ))}
          </ul>
        )}
         {!isLoadingEnv && !errorEnv && envVarStatuses.length === 0 && <p className="text-gray-500">No environment variable statuses to display.</p>}
      </div>

      {/* Users Overview */}
      <div className="bg-gray-800/70 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-xl">
        <h2 className="text-2xl font-semibold mb-4 flex items-center">
          <Users className="w-7 h-7 mr-3 text-purple-400" />
          Users Overview
        </h2>
        {isLoadingUsers && <div className="flex items-center text-gray-400"><Loader2 className="animate-spin mr-2"/>Loading users...</div>}
        {errorUsers && <div className="text-red-400 p-3 bg-red-900/30 border border-red-700 rounded"><AlertTriangle className="inline mr-2"/>{errorUsers}</div>}
        {!isLoadingUsers && !errorUsers && users.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-700">
              <thead className="bg-gray-700/50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User ID</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Email</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Created At</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Last Sign In</th>
                </tr>
              </thead>
              <tbody className="bg-gray-800 divide-y divide-gray-700">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-gray-700/60 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-400 font-mono" title={user.id}>{user.id.substring(0,12)}...</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-300">{user.email || 'N/A'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-400">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoadingUsers && !errorUsers && users.length === 0 && <p className="text-center py-4 text-gray-500">No users found or unable to load user data.</p>}
      </div>

      {/* System Logs */}
      <div className="mt-10 bg-gray-800/70 backdrop-blur-md border border-gray-700 rounded-xl p-6 shadow-xl">
        <h2 className="text-2xl font-semibold mb-4 flex items-center">
          <Settings2 className="w-7 h-7 mr-3 text-green-400" /> {/* Changed icon for variety */}
          System Logs
        </h2>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label htmlFor="log_level_filter" className="block text-sm font-medium text-gray-300 mb-1">Log Level:</label>
            <select
              id="log_level_filter"
              name="log_level"
              value={logFilters.log_level || ''}
              onChange={handleLogFilterChange}
              className="bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-yellow-500 focus:outline-none w-full"
            >
              <option value="">All Levels</option>
              <option value="INFO">INFO</option>
              <option value="WARN">WARN</option>
              <option value="ERROR">ERROR</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>
          <div>
            <label htmlFor="context_filter" className="block text-sm font-medium text-gray-300 mb-1">Context:</label>
            <input
              type="text"
              id="context_filter"
              name="context"
              value={logFilters.context || ''}
              onChange={handleLogFilterChange}
              placeholder="e.g., ProcessBotSession"
              className="bg-gray-700 text-white p-2 rounded border border-gray-600 focus:border-yellow-500 focus:outline-none w-full"
            />
          </div>
           {/* Refresh button could also call fetchSystemLogs without changing filters */}
        </div>


        {isLoadingLogs && <div className="flex items-center text-gray-400"><Loader2 className="animate-spin mr-2"/>Loading system logs...</div>}
        {errorLogs && <div className="text-red-400 p-3 bg-red-900/30 border border-red-700 rounded"><AlertTriangle className="inline mr-2"/>{errorLogs}</div>}
        {!isLoadingLogs && !errorLogs && systemLogs.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-700 text-xs">
                <thead className="bg-gray-700/50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-300 uppercase tracking-wider">Timestamp</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-300 uppercase tracking-wider">Level</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-300 uppercase tracking-wider">Context</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-300 uppercase tracking-wider">Message</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium text-gray-300 uppercase tracking-wider">Details</th>
                  </tr>
                </thead>
                <tbody className="bg-gray-800 divide-y divide-gray-700">
                  {systemLogs.map(log => (
                    <tr key={log.id} className="hover:bg-gray-700/60 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-400">{new Date(log.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          log.log_level === 'ERROR' || log.log_level === 'CRITICAL' ? 'bg-red-600/30 text-red-300' :
                          log.log_level === 'WARN' ? 'bg-yellow-600/30 text-yellow-300' : 'bg-blue-600/30 text-blue-300'
                        }`}>
                          {log.log_level}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-300">{log.context}</td>
                      <td className="px-3 py-2 text-gray-300 max-w-md truncate" title={log.message}>{log.message}</td>
                      <td className="px-3 py-2 text-gray-400">
                        {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 && (
                          <pre className="text-xs bg-gray-900 p-1 rounded max-h-20 overflow-auto">{JSON.stringify(log.details, null, 2)}</pre>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            <div className="mt-4 flex justify-between items-center text-sm">
              <button
                onClick={() => handleLogPageChange(Math.max(0, logFilters.offset - logFilters.limit))}
                disabled={logFilters.offset === 0 || isLoadingLogs}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span>Page {Math.floor(logFilters.offset / logFilters.limit) + 1} of {Math.ceil(totalLogs / logFilters.limit)} (Total: {totalLogs})</span>
              <button
                onClick={() => handleLogPageChange(logFilters.offset + logFilters.limit)}
                disabled={logFilters.offset + logFilters.limit >= totalLogs || isLoadingLogs}
                className="px-3 py-1 bg-gray-600 hover:bg-gray-500 rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </>
        )}
        {!isLoadingLogs && !errorLogs && systemLogs.length === 0 && <p className="text-center py-4 text-gray-500">No system logs found matching criteria.</p>}
      </div>

    </div>
  );
}