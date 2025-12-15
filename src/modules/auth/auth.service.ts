import bcrypt from 'bcrypt';
import jwt, { SignOptions } from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { config } from '../../config';
import { User, UserRole, AuditAction } from '../../types';
import { UnauthorizedError, BadRequestError, NotFoundError, ConflictError } from '../../lib/errors';
import { logAuditEvent, systemAuditContext } from '../audit';
import { LoginInput, RegisterInput } from './auth.schema';

const SALT_ROUNDS = 10;

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

interface JwtPayload {
  user_id: string;
  role: UserRole;
  type: 'access' | 'refresh';
}

/**
 * Generate JWT token pair
 */
function generateTokens(userId: string, role: UserRole): TokenPair {
  const accessPayload: JwtPayload = { user_id: userId, role, type: 'access' };
  const refreshPayload: JwtPayload = { user_id: userId, role, type: 'refresh' };

  // Type assertion needed as jsonwebtoken expects StringValue from 'ms' package
  const access_token = jwt.sign(accessPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as SignOptions);
  const refresh_token = jwt.sign(refreshPayload, config.jwt.secret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as SignOptions);

  return { access_token, refresh_token };
}

/**
 * Register a new user
 */
export async function registerUser(input: RegisterInput): Promise<{ user: User; tokens: TokenPair }> {
  const { email, phone, password, display_name, role } = input;

  // Check for existing user
  if (email) {
    const existing = await query('SELECT user_id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new ConflictError('Email already registered');
    }
  }

  if (phone) {
    const existing = await query('SELECT user_id FROM users WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      throw new ConflictError('Phone already registered');
    }
  }

  const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
  const user_id = uuidv4();

  const result = await query<User>(
    `INSERT INTO users (user_id, email, phone, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [user_id, email || null, phone || null, password_hash, display_name || null, role]
  );

  const user = result.rows[0];
  const tokens = generateTokens(user.user_id, user.role);

  await logAuditEvent({
    ...systemAuditContext(),
    action: 'USER_REGISTERED',
    target_type: 'user',
    target_id: user.user_id,
    payload: { email, phone, role },
  });

  return { user, tokens };
}

/**
 * Login with email and password
 */
export async function login(input: LoginInput): Promise<{ user: User; tokens: TokenPair }> {
  const { email, password } = input;

  const result = await query<User>(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = result.rows[0];

  if (!user.password_hash) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const tokens = generateTokens(user.user_id, user.role);

  await logAuditEvent({
    actor_user_id: user.user_id,
    actor_role: user.role,
    action: AuditAction.USER_LOGIN,
    target_type: 'user',
    target_id: user.user_id,
    payload: { email },
  });

  return { user, tokens };
}

/**
 * Refresh access token (legacy - without session tracking)
 * @deprecated Use oauth.service.refreshAccessToken for session-tracked tokens
 */
export async function refreshAccessTokenSimple(refreshToken: string): Promise<TokenPair> {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.secret) as JwtPayload;

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid token type');
    }

    // Verify user still exists
    const result = await query<User>(
      'SELECT user_id, role FROM users WHERE user_id = $1',
      [decoded.user_id]
    );

    if (result.rows.length === 0) {
      throw new UnauthorizedError('User not found');
    }

    const user = result.rows[0];
    return generateTokens(user.user_id, user.role);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Refresh token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new UnauthorizedError('Invalid refresh token');
    }
    throw error;
  }
}

/**
 * Get user by ID
 */
export async function getUserById(userId: string): Promise<User | null> {
  const result = await query<User>(
    'SELECT * FROM users WHERE user_id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

/**
 * Get user with org memberships
 */
export async function getUserWithOrgs(userId: string): Promise<{
  user: User;
  orgs: Array<{ org_id: string; org_name: string; scope: string }>;
} | null> {
  const userResult = await query<User>(
    'SELECT * FROM users WHERE user_id = $1',
    [userId]
  );

  if (userResult.rows.length === 0) {
    return null;
  }

  const orgsResult = await query<{ org_id: string; org_name: string; scope: string }>(
    `SELECT om.org_id, o.name as org_name, om.scope
     FROM org_memberships om
     JOIN orgs o ON o.org_id = om.org_id
     WHERE om.user_id = $1`,
    [userId]
  );

  return {
    user: userResult.rows[0],
    orgs: orgsResult.rows,
  };
}

/**
 * Verify phone (placeholder - in production, integrate with SMS service)
 */
export async function verifyPhone(
  phone: string,
  code: string
): Promise<{ verified: boolean }> {
  // In production, verify against stored OTP
  // For MVP, accept a test code
  if (code !== '123456' && config.env !== 'development') {
    throw new BadRequestError('Invalid verification code');
  }

  // Mark phone as verified for the user with this phone
  await query(
    `UPDATE users SET phone_verified_at = now() WHERE phone = $1`,
    [phone]
  );

  return { verified: true };
}

/**
 * Create organization
 */
export async function createOrg(name: string): Promise<{ org_id: string; name: string }> {
  const org_id = uuidv4();
  const result = await query<{ org_id: string; name: string }>(
    `INSERT INTO orgs (org_id, name) VALUES ($1, $2) RETURNING org_id, name`,
    [org_id, name]
  );
  return result.rows[0];
}

/**
 * Add user to organization
 */
export async function addUserToOrg(
  userId: string,
  orgId: string,
  scope = 'member'
): Promise<void> {
  await query(
    `INSERT INTO org_memberships (user_id, org_id, scope)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, org_id) DO UPDATE SET scope = $3`,
    [userId, orgId, scope]
  );
}
