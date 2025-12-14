import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { UserRole } from '../../types';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import { eventEmitter } from './eventEmitter';
import { getCaseById } from '../case/case.service';
import { query } from '../../db/pool';

const router = Router();

/**
 * SSE endpoint for case events (customer + permitted roles)
 * GET /realtime/cases/:caseId
 */
router.get(
  '/cases/:caseId',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { caseId } = req.params;
      const user = req.user!;

      // Verify case exists and user has access
      const caseData = await getCaseById(caseId);
      if (!caseData) {
        throw new NotFoundError('Case', caseId);
      }

      // Access control
      if (user.role === UserRole.CUSTOMER) {
        if (caseData.customer_id !== user.user_id) {
          throw new ForbiddenError('Cannot access this case');
        }
      } else if (user.role === UserRole.TECH) {
        if (caseData.assigned_tech_id !== user.user_id) {
          throw new ForbiddenError('Cannot access this case');
        }
      } else if (user.role === UserRole.CALLCENTER) {
        // Check org membership if case is assigned to an org
        if (caseData.assigned_org_id) {
          const isMember = user.orgs.some((o) => o.org_id === caseData.assigned_org_id);
          if (!isMember) {
            throw new ForbiddenError('Cannot access this case');
          }
        }
      }
      // Admin can access any case

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      });

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ case_id: caseId })}\n\n`);

      // Subscribe to case events
      const unsubscribe = eventEmitter.subscribeToCaseEvents(caseId, (data) => {
        res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
      });

      // Heartbeat every 30 seconds
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      // Cleanup on close
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * SSE endpoint for org queue events (callcenter)
 * GET /realtime/orgs/:orgId/cases
 */
router.get(
  '/orgs/:orgId/cases',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orgId } = req.params;
      const user = req.user!;

      // Only callcenter and admin can access org queue
      if (user.role !== UserRole.CALLCENTER && user.role !== UserRole.ADMIN) {
        throw new ForbiddenError('Only callcenter can access org queue');
      }

      // Verify org membership (unless admin)
      if (user.role !== UserRole.ADMIN) {
        const isMember = user.orgs.some((o) => o.org_id === orgId);
        if (!isMember) {
          throw new ForbiddenError('Not a member of this organization');
        }
      }

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ org_id: orgId })}\n\n`);

      // Subscribe to org events
      const unsubscribe = eventEmitter.subscribeToOrgEvents(orgId, (data) => {
        res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      // Cleanup on close
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * SSE endpoint for tech events (tech app)
 * GET /realtime/tech/me
 */
router.get(
  '/tech/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;

      // Only tech can access this endpoint
      if (user.role !== UserRole.TECH && user.role !== UserRole.ADMIN) {
        throw new ForbiddenError('Only technicians can access this endpoint');
      }

      const techId = user.user_id;

      // Set SSE headers
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Send initial connection event
      res.write(`event: connected\ndata: ${JSON.stringify({ tech_id: techId })}\n\n`);

      // Subscribe to tech events
      const unsubscribe = eventEmitter.subscribeToTechEvents(techId, (data) => {
        res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      // Cleanup on close
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
