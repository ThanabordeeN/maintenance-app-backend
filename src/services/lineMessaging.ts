/**
 * LINE Messaging API Service
 * ส่ง Push Message ไปยังผู้ใช้โดยตรงผ่าน LINE OA
 * 
 * ใช้ LINE Messaging API Channel แยกจาก LIFF Channel
 * 
 * วิธีตั้งค่า:
 * 1. ไปที่ LINE Developers Console: https://developers.line.biz/console/
 * 2. สร้าง Messaging API Channel (คนละตัวกับ LIFF)
 * 3. Issue Channel Access Token (long-lived)
 * 4. เพิ่มใน .env:
 *    - LINE_MESSAGING_CHANNEL_ID=xxx
 *    - LINE_MESSAGING_CHANNEL_SECRET=xxx
 *    - LINE_MESSAGING_ACCESS_TOKEN=xxx
 */

import pool from '../config/database.js';

interface PushMessageOptions {
  userId: string;  // LINE User ID
  messages: LineMessage[];
}

interface LineMessage {
  type: 'text' | 'flex';
  text?: string;
  altText?: string;
  contents?: any;
}

interface FlexMessageOptions {
  userId: string;
  altText: string;
  contents: any;
}

interface PushResult {
  success: boolean;
  error?: string;
}

// LINE Messaging API credentials (แยกจาก LIFF)
const MESSAGING_CHANNEL_ID = process.env.LINE_MESSAGING_CHANNEL_ID || '';
const MESSAGING_CHANNEL_SECRET = process.env.LINE_MESSAGING_CHANNEL_SECRET || '';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_MESSAGING_ACCESS_TOKEN || '';

/**
 * ส่ง Push Message ไปยัง LINE User
 */
export async function pushMessage(options: PushMessageOptions): Promise<PushResult> {
  const { userId, messages } = options;

  if (!CHANNEL_ACCESS_TOKEN) {
    console.warn('LINE_MESSAGING_ACCESS_TOKEN not set');
    return { success: false, error: 'Messaging Channel Access Token not configured' };
  }

  if (!userId) {
    return { success: false, error: 'User ID is required' };
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: messages,
      }),
    });

    if (response.ok) {
      console.log(`✅ LINE Push Message sent to ${userId}`);
      return { success: true };
    } else {
      const error = await response.json();
      console.error('❌ LINE Push Message failed:', error);
      return { success: false, error: error.message || 'Push failed' };
    }
  } catch (error: any) {
    console.error('❌ LINE Push Message error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ส่งข้อความ Text ธรรมดา
 */
export async function pushTextMessage(userId: string, text: string): Promise<PushResult> {
  return pushMessage({
    userId,
    messages: [{ type: 'text', text }],
  });
}

/**
 * ส่ง Flex Message (สวยกว่า)
 */
export async function pushFlexMessage(options: FlexMessageOptions): Promise<PushResult> {
  const { userId, altText, contents } = options;
  return pushMessage({
    userId,
    messages: [{
      type: 'flex',
      altText,
      contents,
    }],
  });
}

/**
 * ดึง LINE User ID จาก database user ID
 */
export async function getLineUserIdFromUserId(userId: number): Promise<string | null> {
  try {
    const result = await pool.query(
      'SELECT line_user_id FROM maintenance_users WHERE id = $1',
      [userId]
    );
    return result.rows[0]?.line_user_id || null;
  } catch (error) {
    console.error('Error getting LINE user ID:', error);
    return null;
  }
}

/**
 * ส่ง notification ใบแจ้งซ่อมใหม่ (Flex Message)
 */
export async function notifyNewMaintenanceTicket(params: {
  assignedToUserId: number;
  workOrder: string;
  equipmentName: string;
  maintenanceType: string;
  priority: string;
  description: string;
  createdByName: string;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.assignedToUserId);
  if (!lineUserId) {
    console.warn(`No LINE User ID for user ${params.assignedToUserId}`);
    return { success: false, error: 'User has no LINE account linked' };
  }

  const priorityEmoji = {
    low: '🟢',
    medium: '🟡',
    high: '🟠',
    critical: '🔴'
  }[params.priority] || '⚪';

  const priorityColor = {
    low: '#22c55e',
    medium: '#eab308',
    high: '#f97316',
    critical: '#ef4444'
  }[params.priority] || '#6b7280';

  const flexContents = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#22c55e',
      paddingAll: '15px',
      contents: [
        {
          type: 'text',
          text: '📋 งานซ่อมใหม่',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold'
        },
        {
          type: 'text',
          text: params.workOrder,
          color: '#ffffff',
          size: 'xs',
          margin: 'sm'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      paddingAll: '15px',
      contents: [
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'เครื่องจักร', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.equipmentName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ประเภท', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.maintenanceType, size: 'sm', weight: 'bold', flex: 5 }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ความเร่งด่วน', size: 'sm', color: '#6b7280', flex: 3 },
            { 
              type: 'text', 
              text: `${priorityEmoji} ${params.priority.toUpperCase()}`, 
              size: 'sm', 
              weight: 'bold', 
              color: priorityColor,
              flex: 5 
            }
          ]
        },
        {
          type: 'separator',
          margin: 'md'
        },
        {
          type: 'text',
          text: params.description || 'ไม่มีรายละเอียด',
          size: 'sm',
          color: '#374151',
          wrap: true,
          margin: 'md'
        },
        {
          type: 'text',
          text: `แจ้งโดย: ${params.createdByName}`,
          size: 'xs',
          color: '#9ca3af',
          margin: 'md'
        }
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      paddingAll: '15px',
      contents: [
        {
          type: 'button',
          action: {
            type: 'uri',
            label: 'ดูรายละเอียด',
            uri: `${process.env.LIFF_URL || 'https://liff.line.me'}/${process.env.LIFF_ID || ''}`
          },
          style: 'primary',
          color: '#22c55e'
        }
      ]
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `📋 งานซ่อมใหม่: ${params.workOrder} - ${params.equipmentName}`,
    contents: flexContents,
  });
}

