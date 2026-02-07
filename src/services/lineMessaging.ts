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
 * ส่ง notification ใบขอเบิกอะไหล่ใหม่ (PR) ให้ Admin (Flex Message)
 */
export async function notifyNewRequisitionToAdmin(params: {
  adminUserId: number;
  prNumber: string;
  requesterName: string;
  workOrder: string;
  equipmentName?: string;
  itemCount: number;
  totalAmount?: number;
  priority: string;
  notes?: string;
  items?: Array<{ name: string; quantity: number; unit_price?: number }>;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.adminUserId);
  if (!lineUserId) {
    console.warn(`No LINE User ID for admin ${params.adminUserId}`);
    return { success: false, error: 'Admin has no LINE account linked' };
  }

  const priorityEmoji = {
    low: '🟢',
    normal: '🟡',
    high: '🟠',
    urgent: '🔴'
  }[params.priority] || '⚪';

  const priorityColor = {
    low: '#22c55e',
    normal: '#eab308',
    high: '#f97316',
    urgent: '#ef4444'
  }[params.priority] || '#6b7280';

  const priorityLabel = {
    low: 'ต่ำ',
    normal: 'ปกติ',
    high: 'สูง',
    urgent: 'ด่วนมาก'
  }[params.priority] || 'ปกติ';

  const flexContents = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f59e0b',
      paddingAll: '15px',
      contents: [
        {
          type: 'text',
          text: '📦 ใบขอเบิกอะไหล่ใหม่',
          color: '#ffffff',
          size: 'lg',
          weight: 'bold'
        },
        {
          type: 'text',
          text: params.prNumber,
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
            { type: 'text', text: 'ผู้ขอเบิก', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.requesterName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'งานซ่อม', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.workOrder || '-', size: 'sm', flex: 5 }
          ]
        },
        ...(params.equipmentName ? [{
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'เครื่องจักร', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.equipmentName, size: 'sm', flex: 5, wrap: true }
          ]
        }] : []),
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'จำนวนรายการ', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: `${params.itemCount} รายการ`, size: 'sm', flex: 5 }
          ]
        },
        ...(params.totalAmount ? [{
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'มูลค่ารวม', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: `฿${params.totalAmount.toLocaleString()}`, size: 'sm', weight: 'bold', color: '#f59e0b', flex: 5 }
          ]
        }] : []),
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'ความเร่งด่วน', size: 'sm', color: '#6b7280', flex: 3 },
            {
              type: 'text',
              text: `${priorityEmoji} ${priorityLabel}`,
              size: 'sm',
              color: priorityColor,
              weight: 'bold',
              flex: 5
            }
          ]
        },
        // แสดงรายการอะไหล่
        ...(params.items && params.items.length > 0 ? [
          {
            type: 'separator',
            margin: 'lg'
          },
          {
            type: 'text',
            text: '📋 รายการอะไหล่:',
            size: 'sm',
            weight: 'bold',
            color: '#374151',
            margin: 'md'
          },
          ...params.items.slice(0, 5).map((item: any) => ({
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: `• ${item.name}`, size: 'xs', color: '#4b5563', flex: 6, wrap: true },
              { type: 'text', text: `x${item.quantity}`, size: 'xs', color: '#6b7280', flex: 2, align: 'end' }
            ]
          })),
          ...(params.items.length > 5 ? [{
            type: 'text',
            text: `... และอีก ${params.items.length - 5} รายการ`,
            size: 'xs',
            color: '#9ca3af',
            margin: 'sm'
          }] : [])
        ] : []),
        ...(params.notes ? [{
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: 'หมายเหตุ:', size: 'xs', color: '#6b7280' },
            { type: 'text', text: params.notes, size: 'sm', wrap: true }
          ]
        }] : [])
      ]
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      paddingAll: '15px',
      contents: [
        {
          type: 'text',
          text: '⚠️ กรุณาตรวจสอบและอนุมัติ',
          size: 'xs',
          color: '#f59e0b',
          align: 'center'
        }
      ]
    },
    styles: {
      header: { separator: false },
      footer: { separator: true }
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `📦 ใบขอเบิก ${params.prNumber} จาก ${params.requesterName}`,
    contents: flexContents,
  });
}

/**
 * ส่ง notification ผลการอนุมัติ PR ให้ผู้ขอเบิก
 */
