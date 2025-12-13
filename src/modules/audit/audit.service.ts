import { query } from '../../db/pool';
import { AuditAction, AuditEvent, UserRole } from '../../types';

export interface AuditContext {
  actor_user_id: string | null;
  actor_role: UserRole | null;
  actor_org_id?: string | null;
}

export interface LogAuditParams extends AuditContext {
  action: AuditAction | string;
  target_type: string;
  target_id: string;
  payload?: Record<string, unknown>;
}

/**
 * Log an audit event to the database
 */
export async function logAuditEvent(params: LogAuditParams): Promise<void> {
  const {
    actor_user_id,
    actor_role,
    actor_org_id = null,
    action,
    target_type,
    target_id,
    payload = {},
  } = params;

  await query(
    `INSERT INTO audit_events (actor_user_id, actor_role, actor_org_id, action, target_type, target_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actor_user_id, actor_role, actor_org_id, action, target_type, target_id, JSON.stringify(payload)]
  );
}

/**
 * Get audit events for a specific target
 */
export async function getAuditEventsForTarget(
  targetType: string,
  targetId: string,
  limit = 100
): Promise<AuditEvent[]> {
  const result = await query<AuditEvent>(
    `SELECT * FROM audit_events
     WHERE target_type = $1 AND target_id = $2
     ORDER BY ts DESC
     LIMIT $3`,
    [targetType, targetId, limit]
  );
  return result.rows;
}

/**
 * Get audit events by user
 */
export async function getAuditEventsByUser(
  userId: string,
  limit = 100
): Promise<AuditEvent[]> {
  const result = await query<AuditEvent>(
    `SELECT * FROM audit_events
     WHERE actor_user_id = $1
     ORDER BY ts DESC
     LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

/**
 * Get audit events by action type
 */
export async function getAuditEventsByAction(
  action: AuditAction | string,
  limit = 100
): Promise<AuditEvent[]> {
  const result = await query<AuditEvent>(
    `SELECT * FROM audit_events
     WHERE action = $1
     ORDER BY ts DESC
     LIMIT $2`,
    [action, limit]
  );
  return result.rows;
}

/**
 * Create audit context from request user
 */
export function createAuditContext(user: {
  user_id: string;
  role: UserRole;
  orgs?: Array<{ org_id: string }>;
}): AuditContext {
  return {
    actor_user_id: user.user_id,
    actor_role: user.role,
    actor_org_id: user.orgs?.[0]?.org_id ?? null,
  };
}

/**
 * Create audit context for system actions (no user)
 */
export function systemAuditContext(): AuditContext {
  return {
    actor_user_id: null,
    actor_role: null,
    actor_org_id: null,
  };
}
