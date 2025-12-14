import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { UserRole } from '../types';
import { createAuditContext } from '../modules/audit';

// Case
import {
  createCaseSchema,
  caseIdParamSchema,
  cancelCaseSchema,
  getCasesQuerySchema,
  GetCasesQuery,
} from '../modules/case/case.schema';
import * as caseService from '../modules/case/case.service';

// Evidence
import { evidencePresignSchema, evidenceCompleteSchema } from '../modules/evidence/evidence.schema';
import * as evidenceService from '../modules/evidence/evidence.service';

// OTP
import { otpVerifySchema } from '../modules/otp/otp.schema';
import * as otpService from '../modules/otp/otp.service';

// Opinion
import * as opinionService from '../modules/opinion/opinion.service';

const router = Router();

// All customer routes require authentication
router.use(authenticate);
router.use(requireRole(UserRole.CUSTOMER, UserRole.ADMIN));

/**
 * POST /cases - Create a new case
 */
router.post(
  '/cases',
  validateBody(createCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const newCase = await caseService.createCase(
        req.body,
        req.user!.user_id,
        auditContext
      );
      res.status(201).json(newCase);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /cases - List customer's cases
 */
router.get(
  '/cases',
  validateQuery(getCasesQuerySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cases = await caseService.getCustomerCases(
        req.user!.user_id,
        req.query as unknown as GetCasesQuery
      );
      res.json({ cases });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /cases/:caseId - Get case detail
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
      // Verify ownership
      if (caseDetail.customer_id !== req.user!.user_id && req.user!.role !== UserRole.ADMIN) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Not your case' });
        return;
      }
      res.json(caseDetail);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /cases/:caseId/cancel - Cancel a case
 */
router.post(
  '/cases/:caseId/cancel',
  validateParams(caseIdParamSchema),
  validateBody(cancelCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const caseData = await caseService.getCaseById(req.params.caseId);
      if (!caseData) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Case not found' });
        return;
      }
      if (caseData.customer_id !== req.user!.user_id && req.user!.role !== UserRole.ADMIN) {
        res.status(403).json({ code: 'FORBIDDEN', message: 'Not your case' });
        return;
      }

      const auditContext = createAuditContext(req.user!);
      const cancelledCase = await caseService.cancelCase(
        req.params.caseId,
        req.body.reason,
        auditContext
      );
      res.json(cancelledCase);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /cases/:caseId/evidence/presign - Get presigned upload URL
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
 * POST /cases/:caseId/evidence/complete - Complete evidence upload
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
 * POST /cases/:caseId/otp/verify - Verify OTP (complete case)
 */
router.post(
  '/cases/:caseId/otp/verify',
  validateParams(caseIdParamSchema),
  validateBody(otpVerifySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const result = await otpService.verifyOtp(
        req.params.caseId,
        req.body.otp,
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
 * GET /cases/:caseId/report - Get report link
 */
router.get(
  '/cases/:caseId/report',
  validateParams(caseIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await opinionService.getReportLink(
        req.params.caseId,
        req.user!.user_id,
        req.user!.role
      );
      if (!result) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Report not available' });
        return;
      }
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
