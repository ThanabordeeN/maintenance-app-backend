import webpush from 'web-push';
import pool from '../config/database.js';

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_EMAIL) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
}

export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  let subs;
  try {
    subs = await pool.query(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
  } catch {
    return;
  }

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon ?? '/android-chrome-192x192.png',
    badge: payload.badge ?? '/favicon-32x32.png',
    url: payload.url ?? '/',
    tag: payload.tag,
  });

  await Promise.allSettled(
    subs.rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data
        );
      } catch (err: any) {
        console.error(`[push] send failed endpoint=${sub.endpoint.slice(0, 60)} status=${err.statusCode} body=${err.body} msg=${err.message}`);
        if (err.statusCode === 410 || err.statusCode === 404) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        }
      }
    })
  );
}

export async function sendPushToRoles(roles: string[], payload: PushPayload): Promise<void> {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  let users;
  try {
    users = await pool.query(
      `SELECT id FROM maintenance_users WHERE role = ANY($1::text[])`,
      [roles]
    );
  } catch {
    return;
  }

  await Promise.allSettled(users.rows.map((u) => sendPushToUser(u.id, payload)));
}