export async function notifyRequisitionResult(params: {
  requesterUserId: number;
  prNumber: string;
  status: 'approved' | 'rejected' | 'partial';
  approverName: string;
  rejectReason?: string;
  items?: Array<{ name: string; quantity: number }>;
  totalAmount?: number;
  stockAvailable?: boolean;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.requesterUserId);
  if (!lineUserId) {
    console.warn(`No LINE User ID for requester ${params.requesterUserId}`);
    return { success: false, error: 'Requester has no LINE account linked' };
  }

  const statusConfig = {
    approved: { emoji: '✅', label: 'อนุมัติแล้ว', color: '#22c55e' },
    rejected: { emoji: '❌', label: 'ไม่อนุมัติ', color: '#ef4444' },
    partial: { emoji: '⚠️', label: 'อนุมัติบางส่วน', color: '#f59e0b' }
  }[params.status];

  const flexContents = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: statusConfig.color,
      paddingAll: '15px',
      contents: [
        {
          type: 'text',
          text: `${statusConfig.emoji} ใบขอเบิก${statusConfig.label}`,
          color: '#ffffff',
          size: 'lg',
          weight: 'bold'
        },
        {
          type: 'text',
          text: params.prNumber,
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
            { type: 'text', text: 'ผู้อนุมัติ', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.approverName, size: 'sm', weight: 'bold', flex: 5 }
          ]
        },
        // แสดงสถานะ stock
        ...(params.status === 'approved' ? [{
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: 'สถานะ', size: 'sm', color: '#6b7280', flex: 3 },
            { 
              type: 'text', 
              text: params.stockAvailable ? '✅ อะไหล่พร้อมรับ' : '⏳ รอสั่งซื้อเพิ่ม', 
              size: 'sm', 
              color: params.stockAvailable ? '#22c55e' : '#f59e0b',
              weight: 'bold',
              flex: 5 
            }
          ]
        }] : []),
        // แสดงมูลค่ารวม
        ...(params.totalAmount ? [{
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            { type: 'text', text: 'มูลค่ารวม', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: `฿${params.totalAmount.toLocaleString()}`, size: 'sm', weight: 'bold', color: '#f59e0b', flex: 5 }
          ]
        }] : []),
        // แสดงรายการอะไหล่
        ...(params.items && params.items.length > 0 ? [
          {
            type: 'separator',
            margin: 'lg'
          },
          {
            type: 'text',
            text: '📋 รายการอะไหล่:',
            size: 'sm',
            weight: 'bold',
            color: '#374151',
            margin: 'md'
          },
          ...params.items.slice(0, 5).map((item: any) => ({
            type: 'box',
            layout: 'horizontal',
            margin: 'sm',
            contents: [
              { type: 'text', text: `• ${item.name}`, size: 'xs', color: '#4b5563', flex: 6, wrap: true },
              { type: 'text', text: `x${item.quantity}`, size: 'xs', color: '#6b7280', flex: 2, align: 'end' }
            ]
          })),
          ...(params.items.length > 5 ? [{
            type: 'text',
            text: `... และอีก ${params.items.length - 5} รายการ`,
            size: 'xs',
            color: '#9ca3af',
            margin: 'sm'
          }] : [])
        ] : []),
        ...(params.rejectReason ? [{
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: 'เหตุผล:', size: 'xs', color: '#6b7280' },
            { type: 'text', text: params.rejectReason, size: 'sm', color: '#ef4444', wrap: true }
          ]
        }] : [])
      ]
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `${statusConfig.emoji} ใบขอเบิก ${params.prNumber} ${statusConfig.label}`,
    contents: flexContents,
  });
}

/**
 * ส่ง notification ใบขอคืนใหม่ไปยัง Admin (Flex Message)
 */
export async function notifyNewReturnToAdmin(params: {
  adminUserId: number;
  returnNumber: string;
  partName: string;
  quantity: number;
  reason: string;
  requesterName: string;
  workOrder?: string;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.adminUserId);
  if (!lineUserId) {
    return { success: false, error: 'Admin has no LINE account linked' };
  }

  const reasonLabels: Record<string, string> = {
    'wrong_part': 'ไม่ตรงรุ่น',
    'defective': 'ชำรุด/เสียหาย',
    'not_needed': 'ไม่ต้องใช้',
    'excess': 'เกินจำนวน'
  };

  const flexContents = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#f97316',
      paddingAll: '15px',
      contents: [
        { type: 'text', text: '🔄 ขอคืนอะไหล่ใหม่', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: params.returnNumber, color: '#ffffff', size: 'xs', margin: 'sm' }
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
            { type: 'text', text: 'อะไหล่', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.partName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'จำนวน', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: `${params.quantity} ชิ้น`, size: 'sm', weight: 'bold', color: '#f97316', flex: 5 }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'เหตุผล', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: reasonLabels[params.reason] || params.reason, size: 'sm', flex: 5 }
          ]
        },
        ...(params.workOrder ? [{
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'งาน', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.workOrder, size: 'sm', flex: 5 }
          ]
        }] : []),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `ขอคืนโดย: ${params.requesterName}`, size: 'xs', color: '#9ca3af', margin: 'md' }
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
            label: 'ตรวจสอบ',
            uri: `${process.env.LIFF_URL || 'https://liff.line.me'}/${process.env.LIFF_ID || ''}`
          },
          style: 'primary',
          color: '#f97316'
        }
      ]
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `🔄 ขอคืนอะไหล่: ${params.returnNumber} - ${params.partName} x ${params.quantity}`,
    contents: flexContents,
  });
}

