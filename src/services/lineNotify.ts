/**
 * LINE Notify Service
 * ส่งการแจ้งเตือนผ่าน LINE Notify API
 * 
 * วิธีตั้งค่า:
 * 1. ไปที่ https://notify-bot.line.me/
 * 2. สร้าง access token สำหรับ group หรือ user
 * 3. เพิ่ม token ใน environment variable LINE_NOTIFY_TOKEN
 *    หรือเก็บใน user profile (line_notify_token)
 */

interface LineNotifyOptions {
  token: string;
  message: string;
  imageUrl?: string;
  stickerPackageId?: number;
  stickerId?: number;
}

interface NotifyResult {
  success: boolean;
  status?: number;
  message?: string;
}

// Default LINE Notify token (for group notifications)
const DEFAULT_LINE_NOTIFY_TOKEN = process.env.LINE_NOTIFY_TOKEN || '';

/**
 * ส่งข้อความแจ้งเตือนผ่าน LINE Notify
 */
export async function sendLineNotify(options: LineNotifyOptions): Promise<NotifyResult> {
  const { token, message, imageUrl, stickerPackageId, stickerId } = options;

  if (!token) {
    console.warn('LINE Notify token not provided');
    return { success: false, message: 'No token provided' };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('message', message);
    
    if (imageUrl) {
      formData.append('imageThumbnail', imageUrl);
      formData.append('imageFullsize', imageUrl);
    }
    
    if (stickerPackageId && stickerId) {
      formData.append('stickerPackageId', stickerPackageId.toString());
      formData.append('stickerId', stickerId.toString());
    }

    const response = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${token}`,
      },
      body: formData.toString(),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('LINE Notify sent successfully');
      return { success: true, status: response.status, message: result.message };
    } else {
      console.error('LINE Notify failed:', result);
      return { success: false, status: response.status, message: result.message };
    }
  } catch (error: any) {
    console.error('LINE Notify error:', error);
    return { success: false, message: error.message };
  }
}

/**
 * ส่งแจ้งเตือนไปยัง default group token
 */
export async function notifyGroup(message: string, imageUrl?: string): Promise<NotifyResult> {
  if (!DEFAULT_LINE_NOTIFY_TOKEN) {
    console.warn('Default LINE Notify token not configured');
    return { success: false, message: 'LINE_NOTIFY_TOKEN not configured' };
  }
  
  return sendLineNotify({
    token: DEFAULT_LINE_NOTIFY_TOKEN,
    message,
    imageUrl,
  });
}

/**
 * สร้างข้อความแจ้งเตือนสำหรับใบแจ้งซ่อมใหม่
 */
export function formatNewTicketMessage(data: {
  workOrder: string;
  equipmentName?: string;
  maintenanceType: string;
  priority: string;
  description?: string;
  createdBy?: string;
  assignedTo?: string;
}): string {
  const priorityEmoji: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };

  const typeEmoji: Record<string, string> = {
    repair: '🔧',
    preventive: '🛡️',
    inspection: '🔍',
    calibration: '📏',
    cleaning: '🧹',
  };

  const emoji = priorityEmoji[data.priority] || '🔵';
  const typeIcon = typeEmoji[data.maintenanceType] || '🔧';

  let message = `\n${emoji} แจ้งซ่อมใหม่ ${emoji}\n`;
  message += `━━━━━━━━━━━━━━━\n`;
  message += `📋 เลขที่: ${data.workOrder}\n`;
  message += `${typeIcon} ประเภท: ${data.maintenanceType}\n`;
  
  if (data.equipmentName) {
    message += `🏭 เครื่องจักร: ${data.equipmentName}\n`;
  }
  
  message += `⚡ ความเร่งด่วน: ${data.priority}\n`;
  
  if (data.description) {
    message += `📝 รายละเอียด: ${data.description.substring(0, 100)}${data.description.length > 100 ? '...' : ''}\n`;
  }
  
  if (data.createdBy) {
    message += `👤 แจ้งโดย: ${data.createdBy}\n`;
  }
  
  if (data.assignedTo) {
    message += `👷 มอบหมาย: ${data.assignedTo}\n`;
  }
  
  message += `━━━━━━━━━━━━━━━`;

  return message;
}

/**
 * สร้างข้อความแจ้งเตือนเมื่อถูกมอบหมายงาน
 */
export function formatAssignedMessage(data: {
  workOrder: string;
  equipmentName?: string;
  maintenanceType: string;
  priority: string;
  description?: string;
}): string {
  const priorityEmoji: Record<string, string> = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🟢',
  };

  const emoji = priorityEmoji[data.priority] || '🔵';

  let message = `\n👷 คุณได้รับมอบหมายงาน 👷\n`;
  message += `━━━━━━━━━━━━━━━\n`;
  message += `📋 เลขที่: ${data.workOrder}\n`;
  message += `🔧 ประเภท: ${data.maintenanceType}\n`;
  
  if (data.equipmentName) {
    message += `🏭 เครื่องจักร: ${data.equipmentName}\n`;
  }
  
  message += `${emoji} ความเร่งด่วน: ${data.priority}\n`;
  
  if (data.description) {
    message += `📝 รายละเอียด: ${data.description.substring(0, 100)}${data.description.length > 100 ? '...' : ''}\n`;
  }
  
  message += `━━━━━━━━━━━━━━━`;

  return message;
}

/**
 * สร้างข้อความแจ้งเตือนเมื่อสถานะเปลี่ยน
 */
export function formatStatusChangeMessage(data: {
  workOrder: string;
  equipmentName?: string;
  oldStatus: string;
  newStatus: string;
  changedBy?: string;
  notes?: string;
}): string {
  const statusEmoji: Record<string, string> = {
    pending: '⏳',
    in_progress: '🔄',
    on_hold: '⏸️',
    completed: '✅',
    cancelled: '❌',
  };

  const newEmoji = statusEmoji[data.newStatus] || '📌';

  let message = `\n${newEmoji} สถานะอัพเดท ${newEmoji}\n`;
  message += `━━━━━━━━━━━━━━━\n`;
  message += `📋 เลขที่: ${data.workOrder}\n`;
  
  if (data.equipmentName) {
    message += `🏭 เครื่องจักร: ${data.equipmentName}\n`;
  }
  
  message += `📊 สถานะ: ${data.oldStatus} → ${data.newStatus}\n`;
  
  if (data.changedBy) {
    message += `👤 โดย: ${data.changedBy}\n`;
  }
  
  if (data.notes) {
    message += `💬 หมายเหตุ: ${data.notes.substring(0, 100)}${data.notes.length > 100 ? '...' : ''}\n`;
  }
  
  message += `━━━━━━━━━━━━━━━`;

  return message;
}

export default {
  sendLineNotify,
  notifyGroup,
  formatNewTicketMessage,
  formatAssignedMessage,
  formatStatusChangeMessage,
};
