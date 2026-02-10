import { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, Wrench, Package, Calendar, AlertTriangle, Settings, Trash2 } from 'lucide-react';
import { notificationsAPI } from '../services/api';
import { formatThaiDateTime } from '../lib/utils';

export default function NotificationBell({ profile, onViewChange, onSelectRecord }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notiList, setNotiList] = useState({});
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);
  const lastUnreadCount = useRef(0);

  const userId = profile?.id || profile?.userId;

  // Fast polling - check noti_list every 5 seconds
  const quickCheck = async () => {
    if (!userId) return;
    try {
      const res = await notificationsAPI.quickCheck(userId);
      setNotiList(res.notiList || {});
      const newUnreadCount = res.unreadCount || 0;

      // Play sound if new notifications
      if (newUnreadCount > lastUnreadCount.current && lastUnreadCount.current > 0) {
        // Could add notification sound here
        console.log('🔔 New notification!');
      }
      lastUnreadCount.current = newUnreadCount;
      setUnreadCount(newUnreadCount);
    } catch (error) {
      console.error('Error quick check:', error);
    }
  };

  // Full fetch - get complete notification details
  const fetchNotifications = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const res = await notificationsAPI.getAll(userId);
      setNotifications((res.notifications || []).slice(0, 10)); // Show last 10
      setUnreadCount(res.unreadCount || 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fast polling every 5 seconds
  useEffect(() => {
    if (userId) {
      quickCheck();
      const interval = setInterval(quickCheck, 5000); // Every 5 seconds
      return () => clearInterval(interval);
    }
  }, [userId]);

  // Full fetch when dropdown opens
  useEffect(() => {
    if (isOpen && userId) {
      fetchNotifications();
    }
  }, [isOpen, userId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation();
    try {
      // Use quick API for faster response
      await notificationsAPI.quickMarkAsRead(userId, id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      );
      // Update notiList
      setNotiList(prev => ({
        ...prev,
        [id]: { ...prev[id], status: 'read' }
      }));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      // Use quick API for faster response
      await notificationsAPI.quickMarkAllAsRead(userId);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      // Update notiList
      setNotiList(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(key => {
          updated[key] = { ...updated[key], status: 'read' };
        });
        return updated;
      });
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    try {
      await notificationsAPI.delete(userId, id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      // Remove from notiList
      setNotiList(prev => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
      // Update unread count if needed
      const notification = notifications.find(n => n.id === id);
      if (notification && !notification.is_read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const handleClearAll = async () => {
    if (!confirm('ต้องการลบการแจ้งเตือนทั้งหมด?')) return;
    try {
      await notificationsAPI.clearAll(userId);
      setNotifications([]);
      setNotiList({});
      setUnreadCount(0);
    } catch (error) {
      console.error('Error clearing all notifications:', error);
    }
  };

  const handleNotificationClick = (notification) => {
    // Navigate based on reference type
    if (notification.reference_type === 'maintenance_record' && notification.reference_id) {
      // Use onSelectRecord to open the detail view
      if (onSelectRecord) {
        onSelectRecord(String(notification.reference_id));
      }
    } else if (notification.reference_type === 'spare_part' && notification.reference_id) {
      if (onViewChange) onViewChange('spareParts');
    } else if (notification.reference_type === 'equipment_maintenance_schedule') {
      if (onViewChange) onViewChange('equipment');
    }

    // Mark as read if not already
    if (!notification.is_read) {
      handleMarkAsRead(notification.id, { stopPropagation: () => { } });
    }
    setIsOpen(false);
  };

  const getIcon = (category) => {
    switch (category) {
      case 'maintenance': return Wrench;
      case 'parts': return Package;
      case 'schedule': return Calendar;
      default: return Bell;
    }
  };

  const getTypeColor = (type) => {
    switch (type) {
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      case 'success': return 'text-green-400';
      default: return 'text-blue-400';
    }
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'เมื่อกี้';
    if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
    if (diffHours < 24) return `${diffHours} ชม.ที่แล้ว`;
    if (diffDays < 7) return `${diffDays} วันที่แล้ว`;
    return formatThaiDateTime(dateString);
  };

  if (!userId) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-gray-800"
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="fixed inset-x-4 top-[4.5rem] sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 max-h-[70vh] bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-[60]">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50">
            <div className="flex items-center gap-2">
              <Bell size={18} className="text-green-500" />
              <span className="font-semibold text-white">การแจ้งเตือน</span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
                  {unreadCount} ใหม่
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllAsRead}
                  className="text-xs text-gray-400 hover:text-green-400 transition-colors"
                >
                  อ่านทั้งหมด
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                  title="ลบทั้งหมด"
                >
                  ล้าง
                </button>
              )}
              <button
                onClick={() => { setIsOpen(false); if (onViewChange) onViewChange('notifications'); }}
                className="p-1 hover:bg-gray-700 rounded"
                title="ตั้งค่า"
              >
                <Settings size={16} className="text-gray-400" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-700 rounded"
              >
                <X size={16} className="text-gray-400" />
              </button>
            </div>
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto max-h-[50vh]">
            {loading ? (
              <div className="p-8 text-center text-gray-500">
                <div className="animate-spin w-6 h-6 border-2 border-gray-600 border-t-green-500 rounded-full mx-auto"></div>
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell size={40} className="mx-auto mb-3 opacity-30" />
                <p>ไม่มีการแจ้งเตือน</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const Icon = getIcon(notification.category);
                return (
                  <div
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`flex gap-3 p-4 border-b border-gray-800 cursor-pointer transition-colors hover:bg-gray-800/50 ${!notification.is_read ? 'bg-gray-800/30' : ''
                      }`}
                  >
                    {/* Icon */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${notification.type === 'warning' ? 'bg-yellow-500/10' :
                      notification.type === 'error' ? 'bg-red-500/10' :
                        notification.type === 'success' ? 'bg-green-500/10' :
                          'bg-blue-500/10'
                      }`}>
                      <Icon size={18} className={getTypeColor(notification.type)} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm font-medium truncate ${notification.is_read ? 'text-gray-400' : 'text-white'
                          }`}>
                          {notification.title}
                        </p>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!notification.is_read && (
                            <button
                              onClick={(e) => handleMarkAsRead(notification.id, e)}
                              className="p-1 hover:bg-gray-700 rounded"
                              title="อ่านแล้ว"
                            >
                              <Check size={14} className="text-green-500" />
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDelete(notification.id, e)}
                            className="p-1 hover:bg-gray-700 rounded opacity-50 hover:opacity-100"
                            title="ลบ"
                          >
                            <Trash2 size={14} className="text-red-400" />
                          </button>
                        </div>
                      </div>
                      {notification.message && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {notification.message}
                        </p>
                      )}
                      <p className="text-xs text-gray-600 mt-1">
                        {formatTime(notification.created_at)}
                      </p>
                    </div>

                    {/* Unread indicator */}
                    {!notification.is_read && (
                      <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500 mt-2"></div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-3 border-t border-gray-700 bg-gray-800/30">
              <button
                onClick={() => { setIsOpen(false); if (onViewChange) onViewChange('notifications'); }}
                className="w-full text-center text-sm text-green-500 hover:text-green-400 transition-colors"
              >
                ดูทั้งหมด
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
