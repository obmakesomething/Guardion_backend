import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';
import { UserRole } from '../types';
import { query } from '../db/pool';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        user_id: string;
        role: UserRole;
        email: string | null;
        phone: string | null;
        display_name: string | null;
        orgs: Array<{ org_id: string; org_name: string; scope: string }>;
      };
    }
  }
}

interface JwtPayload {
  user_id: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid authorization header');
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;

    // Fetch user data and org memberships
    const userResult = await query<{
      user_id: string;
      role: UserRole;
      email: string | null;
      phone: string | null;
      display_name: string | null;
    }>(
      `SELECT user_id, role, email, phone, display_name
       FROM users WHERE user_id = $1`,
      [decoded.user_id]
    );

    if (userResult.rows.length === 0) {
      throw new UnauthorizedError('User not found');
    }

    const user = userResult.rows[0];

    // Fetch org memberships
    const orgsResult = await query<{ org_id: string; org_name: string; scope: string }>(
      `SELECT om.org_id, o.name as org_name, om.scope
       FROM org_memberships om
       JOIN orgs o ON o.org_id = om.org_id
       WHERE om.user_id = $1`,
      [decoded.user_id]
    );

    req.user = {
      ...user,
      orgs: orgsResult.rows,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Token expired'));
    } else if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid token'));
    } else {
      next(error);
    }
  }
}

// Optional authentication - doesn't fail if no token, but validates if present
export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next();
  }
  return authenticate(req, res, next);
}

// Role-based access control
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError(`Role ${req.user.role} is not allowed`));
    }

    next();
  };
}

// Check if user belongs to a specific org
export function requireOrgMembership(getOrgId: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    // Admin can access any org
    if (req.user.role === UserRole.ADMIN) {
      return next();
    }

    const orgId = getOrgId(req);
    const membership = req.user.orgs.find((o) => o.org_id === orgId);

    if (!membership) {
      return next(new ForbiddenError('Not a member of this organization'));
    }

    next();
  };
}

// Check if user is the owner of a resource (customer checking their own case)
export function requireOwnership(getOwnerId: (req: Request) => string | null) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new UnauthorizedError());
    }

    // Admin can access anything
    if (req.user.role === UserRole.ADMIN) {
      return next();
    }

    const ownerId = getOwnerId(req);
    if (ownerId !== req.user.user_id) {
      return next(new ForbiddenError('Not authorized to access this resource'));
    }

    next();
  };
}
