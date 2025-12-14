import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { query, withTransaction } from '../../db/pool';
import { config } from '../../config';
import { User, UserRole } from '../../types';
import { BadRequestError, UnauthorizedError, ConflictError } from '../../lib/errors';
import { logAuditEvent, systemAuditContext } from '../audit';
import {
  AuthProvider,
  OAuthFlow,
  OtpPurpose,
  CaseAccessScope,
  OAuthStartInput,
  OAuthCallbackInput,
  PhoneOtpSendInput,
  PhoneOtpVerifyInput,
} from './oauth.schema';

const SALT_ROUNDS = 10;

// Google OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Helper: generate random string
function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString('base64url').substring(0, length);
}

// Helper: hash with SHA256
function sha256Hash(data: string): string {
  return crypto.createHash('sha256').update(data).digest('base64url');
}

// Helper: generate PKCE code verifier and challenge
function generatePKCE(): { code_verifier: string; code_challenge: string } {
  const code_verifier = generateRandomString(64);
  const code_challenge = sha256Hash(code_verifier);
  return { code_verifier, code_challenge };
}

interface TokenPair {
  access_token: string;
  refresh_token: string;
}

interface JwtPayload {
  user_id: string;
  role: UserRole;
  session_id: string;
  type: 'access' | 'refresh';
}

/**
 * Generate JWT tokens with session tracking
 */
async function generateTokensWithSession(
  userId: string,
  role: UserRole,
  userAgent?: string,
  ip?: string
): Promise<TokenPair> {
  const sessionId = uuidv4();
  const refreshToken = generateRandomString(64);
  const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);

  // Calculate expiry
  const refreshExpiresAt = new Date();
  refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 30); // 30 days

  // Store session
  await query(
    `INSERT INTO auth_sessions (session_id, user_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userId, refreshTokenHash, userAgent || null, ip || null, refreshExpiresAt]
  );

  const accessPayload: JwtPayload = { user_id: userId, role, session_id: sessionId, type: 'access' };
  const access_token = jwt.sign(accessPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);

  // Refresh token includes session ID for lookup
  const refresh_token = `${sessionId}.${refreshToken}`;

  return { access_token, refresh_token };
}

/**
 * Start Google OAuth flow (PKCE)
 */
export async function startGoogleOAuth(
  input: OAuthStartInput
): Promise<{
  auth_url: string;
  state: string;
  code_verifier: string;
  expires_at: Date;
}> {
  const state = generateRandomString(32);
  const { code_verifier, code_challenge } = generatePKCE();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Store state and verifier hash
  await query(
    `INSERT INTO oauth_states (provider, state, code_verifier_hash, redirect_uri, flow, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [AuthProvider.GOOGLE, state, sha256Hash(code_verifier), input.redirect_uri, input.flow, expiresAt]
  );

  // Build Google OAuth URL
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: input.redirect_uri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  return {
    auth_url: `${GOOGLE_AUTH_URL}?${params.toString()}`,
    state,
    code_verifier,
    expires_at: expiresAt,
  };
}

/**
 * Complete Google OAuth callback
 */