/**
 * ส่ง notification สถานะงานเปลี่ยน
 */
export async function notifyStatusChange(params: {
  userId: number;
  workOrder: string;
  equipmentName: string;
  oldStatus: string;
  newStatus: string;
  changedByName: string;
  notes?: string;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.userId);
  if (!lineUserId) {
    return { success: false, error: 'User has no LINE account linked' };
  }

  const statusEmoji = {
    pending: '⏳',
    in_progress: '🔧',
    completed: '✅',
    cancelled: '❌',
    on_hold: '⏸️',
    reopened: '🔄'
  }[params.newStatus] || '📋';

  const statusLabel = {
    pending: 'รอดำเนินการ',
    in_progress: 'กำลังซ่อม',
    completed: 'เสร็จสิ้น',
    cancelled: 'ยกเลิก',
    on_hold: 'พักงาน',
    reopened: 'เปิดใหม่'
  }[params.newStatus] || params.newStatus;

  const statusColor = {
    pending: '#eab308',
    in_progress: '#3b82f6',
    completed: '#22c55e',
    cancelled: '#ef4444',
    on_hold: '#f97316',
    reopened: '#8b5cf6'
  }[params.newStatus] || '#6b7280';

  const flexContents = {
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: statusColor,
      paddingAll: '12px',
      contents: [
        {
          type: 'text',
          text: `${statusEmoji} สถานะเปลี่ยน`,
          color: '#ffffff',
          size: 'md',
          weight: 'bold'
        }
      ]
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '12px',
      contents: [
        {
          type: 'text',
          text: params.workOrder,
          size: 'sm',
          weight: 'bold'
        },
        {
          type: 'text',
          text: params.equipmentName,
          size: 'xs',
          color: '#6b7280'
        },
        {
          type: 'separator',
          margin: 'md'
        },
        {
          type: 'text',
          text: `สถานะ: ${statusLabel}`,
          size: 'md',
          weight: 'bold',
          color: statusColor,
          margin: 'md'
        },
        ...(params.notes ? [{
          type: 'text',
          text: params.notes,
          size: 'xs',
          color: '#6b7280',
          wrap: true,
          margin: 'sm'
        }] : []),
        {
          type: 'text',
          text: `โดย: ${params.changedByName}`,
          size: 'xs',
          color: '#9ca3af',
          margin: 'md'
        }
      ]
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `${statusEmoji} ${params.workOrder} - ${statusLabel}`,
    contents: flexContents,
  });
}

/**
 * Broadcast message ไปยังทุกคนในระบบ (ใช้ Broadcast API)
 */
export async function broadcastMessage(messages: LineMessage[]): Promise<PushResult> {
  if (!CHANNEL_ACCESS_TOKEN) {
    return { success: false, error: 'Channel Access Token not configured' };
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({ messages }),
    });

    if (response.ok) {
      console.log('✅ LINE Broadcast sent');
      return { success: true };
    } else {
      const error = await response.json();
      console.error('❌ LINE Broadcast failed:', error);
      return { success: false, error: error.message };
    }
  } catch (error: any) {
    console.error('❌ LINE Broadcast error:', error);
    return { success: false, error: error.message };
  }
}

export default {
  pushMessage,
  pushTextMessage,
  pushFlexMessage,
  notifyNewMaintenanceTicket,
  notifyStatusChange,
  broadcastMessage,
};
