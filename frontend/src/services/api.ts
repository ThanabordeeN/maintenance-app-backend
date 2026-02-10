import {
  Equipment,
  MaintenanceRecord,
  CreateMaintenanceDto,
  UpdateMaintenanceDto,
  MaintenanceSummary,
  StatusOption,
  MaintenanceTypeOption,
} from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3002/api';
const BACKEND_URL = API_URL.replace('/api', '');

export const getImageUrl = (url: string) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;

  // Ensure proper slash handling
  const baseUrl = BACKEND_URL.endsWith('/') ? BACKEND_URL.slice(0, -1) : BACKEND_URL;
  const path = url.startsWith('/') ? url : `/${url}`;

  return `${baseUrl}${path}`;
};

// Equipment API
export const equipmentAPI = {
  getAll: async (includeInactive = false): Promise<{ equipment: Equipment[] }> => {
    const url = includeInactive
      ? `${API_URL}/maintenance/equipment?includeInactive=true`
      : `${API_URL}/maintenance/equipment`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch equipment');
    return response.json();
  },

  getById: async (id: number): Promise<{ equipment: Equipment }> => {
    const response = await fetch(`${API_URL}/maintenance/equipment/${id}`);
    if (!response.ok) throw new Error('Equipment not found');
    return response.json();
  },

  create: async (data: Partial<Equipment>): Promise<{ equipment: Equipment }> => {
    const response = await fetch(`${API_URL}/maintenance/equipment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create equipment');
    }
    return response.json();
  },

  update: async (id: number, data: Partial<Equipment>): Promise<{ equipment: Equipment }> => {
    const response = await fetch(`${API_URL}/maintenance/equipment/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update equipment');
    }
    return response.json();
  },

  delete: async (id: number, permanent = false): Promise<{ success: boolean }> => {
    const url = permanent
      ? `${API_URL}/maintenance/equipment/${id}?permanent=true`
      : `${API_URL}/maintenance/equipment/${id}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to delete equipment');
    }
    return response.json();
  },

  toggle: async (id: number): Promise<{ success: boolean; equipment: Equipment; message: string }> => {
    const response = await fetch(`${API_URL}/maintenance/equipment/${id}/toggle`, {
      method: 'PATCH',
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to toggle equipment status');
    }
    return response.json();
  },
};

// Maintenance Records API
export const maintenanceAPI = {
  // Get all records (returns formatted array for dashboard compatibility)
  getAll: async (status?: string): Promise<MaintenanceRecord[]> => {
    const url = status
      ? `${API_URL}/maintenance/records?status=${status}`
      : `${API_URL}/maintenance/records`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch records');
    return response.json();
  },

  // Get summary stats
  getSummary: async (): Promise<MaintenanceSummary> => {
    const response = await fetch(`${API_URL}/maintenance/summary`);
    if (!response.ok) throw new Error('Failed to fetch summary');
    return response.json();
  },

  // Get record detail
  getById: async (id: string): Promise<any> => {
    const response = await fetch(`${API_URL}/maintenance/records/${id}`);
    if (!response.ok) throw new Error('Record not found');
    return response.json();
  },

  // Create record (supports FormData for multiple images)
  create: async (data: FormData): Promise<any> => {
    const response = await fetch(`${API_URL}/maintenance/records`, {
      method: 'POST',
      body: data,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create record');
    }
    return response.json();
  },

  // Update record (Supports FormData for status changes with images)
  update: async (id: string, data: UpdateMaintenanceDto | FormData): Promise<{ id: string; status: string }> => {
    const isFormData = data instanceof FormData;
    const response = await fetch(`${API_URL}/maintenance/records/${id}`, {
      method: 'PATCH',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
      body: isFormData ? data : JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update record');
    }
    return response.json();
  },

  // Add comment
  addComment: async (id: string, userId: number, comment: string): Promise<any> => {
    const response = await fetch(`${API_URL}/maintenance/records/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, comment }),
    });
    if (!response.ok) throw new Error('Failed to add comment');
    return response.json();
  },

  // Delete record
  delete: async (id: string): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/maintenance/records/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete record');
    return response.json();
  },

  // Add progress update (with optional image)
  addProgressUpdate: async (id: string, formData: FormData): Promise<any> => {
    const response = await fetch(`${API_URL}/maintenance/records/${id}/update`, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update progress');
    }
    return response.json();
  },

  // Update status
  updateStatus: async (id: string, status: string, data: any): Promise<any> => {
    const response = await fetch(`${API_URL}/status/records/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...data }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update status');
    }
    return response.json();
  },
};

// Status API
export const statusAPI = {
  // Get status options
  getOptions: async (): Promise<{
    statuses: StatusOption[];
    priorities: StatusOption[];
    categories: { value: string; label: string }[];
    maintenanceTypes: MaintenanceTypeOption[];
  }> => {
    const response = await fetch(`${API_URL}/status/options`);
    if (!response.ok) throw new Error('Failed to fetch options');
    return response.json();
  },
};

// Auth API
export const authAPI = {
  verify: async (accessToken: string): Promise<{ success: boolean; user: any }> => {
    const response = await fetch(`${API_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Authentication failed');
    }
    return response.json();
  },

  registerUser: async (lineUserId: string, displayName?: string, email?: string): Promise<any> => {
    const response = await fetch(`${API_URL}/auth/register-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineUserId, displayName, email }),
    });
    return response.json();
  },
};

// Usage Log API
export const usageAPI = {
  // Get usage logs by equipment
  getByEquipment: async (equipmentId: number, page = 1, limit = 10): Promise<{ logs: any[]; total: number; page: number; totalPages: number }> => {
    const response = await fetch(`${API_URL}/maintenance/equipment/${equipmentId}/usage-logs?page=${page}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch usage logs');
    return response.json();
  },

  // Get all usage logs
  getAll: async (limit = 50, equipmentId?: number): Promise<{ logs: any[] }> => {
    const url = equipmentId
      ? `${API_URL}/maintenance/usage-logs?limit=${limit}&equipment_id=${equipmentId}`
      : `${API_URL}/maintenance/usage-logs?limit=${limit}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch usage logs');
    return response.json();
  },

  // Create usage log
  create: async (data: any): Promise<{ log: any; alerts?: any[]; message: string }> => {
    const isFormData = data instanceof FormData;
    // Extract ID from FormData or Object
    const equipmentId = isFormData ? data.get('equipment_id') : data.equipment_id;

    if (!equipmentId) throw new Error('Equipment ID is required');

    const response = await fetch(`${API_URL}/maintenance/equipment/${equipmentId}/usage-logs`, {
      method: 'POST',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
      body: isFormData ? data : JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create usage log');
    }
    return response.json();
  },

  // Update usage log (only latest)
  update: async (logId: number, data: {
    equipment_id: number;
    usage_value: number;
    notes?: string | null;
  }): Promise<{ log: any; message: string }> => {
    const response = await fetch(`${API_URL}/maintenance/usage-logs/${logId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to update usage log');
    }
    return response.json();
  },
};

// Users API (for moderators)
export const usersAPI = {
  getAll: async (): Promise<{ users: any[] }> => {
    const response = await fetch(`${API_URL}/users`);
    if (!response.ok) throw new Error('Failed to fetch users');
    return response.json();
  },

  updateRole: async (id: number, role: string): Promise<any> => {
    const response = await fetch(`${API_URL}/users/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!response.ok) throw new Error('Failed to update role');
    return response.json();
  },

  delete: async (id: number): Promise<any> => {
    const response = await fetch(`${API_URL}/users/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete user');
    return response.json();
  },
};

// =========================================
// NEW CMMS APIs
// =========================================



// Reports API
export const reportsAPI = {
  getSummary: async (params?: { startDate?: string; endDate?: string; equipmentId?: number }): Promise<any> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.append('startDate', params.startDate);
    if (params?.endDate) searchParams.append('endDate', params.endDate);
    if (params?.equipmentId) searchParams.append('equipmentId', params.equipmentId.toString());

    const url = `${API_URL}/reports/summary${searchParams.toString() ? '?' + searchParams.toString() : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch summary');
    return response.json();
  },

  getMTBF: async (params?: { startDate?: string; endDate?: string; equipmentId?: number }): Promise<any> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.append('startDate', params.startDate);
    if (params?.endDate) searchParams.append('endDate', params.endDate);
    if (params?.equipmentId) searchParams.append('equipmentId', params.equipmentId.toString());

    const response = await fetch(`${API_URL}/reports/mtbf${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
    if (!response.ok) throw new Error('Failed to fetch MTBF');
    return response.json();
  },

  getMTTR: async (params?: { startDate?: string; endDate?: string; equipmentId?: number }): Promise<any> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.append('startDate', params.startDate);
    if (params?.endDate) searchParams.append('endDate', params.endDate);
    if (params?.equipmentId) searchParams.append('equipmentId', params.equipmentId.toString());

    const response = await fetch(`${API_URL}/reports/mttr${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
    if (!response.ok) throw new Error('Failed to fetch MTTR');
    return response.json();
  },

  getOEE: async (params?: { startDate?: string; endDate?: string; equipmentId?: number }): Promise<any> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.append('startDate', params.startDate);
    if (params?.endDate) searchParams.append('endDate', params.endDate);
    if (params?.equipmentId) searchParams.append('equipmentId', params.equipmentId.toString());

    const response = await fetch(`${API_URL}/reports/oee${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
    if (!response.ok) throw new Error('Failed to fetch OEE');
    return response.json();
  },

  getCalendar: async (month?: number, year?: number): Promise<any> => {
    const searchParams = new URLSearchParams();
    if (month) searchParams.append('month', month.toString());
    if (year) searchParams.append('year', year.toString());

    const response = await fetch(`${API_URL}/reports/calendar${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
    if (!response.ok) throw new Error('Failed to fetch calendar');
    return response.json();
  },

  exportData: async (params?: { startDate?: string; endDate?: string; equipmentId?: number; status?: string }): Promise<any> => {
    const searchParams = new URLSearchParams();
    if (params?.startDate) searchParams.append('startDate', params.startDate);
    if (params?.endDate) searchParams.append('endDate', params.endDate);
    if (params?.equipmentId) searchParams.append('equipmentId', params.equipmentId.toString());
    if (params?.status) searchParams.append('status', params.status);

    const response = await fetch(`${API_URL}/reports/export${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
    if (!response.ok) throw new Error('Failed to export data');
    return response.json();
  },
};

// Notifications API
export const notificationsAPI = {
  getAll: async (userId: number, unreadOnly = false): Promise<{ notifications: any[]; unreadCount: number }> => {
    const params = new URLSearchParams({ userId: userId.toString() });
    if (unreadOnly) params.append('unreadOnly', 'true');

    const response = await fetch(`${API_URL}/notifications?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch notifications');
    return response.json();
  },

  // Fast polling - uses noti_list from user data
  quickCheck: async (userId: number): Promise<{ notiList: Record<string, { status: string; type: string; title: string; created_at: string }>; unreadCount: number }> => {
    const response = await fetch(`${API_URL}/notifications/quick/${userId}`);
    if (!response.ok) throw new Error('Failed to quick check');
    return response.json();
  },

  // Mark as read using quick API
  quickMarkAsRead: async (userId: number, msgId: number): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/notifications/quick/${userId}/${msgId}/read`, { method: 'PATCH' });
    if (!response.ok) throw new Error('Failed to mark as read');
    return response.json();
  },

  // Mark all as read using quick API
  quickMarkAllAsRead: async (userId: number): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/notifications/quick/${userId}/read-all`, { method: 'PATCH' });
    if (!response.ok) throw new Error('Failed to mark all as read');
    return response.json();
  },

  // Delete single notification
  delete: async (userId: number, msgId: number): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/notifications/quick/${userId}/${msgId}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to delete notification');
    return response.json();
  },

  // Clear all notifications
  clearAll: async (userId: number): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/notifications/quick/${userId}/clear-all`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Failed to clear all notifications');
    return response.json();
  },

  markAsRead: async (id: number): Promise<{ notification: any }> => {
    const response = await fetch(`${API_URL}/notifications/${id}/read`, { method: 'PATCH' });
    if (!response.ok) throw new Error('Failed to mark as read');
    return response.json();
  },

  markAllAsRead: async (userId: number): Promise<{ message: string }> => {
    const response = await fetch(`${API_URL}/notifications/read-all`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) throw new Error('Failed to mark all as read');
    return response.json();
  },

  getPreferences: async (userId: number): Promise<{ preferences: any }> => {
    const response = await fetch(`${API_URL}/notifications/preferences/${userId}`);
    if (!response.ok) throw new Error('Failed to fetch preferences');
    return response.json();
  },

  updatePreferences: async (userId: number, data: any): Promise<{ preferences: any }> => {
    const response = await fetch(`${API_URL}/notifications/preferences/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error('Failed to update preferences');
    return response.json();
  },
};



// Setup API (for migrations)


// Setup API (for migrations)
export const setupAPI = {
  migrate: async (): Promise<{ success: boolean; message: string; tables_created: string[] }> => {
    const response = await fetch(`${API_URL}/setup/migrate`, { method: 'POST' });
    if (!response.ok) throw new Error('Migration failed');
    return response.json();
  },

  getStatus: async (): Promise<{ tables: { name: string; count: number }[] }> => {
    const response = await fetch(`${API_URL}/setup/status`);
    if (!response.ok) throw new Error('Failed to get status');
    return response.json();
  },
};

// =========================================
// PURCHASE REQUISITIONS API
// =========================================
export const requisitionsAPI = {
  getAll: async (params?: { status?: string; priority?: string; from_date?: string; to_date?: string }): Promise<{ requisitions: any[]; stats: any }> => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.priority) searchParams.append('priority', params.priority);
    if (params?.from_date) searchParams.append('from_date', params.from_date);
    if (params?.to_date) searchParams.append('to_date', params.to_date);

    const response = await fetch(`${API_URL}/requisitions${searchParams.toString() ? '?' + searchParams.toString() : ''}`);
    if (!response.ok) throw new Error('Failed to fetch requisitions');
    return response.json();
  },

  getById: async (id: number): Promise<{ requisition: any; items: any[] }> => {
    const response = await fetch(`${API_URL}/requisitions/${id}`);
    if (!response.ok) throw new Error('Requisition not found');
    return response.json();
  },

  getByMaintenance: async (maintenanceId: number): Promise<{ requisitions: any[] }> => {
    const response = await fetch(`${API_URL}/requisitions/by-maintenance/${maintenanceId}`);
    if (!response.ok) throw new Error('Failed to fetch requisitions');
    return response.json();
  },

  create: async (data: {
    maintenance_record_id?: number;
    requested_by: number;
    priority?: string;
    notes?: string;
    items: Array<{
      spare_part_id?: number;
      custom_item_name?: string;
      custom_item_unit?: string;
      quantity: number;
      unit_price: number;
      notes?: string;
    }>;
  }): Promise<{ success: boolean; requisition: any; pr_number: string }> => {
    const response = await fetch(`${API_URL}/requisitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create requisition');
    }
    return response.json();
  },

  approve: async (id: number, approved_by: number): Promise<{ success: boolean; all_stock_available: boolean; stock_issues: any[] }> => {
    const response = await fetch(`${API_URL}/requisitions/${id}/approve`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved_by, userId: approved_by }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to approve requisition');
    }
    return response.json();
  },

  reject: async (id: number, approved_by: number, rejection_reason: string): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/requisitions/${id}/reject`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved_by, rejection_reason, userId: approved_by }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to reject requisition');
    }
    return response.json();
  },

  cancel: async (id: number, cancelled_by: number, reason: string): Promise<{ success: boolean }> => {
    const response = await fetch(`${API_URL}/requisitions/${id}/cancel`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelled_by, reason }),
    });
    if (!response.ok) throw new Error('Failed to cancel requisition');
    return response.json();
  },
};