export async function completeGoogleOAuth(
  input: OAuthCallbackInput,
  userAgent?: string,
  ip?: string
): Promise<{
  access_token: string;
  refresh_token: string;
  is_new_user: boolean;
  user: {
    user_id: string;
    role: UserRole;
    email: string | null;
    phone: string | null;
    email_verified_at: Date | null;
    phone_verified_at: Date | null;
  };
}> {
  return withTransaction(async (client) => {
    // 1. Validate state
    const stateResult = await client.query<{
      state_id: string;
      code_verifier_hash: string;
      redirect_uri: string;
      flow: string;
      consumed_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT * FROM oauth_states WHERE provider = $1 AND state = $2 FOR UPDATE`,
      [AuthProvider.GOOGLE, input.state]
    );

    if (stateResult.rows.length === 0) {
      throw new BadRequestError('Invalid OAuth state');
    }

    const stateRecord = stateResult.rows[0];

    if (stateRecord.consumed_at) {
      throw new BadRequestError('OAuth state already used');
    }

    if (new Date() > new Date(stateRecord.expires_at)) {
      throw new BadRequestError('OAuth state expired');
    }

    if (stateRecord.redirect_uri !== input.redirect_uri) {
      throw new BadRequestError('Redirect URI mismatch');
    }

    // Verify code_verifier
    if (sha256Hash(input.code_verifier) !== stateRecord.code_verifier_hash) {
      throw new BadRequestError('Invalid code verifier');
    }

    // Mark state as consumed
    await client.query(
      `UPDATE oauth_states SET consumed_at = now() WHERE state_id = $1`,
      [stateRecord.state_id]
    );

    // 2. Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code: input.code,
        grant_type: 'authorization_code',
        redirect_uri: input.redirect_uri,
        code_verifier: input.code_verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Google token exchange failed:', error);
      throw new BadRequestError('Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json() as { access_token: string; id_token: string };

    // 3. Get user info
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      throw new BadRequestError('Failed to get user info from Google');
    }

    const googleUser = await userInfoResponse.json() as {
      sub: string;
      email: string;
      email_verified: boolean;
      name: string;
      picture: string;
    };

    // 4. Find or create user
    let isNewUser = false;

    // Check if identity exists
    const identityResult = await client.query<{ user_id: string }>(
      `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_subject = $2`,
      [AuthProvider.GOOGLE, googleUser.sub]
    );

    let userId: string;

    if (identityResult.rows.length > 0) {
      // Existing user with Google identity
      userId = identityResult.rows[0].user_id;
    } else {
      // Check if user exists with same verified email
      const emailUserResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM users WHERE email = $1 AND email_verified_at IS NOT NULL`,
        [googleUser.email]
      );

      if (emailUserResult.rows.length > 0) {
        // Link Google to existing user
        userId = emailUserResult.rows[0].user_id;
      } else {
        // Create new user
        userId = uuidv4();
        isNewUser = true;

        await client.query(
          `INSERT INTO users (user_id, email, display_name, role, email_verified_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, googleUser.email, googleUser.name, UserRole.CUSTOMER, googleUser.email_verified ? new Date() : null]
        );
      }

      // Create auth identity
      await client.query(
        `INSERT INTO auth_identities (user_id, provider, provider_subject, email, email_verified, profile)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          userId,
          AuthProvider.GOOGLE,
          googleUser.sub,
          googleUser.email,
          googleUser.email_verified,
          JSON.stringify({ name: googleUser.name, picture: googleUser.picture }),
        ]
      );
    }

    // 5. Get user data
    const userResult = await client.query<User>(
      `SELECT * FROM users WHERE user_id = $1`,
      [userId]
    );
    const user = userResult.rows[0];

    // Update email_verified_at if Google email is verified
    if (googleUser.email_verified && user.email === googleUser.email && !user.email_verified_at) {
      await client.query(
        `UPDATE users SET email_verified_at = now() WHERE user_id = $1`,
        [userId]
      );
    }

    // 6. Generate tokens
    const tokenPair = await generateTokensWithSession(userId, user.role, userAgent, ip);

    // Audit log
    await logAuditEvent({
      actor_user_id: userId,
      actor_role: user.role,
      action: isNewUser ? 'USER_REGISTERED_OAUTH' : 'USER_LOGIN_OAUTH',
      target_type: 'user',
      target_id: userId,
      payload: { provider: AuthProvider.GOOGLE },
    });

    return {
      ...tokenPair,
      is_new_user: isNewUser,
      user: {
        user_id: user.user_id,
        role: user.role,
        email: user.email,
        phone: user.phone,
        email_verified_at: user.email_verified_at,
        phone_verified_at: user.phone_verified_at,
      },
    };
  });
}

/**
 * Link Google identity to existing user
 */
