import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { validateBody, validateParams } from '../middleware/validate';
import { UserRole } from '../types';
import { createAuditContext } from '../modules/audit';

// Case
import {
  caseIdParamSchema,
  updateCaseStatusSchema,
} from '../modules/case/case.schema';
import * as caseService from '../modules/case/case.service';

// Dispatch
import { techLocationPingSchema, respondToOfferSchema } from '../modules/dispatch/dispatch.schema';
import * as dispatchService from '../modules/dispatch/dispatch.service';

// Evidence
import { evidencePresignSchema, evidenceCompleteSchema } from '../modules/evidence/evidence.schema';
import * as evidenceService from '../modules/evidence/evidence.service';

// OTP
import * as otpService from '../modules/otp/otp.service';

// Opinion
import { submitOpinionSchema } from '../modules/opinion/opinion.schema';
import * as opinionService from '../modules/opinion/opinion.service';

import { z } from 'zod';

const offerIdParamSchema = z.object({
  offerId: z.string().uuid(),
});

const router = Router();

// All tech routes require authentication
router.use(authenticate);
router.use(requireRole(UserRole.TECH, UserRole.ADMIN));

/**
 * GET /tech/cases/assigned - List assigned cases
 */
router.get(
  '/cases/assigned',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cases = await caseService.getTechAssignedCases(req.user!.user_id);
      res.json({ cases });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /tech/cases/:caseId - Get case detail
 */
router.get(
  '/cases/:caseId',
  validateParams(caseIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseDetail = await caseService.getCaseDetail(
        req.params.caseId,
        req.user!.user_id,
        req.user!.role
      );
      if (!caseDetail) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Case not found' });
        return;
      }
      // Verify assignment
      if (caseDetail.assigned_tech_id !== req.user!.user_id && req.user!.role !== UserRole.ADMIN) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Not assigned to this case' });
        return;
      }
      res.json(caseDetail);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/cases/:caseId/status - Update case status
 */
router.post(
  '/cases/:caseId/status',
  validateParams(caseIdParamSchema),
  validateBody(updateCaseStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const updatedCase = await caseService.updateCaseStatus(
        req.params.caseId,
        req.body.status,
        req.user!.user_id,
        auditContext,
        req.body.note
      );
      res.json(updatedCase);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/location/ping - Send GPS ping
 */
router.post(
  '/location/ping',
  validateBody(techLocationPingSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      await dispatchService.recordTechLocationPing(
        req.user!.user_id,
        req.body,
        auditContext
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/offers/:offerId/respond - Respond to dispatch offer
 */
router.post(
  '/offers/:offerId/respond',
  validateParams(offerIdParamSchema),
  validateBody(respondToOfferSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const offer = await dispatchService.respondToDispatchOffer(
        req.params.offerId,
        req.body.accept,
        req.user!.user_id,
        auditContext
      );
      res.json(offer);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/cases/:caseId/evidence/presign - Get presigned upload URL
 */
router.post(
  '/cases/:caseId/evidence/presign',
  validateParams(caseIdParamSchema),
  validateBody(evidencePresignSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await evidenceService.createPresignedUploadUrl(
        req.params.caseId,
        req.body,
        req.user!.user_id,
        req.user!.role
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/cases/:caseId/evidence/complete - Complete evidence upload
 */
router.post(
  '/cases/:caseId/evidence/complete',
  validateParams(caseIdParamSchema),
  validateBody(evidenceCompleteSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const evidence = await evidenceService.completeEvidenceUpload(
        req.params.caseId,
        req.body,
        req.user!.user_id,
        req.user!.role,
        auditContext
      );
      res.status(201).json(evidence);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /tech/cases/:caseId/evidence - Get case evidence
 */
router.get(
  '/cases/:caseId/evidence',
  validateParams(caseIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const evidence = await evidenceService.getCaseEvidence(
        req.params.caseId,
        req.user!.user_id,
        req.user!.role,
        auditContext
      );
      res.json({ evidence });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/cases/:caseId/otp/request - Request OTP
 */
router.post(
  '/cases/:caseId/otp/request',
  validateParams(caseIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const result = await otpService.requestOtp(
        req.params.caseId,
        req.user!.user_id,
        auditContext
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /tech/cases/:caseId/opinion - Submit opinion report
 */
router.post(
  '/cases/:caseId/opinion',
  validateParams(caseIdParamSchema),
  validateBody(submitOpinionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const opinion = await opinionService.submitOpinion(
        req.params.caseId,
        req.body,
        req.user!.user_id,
        auditContext
      );
      res.json(opinion);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
