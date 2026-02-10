// Types for maintenance_app frontend

export interface MaintenanceUser {
  id: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  email?: string;
  role: 'admin' | 'supervisor' | 'technician' | 'moderator';
}

export interface Equipment {
  id: number;
  equipment_id?: number;
  equipment_name: string;
  equipment_code: string;
  location?: string;
  description?: string;
  running_hours?: number;
  status?: string;
}

export interface MaintenanceRecord {
  id: string;
  workOrder?: string;
  date: string;
  time: string;
  source: 'System' | 'Technician';
  machine: string;
  message: string;
  status: 'Pending' | 'In Progress' | 'Fixed';
  priority: 'critical' | 'high' | 'normal' | 'low';
  category: 'mechanical' | 'electrical' | 'software';
  assignedTo?: string;
  duration?: number;
  description: string;
}

export interface MaintenanceRecordRaw {
  id: number;
  work_order: string;
  equipment_id: number;
  created_by: number;
  assigned_to: number | null;
  maintenance_type: string;
  status: string;
  priority: string;
  category: string;
  description: string | null;
  notes: string | null;
  root_cause: string | null;
  action_taken: string | null;
  scheduled_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  downtime_minutes: number | null;
  created_at: string;
  updated_at: string;
  equipment_name?: string;
  equipment_code?: string;
  created_by_name?: string;
  assigned_to_name?: string;
}

export interface TimelineEntry {
  id: number;
  maintenance_id: number;
  status: string;
  changed_by: number;
  changed_by_name?: string;
  notes: string | null;
  created_at: string;
}

export interface MaintenanceComment {
  id: number;
  maintenance_id: number;
  user_id: number;
  display_name?: string;
  picture_url?: string;
  comment: string;
  created_at: string;
}

export interface CreateMaintenanceDto {
  equipmentId?: number;
  userId?: number;
  assignedTo?: number;
  maintenanceType: string;
  priority?: string;
  category?: string;
  title?: string;
  description?: string;
  notes?: string;
  scheduledDate?: string;
}

export interface UpdateMaintenanceDto {
  status?: string;
  notes?: string;
  assignedTo?: number;
  rootCause?: string;
  actionTaken?: string;
  cancelledReason?: string;
  onHoldReason?: string;
  userId?: number;
}

export interface MaintenanceSummary {
  pending: number;
  inProgress: number;
  fixed: number;
  critical: number;
  avgResponseTime: number;
}

export interface StatusOption {
  value: string;
  label: string;
  color: string;
}

export interface MaintenanceTypeOption {
  value: string;
  label: string;
}
