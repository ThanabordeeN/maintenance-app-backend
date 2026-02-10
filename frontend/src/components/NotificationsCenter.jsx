import { useState, useEffect } from 'react';
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  AlertTriangle,
  Wrench,
  Package,
  Calendar,
  Settings,
  ArrowLeft,
  X
} from 'lucide-react';
import { notificationsAPI } from '../services/api';
import { formatThaiDateTime } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/Card';
import Button from './ui/Button';
import Badge from './ui/Badge';

export default function NotificationsCenter({ profile }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState(null);

  useEffect(() => {
    if (profile?.id || profile?.userId) {
      fetchNotifications();
      fetchPreferences();
    } else {
      setLoading(false);
    }
  }, [profile?.id, profile?.userId]);

  const userId = profile?.id || profile?.userId;

  const fetchNotifications = async () => {
    try {
      const res = await notificationsAPI.getAll(userId);
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPreferences = async () => {
    try {
      const res = await notificationsAPI.getPreferences(userId);
      setPreferences(res.preferences);
    } catch (error) {
      console.error('Error fetching preferences:', error);
    }
  };

  const handleMarkAsRead = async (id) => {
    try {
      await notificationsAPI.markAsRead(id);
      setNotifications(prev =>
        prev.map(n => n.id === id ? { ...n, is_read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsAPI.markAllAsRead(userId);
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleUpdatePreference = async (key, value) => {
    try {
      const newPrefs = { ...preferences, [key]: value };
      setPreferences(newPrefs);
      await notificationsAPI.updatePreferences(userId, { [key]: value });
    } catch (error) {
      console.error('Error updating preferences:', error);
    }
  };

  const getIcon = (category) => {
    switch (category) {
      case 'maintenance': return Wrench;
      case 'parts': return Package;
      case 'schedule': return Calendar;
      default: return Bell;
    }
  };

  const getIconStyle = (type) => {
    switch (type) {
      case 'warning': return 'bg-amber-500/10 text-amber-400';
      case 'error': return 'bg-red-500/10 text-red-400';
      case 'success': return 'bg-green-500/10 text-green-400';
      default: return 'bg-blue-500/10 text-blue-400';
    }
  };

  const formatTime = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'เมื่อสักครู่';
    if (diffMins < 60) return `${diffMins} นาทีที่แล้ว`;
    if (diffHours < 24) return `${diffHours} ชั่วโมงที่แล้ว`;
    if (diffDays < 7) return `${diffDays} วันที่แล้ว`;
    return formatThaiDateTime(dateString);
  };

  if (loading) {
    return (
      <Card className="p-12 text-center border-dashed">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-500 mx-auto"></div>
        <p className="mt-4 text-gray-500 font-medium">กำลังโหลดการแจ้งเตือน...</p>
      </Card>
    );
  }

  // Preferences View
  if (showPreferences) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4 border-b border-gray-800 pb-6">
          <Button variant="ghost" size="icon" onClick={() => setShowPreferences(false)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <Settings className="w-6 h-6 text-green-500" />
              ตั้งค่าการแจ้งเตือน
            </h1>
          </div>
        </div>

        {preferences && (
          <div className="space-y-6">
            <Card className="border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg">ช่องทางการแจ้งเตือน</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { key: 'enable_in_app', label: 'แจ้งเตือนในแอป', icon: Bell },
                  { key: 'enable_line_push', label: 'LINE Push Notification', icon: Bell },
                  { key: 'enable_email', label: 'อีเมล', icon: Bell },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between p-4 bg-gray-900/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <item.icon className="w-5 h-5 text-gray-400" />
                      <span className="text-white">{item.label}</span>
                    </div>
                    <button
                      onClick={() => handleUpdatePreference(item.key, !preferences[item.key])}
                      className={`w-12 h-6 rounded-full transition-all ${preferences[item.key] ? 'bg-green-500' : 'bg-gray-600'
                        }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${preferences[item.key] ? 'translate-x-6' : 'translate-x-0.5'
                        }`} />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-gray-800">
              <CardHeader>
                <CardTitle className="text-lg">ประเภทการแจ้งเตือน</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { key: 'notify_new_ticket', label: 'ใบงานใหม่' },
                  { key: 'notify_assigned', label: 'ได้รับมอบหมายงาน' },
                  { key: 'notify_status_change', label: 'สถานะเปลี่ยน' },
                  { key: 'notify_overdue', label: 'งานเกินกำหนด' },
                  { key: 'notify_low_stock', label: 'อะไหล่ใกล้หมด' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between p-4 bg-gray-900/30 rounded-lg">
                    <span className="text-white">{item.label}</span>
                    <button
                      onClick={() => handleUpdatePreference(item.key, !preferences[item.key])}
                      className={`w-12 h-6 rounded-full transition-all ${preferences[item.key] ? 'bg-green-500' : 'bg-gray-600'
                        }`}
                    >
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${preferences[item.key] ? 'translate-x-6' : 'translate-x-0.5'
                        }`} />
                    </button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  // Notifications List
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-800 pb-6">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Bell className="w-8 h-8 text-green-500" />
              การแจ้งเตือน
              {unreadCount > 0 && (
                <Badge className="bg-red-500 text-white">{unreadCount}</Badge>
              )}
            </h1>
            <p className="text-gray-400 mt-1">Notifications Center</p>
          </div>
        </div>
        <div className="flex gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" onClick={handleMarkAllAsRead}>
              <CheckCheck className="w-4 h-4 mr-2" />
              อ่านทั้งหมด
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setShowPreferences(true)}>
            <Settings className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {notifications.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <BellOff className="w-16 h-16 mx-auto text-gray-600 mb-4" />
          <p className="text-gray-500 font-medium">ไม่มีการแจ้งเตือน</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const Icon = getIcon(notification.category);
            return (
              <Card
                key={notification.id}
                className={`border-gray-800 cursor-pointer transition-all hover:border-green-500/50 ${!notification.is_read ? 'border-l-4 border-l-green-500 bg-green-500/5' : ''
                  }`}
                onClick={() => !notification.is_read && handleMarkAsRead(notification.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getIconStyle(notification.type)}`}>
                      <Icon className="w-5 h-5" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium text-white">{notification.title}</h3>
                        {!notification.is_read && (
                          <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0 mt-2" />
                        )}
                      </div>
                      {notification.message && (
                        <p className="text-sm text-gray-400 mt-1">{notification.message}</p>
                      )}
                      <p className="text-xs text-gray-500 mt-2">{formatTime(notification.created_at)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