export async function linkGoogleIdentity(
  userId: string,
  input: OAuthCallbackInput
): Promise<{ linked: boolean }> {
  return withTransaction(async (client) => {
    // Similar to completeGoogleOAuth but links to existing user
    const stateResult = await client.query<{
      state_id: string;
      code_verifier_hash: string;
      redirect_uri: string;
      consumed_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT * FROM oauth_states WHERE provider = $1 AND state = $2 FOR UPDATE`,
      [AuthProvider.GOOGLE, input.state]
    );

    if (stateResult.rows.length === 0) {
      throw new BadRequestError('Invalid OAuth state');
    }

    const stateRecord = stateResult.rows[0];

    if (stateRecord.consumed_at) {
      throw new BadRequestError('OAuth state already used');
    }

    if (new Date() > new Date(stateRecord.expires_at)) {
      throw new BadRequestError('OAuth state expired');
    }

    if (sha256Hash(input.code_verifier) !== stateRecord.code_verifier_hash) {
      throw new BadRequestError('Invalid code verifier');
    }

    // Mark as consumed
    await client.query(
      `UPDATE oauth_states SET consumed_at = now() WHERE state_id = $1`,
      [stateRecord.state_id]
    );

    // Exchange code
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code: input.code,
        grant_type: 'authorization_code',
        redirect_uri: input.redirect_uri,
        code_verifier: input.code_verifier,
      }),
    });

    if (!tokenResponse.ok) {
      throw new BadRequestError('Failed to exchange authorization code');
    }

    const tokens = await tokenResponse.json() as { access_token: string };

    // Get user info
    const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    const googleUser = await userInfoResponse.json() as {
      sub: string;
      email: string;
      email_verified: boolean;
      name: string;
      picture: string;
    };

    // Check if this Google account is already linked
    const existingIdentity = await client.query(
      `SELECT user_id FROM auth_identities WHERE provider = $1 AND provider_subject = $2`,
      [AuthProvider.GOOGLE, googleUser.sub]
    );

    if (existingIdentity.rows.length > 0) {
      if (existingIdentity.rows[0].user_id === userId) {
        return { linked: true }; // Already linked to this user
      }
      throw new ConflictError('This Google account is already linked to another user');
    }

    // Create auth identity
    await client.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, email, email_verified, profile)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        AuthProvider.GOOGLE,
        googleUser.sub,
        googleUser.email,
        googleUser.email_verified,
        JSON.stringify({ name: googleUser.name, picture: googleUser.picture }),
      ]
    );

    return { linked: true };
  });
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(
  refreshToken: string,
  userAgent?: string,
  ip?: string
): Promise<{ access_token: string; refresh_token?: string }> {
  // Parse refresh token: sessionId.token
  const parts = refreshToken.split('.');
  if (parts.length !== 2) {
    throw new UnauthorizedError('Invalid refresh token format');
  }

  const [sessionId, token] = parts;

  // Find session
  const sessionResult = await query<{
    session_id: string;
    user_id: string;
    refresh_token_hash: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT * FROM auth_sessions WHERE session_id = $1`,
    [sessionId]
  );

  if (sessionResult.rows.length === 0) {
    throw new UnauthorizedError('Session not found');
  }

  const session = sessionResult.rows[0];

  if (session.revoked_at) {
    throw new UnauthorizedError('Session has been revoked');
  }

  if (new Date() > new Date(session.expires_at)) {
    throw new UnauthorizedError('Session expired');
  }

  // Verify token hash
  const isValid = await bcrypt.compare(token, session.refresh_token_hash);
  if (!isValid) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Get user
  const userResult = await query<User>(
    `SELECT * FROM users WHERE user_id = $1`,
    [session.user_id]
  );

  if (userResult.rows.length === 0) {
    throw new UnauthorizedError('User not found');
  }

  const user = userResult.rows[0];

  // Generate new access token
  const accessPayload: JwtPayload = {
    user_id: user.user_id,
    role: user.role,
    session_id: sessionId,
    type: 'access',
  };

  const access_token = jwt.sign(accessPayload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  } as jwt.SignOptions);

  return { access_token };
}

/**
 * Logout (revoke session)
 */
export async function logout(sessionId: string): Promise<void> {
  await query(
    `UPDATE auth_sessions SET revoked_at = now() WHERE session_id = $1`,
    [sessionId]
  );
}

/**
 * Send phone OTP
 */
export async function sendPhoneOtp(
  input: PhoneOtpSendInput
): Promise<{ otp_id: string; expires_at: Date }> {
  const otpCode = generateRandomString(6).replace(/[^0-9]/g, '').padStart(6, '0').substring(0, 6);
  const otpHash = await bcrypt.hash(otpCode, SALT_ROUNDS);
  const otpId = uuidv4();
  const expiresAt = new Date(Date.now() + config.otp.expiresMinutes * 60 * 1000);

  await query(
    `INSERT INTO phone_otps (otp_id, phone, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [otpId, input.phone, input.purpose, otpHash, expiresAt]
  );

  // In production, send OTP via SMS
  console.log(`[PHONE OTP] Phone ${input.phone}, Purpose ${input.purpose}: Code is ${otpCode}`);

  return { otp_id: otpId, expires_at: expiresAt };
}

/**
 * Verify phone OTP
 */
export async function verifyPhoneOtp(
  input: PhoneOtpVerifyInput,
  userAgent?: string,
  ip?: string
): Promise<{
  verified: boolean;
  access_token?: string;
  refresh_token?: string;
  user?: {
    user_id: string;
    role: UserRole;
    email: string | null;
    phone: string | null;
  };
}> {
  return withTransaction(async (client) => {
    const otpResult = await client.query<{
      otp_id: string;
      phone: string;
      purpose: string;
      code_hash: string;
      attempt_count: number;
      expires_at: Date;
      verified_at: Date | null;
    }>(
      `SELECT * FROM phone_otps WHERE otp_id = $1 FOR UPDATE`,
      [input.otp_id]
    );

    if (otpResult.rows.length === 0) {
      throw new BadRequestError('OTP not found');
    }

    const otp = otpResult.rows[0];

    if (otp.verified_at) {
      throw new BadRequestError('OTP already verified');
    }

    if (new Date() > new Date(otp.expires_at)) {
      throw new BadRequestError('OTP expired');
    }

    if (otp.purpose !== input.purpose) {
      throw new BadRequestError('OTP purpose mismatch');
    }

    if (otp.attempt_count >= config.otp.maxAttempts) {
      throw new BadRequestError('Max attempts exceeded');
    }

    // Increment attempt count
    await client.query(
      `UPDATE phone_otps SET attempt_count = attempt_count + 1 WHERE otp_id = $1`,
      [input.otp_id]
    );

    // Verify code
    const isValid = await bcrypt.compare(input.code, otp.code_hash);
    if (!isValid) {
      throw new BadRequestError('Invalid OTP code');
    }

    // Mark as verified
    await client.query(
      `UPDATE phone_otps SET verified_at = now() WHERE otp_id = $1`,
      [input.otp_id]
    );

    // For login purpose, find or create user
    if (input.purpose === OtpPurpose.LOGIN) {
      // Find user by phone
      let userResult = await client.query<User>(
        `SELECT * FROM users WHERE phone = $1`,
        [otp.phone]
      );

      let userId: string;
      let isNewUser = false;

      if (userResult.rows.length === 0) {
        // Create new user
        userId = uuidv4();
        isNewUser = true;

        await client.query(
          `INSERT INTO users (user_id, phone, role, phone_verified_at)
           VALUES ($1, $2, $3, now())`,
          [userId, otp.phone, UserRole.CUSTOMER]
        );

        // Create phone auth identity
        await client.query(
          `INSERT INTO auth_identities (user_id, provider, provider_subject, phone)
           VALUES ($1, $2, $3, $4)`,
          [userId, AuthProvider.PHONE, otp.phone, otp.phone]
        );

        userResult = await client.query<User>(
          `SELECT * FROM users WHERE user_id = $1`,
          [userId]
        );
      } else {
        userId = userResult.rows[0].user_id;

        // Update phone_verified_at
        await client.query(
          `UPDATE users SET phone_verified_at = now() WHERE user_id = $1`,
          [userId]
        );
      }

      const user = userResult.rows[0];
      const tokenPair = await generateTokensWithSession(userId, user.role, userAgent, ip);

      return {
        verified: true,
        ...tokenPair,
        user: {
          user_id: user.user_id,
          role: user.role,
          email: user.email,
          phone: user.phone,
        },
      };
    }

    return { verified: true };
  });
}

/**
 * Link phone to existing user
 */
export async function linkPhone(
  userId: string,
  otpId: string
): Promise<{ linked: boolean; phone_verified_at: Date | null }> {
  return withTransaction(async (client) => {
    // Verify OTP was verified
    const otpResult = await client.query<{
      phone: string;
      verified_at: Date | null;
    }>(
      `SELECT phone, verified_at FROM phone_otps WHERE otp_id = $1`,
      [otpId]
    );

    if (otpResult.rows.length === 0) {
      throw new BadRequestError('OTP not found');
    }

    const otp = otpResult.rows[0];

    if (!otp.verified_at) {
      throw new BadRequestError('OTP not verified');
    }

    // Check if phone is already linked to another user
    const existingUser = await client.query(
      `SELECT user_id FROM users WHERE phone = $1 AND user_id != $2`,
      [otp.phone, userId]
    );

    if (existingUser.rows.length > 0) {
      throw new ConflictError('Phone already linked to another user');
    }

    // Update user's phone
    const now = new Date();
    await client.query(
      `UPDATE users SET phone = $1, phone_verified_at = $2 WHERE user_id = $3`,
      [otp.phone, now, userId]
    );

    // Create or update phone auth identity
    await client.query(
      `INSERT INTO auth_identities (user_id, provider, provider_subject, phone)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (provider, provider_subject) DO UPDATE SET user_id = $1`,
      [userId, AuthProvider.PHONE, otp.phone, otp.phone]
    );

    return { linked: true, phone_verified_at: now };
  });
}

/**
 * Create case access token for guest
 */
export async function createCaseAccessToken(
  caseId: string,
  scope: CaseAccessScope = CaseAccessScope.PROGRESS_ONLY
): Promise<{ token: string; expires_at: Date }> {
  const token = generateRandomString(64);
  const tokenHash = sha256Hash(token);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  await query(
    `INSERT INTO case_access_tokens (case_id, token_hash, scope, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [caseId, tokenHash, scope, expiresAt]
  );

  return { token, expires_at: expiresAt };
}

/**
 * Verify case access token
 */
export async function verifyCaseAccessToken(
  caseId: string,
  token: string
): Promise<{ valid: boolean; scope: CaseAccessScope | null }> {
  const tokenHash = sha256Hash(token);

  const result = await query<{ scope: CaseAccessScope; expires_at: Date }>(
    `SELECT scope, expires_at FROM case_access_tokens
     WHERE case_id = $1 AND token_hash = $2`,
    [caseId, tokenHash]
  );

  if (result.rows.length === 0) {
    return { valid: false, scope: null };
  }

  const record = result.rows[0];

  if (new Date() > new Date(record.expires_at)) {
    return { valid: false, scope: null };
  }

  return { valid: true, scope: record.scope };
}
