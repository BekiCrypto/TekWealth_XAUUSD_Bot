import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Check, Loader2, AlertTriangle, X } from 'lucide-react';
import { tradingService } from '../services/tradingService';
import { useAuth } from '../hooks/useAuth';
import { Database } from '../types/database';

type Notification = Database['public']['Tables']['notifications']['Row'];

export function NotificationBell() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await tradingService.getUserNotifications(user.id, 20);
      if (fetchError) throw fetchError;
      if (data) {
        setNotifications(data);
        setUnreadCount(data.filter(n => !n.is_read).length);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch notifications');
      console.error("Notification fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user?.id) {
      fetchNotifications();
      // Poll for new notifications every 60 seconds
      const intervalId = setInterval(fetchNotifications, 60000);
      return () => clearInterval(intervalId);
    }
  }, [user, fetchNotifications]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      const { error: markError } = await tradingService.markNotificationAsRead(notificationId);
      if (markError) throw markError;
      // Optimistically update UI or refetch
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (err: any) {
      console.error("Mark as read error:", err);
      // Potentially show a small error message per notification
    }
  };

  const handleToggleDropdown = () => {
    setIsOpen(!isOpen);
    if (!isOpen && user?.id) { // Fetch fresh notifications when opening if not already loading
        if(unreadCount > 0 || notifications.length === 0) { // Or if there are unread ones
            fetchNotifications();
        }
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleToggleDropdown}
        className="relative p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
        aria-label="Toggle notifications"
      >
        <Bell className="w-6 h-6" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 block h-5 w-5 transform -translate-y-1/2 translate-x-1/2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-5 w-5 bg-red-600 text-white text-xs items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-80 sm:w-96 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-[70vh] flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-labelledby="notifications-heading"
        >
          <div className="flex justify-between items-center p-4 border-b border-gray-700">
            <h3 id="notifications-heading" className="text-lg font-semibold text-white">Notifications</h3>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
              <X size={20} />
            </button>
          </div>

          {isLoading && notifications.length === 0 && (
            <div className="p-4 text-center text-gray-400 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
            </div>
          )}

          {!isLoading && error && (
             <div className="p-4 text-center text-red-400 flex flex-col items-center justify-center">
              <AlertTriangle className="w-6 h-6 mb-2" />
              <p className="text-sm">{error}</p>
              <button onClick={fetchNotifications} className="mt-2 px-3 py-1 bg-yellow-500 text-gray-900 rounded text-xs hover:bg-yellow-600">Retry</button>
            </div>
          )}

          {!isLoading && !error && notifications.length === 0 && (
            <div className="p-4 text-center text-gray-400">No notifications yet.</div>
          )}

          {!isLoading && !error && notifications.length > 0 && (
            <ul className="divide-y divide-gray-700 overflow-y-auto flex-grow">
              {notifications.map(notification => (
                <li key={notification.id} className={`p-3 ${notification.is_read ? 'opacity-70' : 'bg-gray-800 hover:bg-gray-700/70'}`}>
                  <div className="flex justify-between items-start">
                    <div>
                      <p className={`text-sm font-medium ${notification.is_read ? 'text-gray-400' : 'text-white'}`}>
                        {notification.title || 'Notification'}
                      </p>
                      <p className={`text-xs ${notification.is_read ? 'text-gray-500' : 'text-gray-300'}`}>
                        {notification.message}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(notification.created_at).toLocaleString()}
                      </p>
                    </div>
                    {!notification.is_read && (
                      <button
                        onClick={() => handleMarkAsRead(notification.id)}
                        className="ml-2 p-1 text-xs text-blue-400 hover:text-blue-300"
                        title="Mark as read"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
           <div className="p-2 border-t border-gray-700 text-center">
             {/* Maybe a "Mark all as read" or "View all" button in future */}
             <button
                onClick={() => {
                    notifications.filter(n => !n.is_read).forEach(n => handleMarkAsRead(n.id));
                }}
                disabled={unreadCount === 0}
                className="text-xs text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
             >
                Mark all as read ({unreadCount})
            </button>
           </div>
        </div>
      )}
    </div>
  );
}
