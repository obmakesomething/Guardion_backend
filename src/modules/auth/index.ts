import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../../config/index.js';
import { query } from '../../db/pool.js';

const JWT_SECRET = process.env.JWT_SECRET || 'klygo-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

// In-memory OTP storage (use Redis in production)
const otpStore = new Map<string, { code: string; expiresAt: number }>();

export interface CustomerSession {
  customerId: string;
  phone?: string;
  email?: string;
  name?: string;
  authMethod: 'sms' | 'google' | 'kakao';
}

/**
 * Generate 6-digit OTP
 */
export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Store OTP for phone number (5 min expiry)
 */
export function storeOTP(phone: string, code: string): void {
  const normalizedPhone = phone.replace(/-/g, '');
  otpStore.set(normalizedPhone, {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Verify OTP for phone number
 */
export function verifyOTP(phone: string, code: string): boolean {
  const normalizedPhone = phone.replace(/-/g, '');
  const stored = otpStore.get(normalizedPhone);

  if (!stored) return false;
  if (Date.now() > stored.expiresAt) {
    otpStore.delete(normalizedPhone);
    return false;
  }
  if (stored.code !== code) return false;

  // OTP used, delete it
  otpStore.delete(normalizedPhone);
  return true;
}

/**
 * Create or get customer by phone
 */
export async function getOrCreateCustomerByPhone(phone: string): Promise<string> {
  const normalizedPhone = phone.replace(/-/g, '');

  // Check if customer exists
  const existing = await query(
    `SELECT id FROM customers WHERE phone = $1`,
    [normalizedPhone]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new customer
  const result = await query(
    `INSERT INTO customers (phone, created_at) VALUES ($1, NOW()) RETURNING id`,
    [normalizedPhone]
  );

  return result.rows[0].id;
}

/**
 * Create or get customer by Google OAuth
 */
export async function getOrCreateCustomerByGoogle(
  googleId: string,
  email: string,
  name: string
): Promise<string> {
  // Check if customer exists
  const existing = await query(
    `SELECT id FROM customers WHERE google_id = $1 OR email = $2`,
    [googleId, email]
  );

  if (existing.rows.length > 0) {
    // Update google_id if not set
    await query(
      `UPDATE customers SET google_id = $1, name = $2 WHERE id = $3`,
      [googleId, name, existing.rows[0].id]
    );
    return existing.rows[0].id;
  }

  // Create new customer
  const result = await query(
    `INSERT INTO customers (google_id, email, name, created_at)
     VALUES ($1, $2, $3, NOW()) RETURNING id`,
    [googleId, email, name]
  );

  return result.rows[0].id;
}

/**
 * Generate JWT token for customer
 */
export function generateToken(session: CustomerSession): string {
  return jwt.sign(session, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): CustomerSession | null {
  try {
    return jwt.verify(token, JWT_SECRET) as CustomerSession;
  } catch {
    return null;
  }
}

/**
 * Get customer's active requests
 */
export async function getCustomerRequests(customerId: string): Promise<any[]> {
  const result = await query(
    `SELECT
      mr.id,
      mr.status,
      mr.district,
      mr.created_at,
      mr.matched_tech_id,
      t.name as tech_name,
      t.phone as tech_phone,
      mr.customer_address as address
     FROM match_requests mr
     LEFT JOIN technicians t ON mr.matched_tech_id = t.id
     WHERE mr.customer_id = $1
     ORDER BY mr.created_at DESC
     LIMIT 10`,
    [customerId]
  );

  return result.rows;
}

/**
 * Link customer to match request (by phone)
 */
export async function linkCustomerToRequest(phone: string, customerId: string): Promise<void> {
  const normalizedPhone = phone.replace(/-/g, '');

  await query(
    `UPDATE match_requests
     SET customer_id = $1
     WHERE customer_phone = $2 AND customer_id IS NULL`,
    [customerId, normalizedPhone]
  );
}