/**
 * ส่ง notification ผลการอนุมัติ/ปฏิเสธใบขอคืนไปยังผู้ขอ
 */
export async function notifyReturnResult(params: {
  technicianUserId: number;
  returnNumber: string;
  partName: string;
  quantity: number;
  status: 'approved' | 'rejected';
  approverName: string;
  rejectReason?: string;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.technicianUserId);
  if (!lineUserId) {
    return { success: false, error: 'Technician has no LINE account linked' };
  }

  const isApproved = params.status === 'approved';
  const statusConfig = isApproved
    ? { emoji: '✅', label: 'อนุมัติแล้ว', color: '#22c55e', bgColor: '#22c55e' }
    : { emoji: '❌', label: 'ถูกปฏิเสธ', color: '#ef4444', bgColor: '#ef4444' };

  const flexContents = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: statusConfig.bgColor,
      paddingAll: '15px',
      contents: [
        { type: 'text', text: `${statusConfig.emoji} ใบขอคืน${statusConfig.label}`, color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: params.returnNumber, color: '#ffffff', size: 'xs', margin: 'sm' }
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
            { type: 'text', text: 'อะไหล่', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.partName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'จำนวน', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: `${params.quantity} ชิ้น`, size: 'sm', weight: 'bold', flex: 5 }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'สถานะ', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: statusConfig.label, size: 'sm', weight: 'bold', color: statusConfig.color, flex: 5 }
          ]
        },
        ...(isApproved ? [{
          type: 'text',
          text: '✓ อะไหล่ถูกคืนเข้าสต๊อกแล้ว',
          size: 'sm',
          color: '#22c55e',
          margin: 'md'
        }] : []),
        ...(params.rejectReason ? [{
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          contents: [
            { type: 'text', text: 'เหตุผล:', size: 'xs', color: '#6b7280' },
            { type: 'text', text: params.rejectReason, size: 'sm', color: '#ef4444', wrap: true }
          ]
        }] : []),
        { type: 'separator', margin: 'md' },
        { type: 'text', text: `โดย: ${params.approverName}`, size: 'xs', color: '#9ca3af', margin: 'md' }
      ]
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `${statusConfig.emoji} ใบขอคืน ${params.returnNumber} ${statusConfig.label}`,
    contents: flexContents,
  });
}

/**
 * ส่ง notification PM เกินกำหนด (Flex Message)
 */
export async function notifyPMOverdue(params: {
  userId: number;
  equipmentName: string;
  taskName: string;
  overdueHours: number;
}): Promise<PushResult> {
  const lineUserId = await getLineUserIdFromUserId(params.userId);
  if (!lineUserId) {
    return { success: false, error: 'User has no LINE account linked' };
  }

  const flexContents = {
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#ef4444',
      paddingAll: '15px',
      contents: [
        { type: 'text', text: '⚠️ PM เกินกำหนด', color: '#ffffff', size: 'lg', weight: 'bold' },
        { type: 'text', text: params.equipmentName, color: '#ffffff', size: 'xs', margin: 'sm' }
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
            { type: 'text', text: 'งาน PM', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: params.taskName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
          ]
        },
        {
          type: 'box',
          layout: 'horizontal',
          contents: [
            { type: 'text', text: 'เกินกำหนด', size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: `${params.overdueHours.toFixed(0)} ชั่วโมง`, size: 'sm', weight: 'bold', color: '#ef4444', flex: 5 }
          ]
        },
        { type: 'separator', margin: 'lg' },
        { 
          type: 'text', 
          text: 'กรุณาดำเนินการ PM โดยเร็ว', 
          size: 'sm', 
          color: '#f97316', 
          margin: 'md',
          weight: 'bold'
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
            label: 'เปิดระบบ',
            uri: `${process.env.LIFF_URL || 'https://liff.line.me'}/${process.env.LIFF_ID || ''}`
          },
          style: 'primary',
          color: '#ef4444'
        }
      ]
    }
  };

  return pushFlexMessage({
    userId: lineUserId,
    altText: `⚠️ PM เกินกำหนด: ${params.equipmentName} - ${params.taskName} (${params.overdueHours.toFixed(0)} ชม.)`,
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
  notifyNewRequisitionToAdmin,
  notifyRequisitionResult,
  notifyNewReturnToAdmin,
  notifyReturnResult,
  notifyPMOverdue,
  broadcastMessage,
};
