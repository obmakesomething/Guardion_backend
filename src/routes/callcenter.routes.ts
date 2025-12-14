import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole, requireOrgMembership } from '../middleware/auth';
import { validateBody, validateParams, validateQuery } from '../middleware/validate';
import { UserRole } from '../types';
import { createAuditContext } from '../modules/audit';

// Case
import {
  caseIdParamSchema,
  setRiskSchema,
  getCasesQuerySchema,
  cancelCaseSchema,
  GetCasesQuery,
} from '../modules/case/case.schema';
import * as caseService from '../modules/case/case.service';

// Dispatch
import {
  createDispatchOffersSchema,
  assignTechSchema,
} from '../modules/dispatch/dispatch.schema';
import * as dispatchService from '../modules/dispatch/dispatch.service';

// Evidence
import * as evidenceService from '../modules/evidence/evidence.service';

// Billing
import {
  getAccrualsQuerySchema,
  generateInvoiceSchema,
  GetAccrualsQuery,
} from '../modules/billing/billing.schema';
import * as billingService from '../modules/billing/billing.service';

// Opinion
import * as opinionService from '../modules/opinion/opinion.service';

import { z } from 'zod';

const orgIdParamSchema = z.object({
  orgId: z.string().uuid(),
});

const router = Router();

// All callcenter routes require authentication
router.use(authenticate);
router.use(requireRole(UserRole.CALLCENTER, UserRole.ADMIN));

/**
 * GET /orgs/:orgId/cases - List cases for org queue
 */
router.get(
  '/orgs/:orgId/cases',
  validateParams(orgIdParamSchema),
  validateQuery(getCasesQuerySchema),
  requireOrgMembership((req) => req.params.orgId),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cases = await caseService.getOrgCases(
        req.params.orgId,
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
      res.json(caseDetail);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /cases/:caseId/risk - Set risk decision
 */
router.post(
  '/cases/:caseId/risk',
  validateParams(caseIdParamSchema),
  validateBody(setRiskSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const updatedCase = await caseService.setRiskDecision(
        req.params.caseId,
        req.body,
        auditContext
      );
      res.json(updatedCase);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /cases/:caseId/dispatch/offers - Create dispatch offers
 */
router.post(
  '/cases/:caseId/dispatch/offers',
  validateParams(caseIdParamSchema),
  validateBody(createDispatchOffersSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const offers = await dispatchService.createDispatchOffers(
        req.params.caseId,
        req.body,
        auditContext
      );
      res.status(201).json({ offers });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /cases/:caseId/accept - Accept case (creates accrual)
 */
router.post(
  '/cases/:caseId/accept',
  validateParams(caseIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get the org to use - prefer first org membership
      const orgId = req.user!.orgs[0]?.org_id;
      if (!orgId && req.user!.role !== UserRole.ADMIN) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'No organization membership' });
        return;
      }

      const auditContext = createAuditContext(req.user!);
      const result = await dispatchService.acceptCase(
        req.params.caseId,
        orgId || 'admin-org', // Admin fallback
        auditContext
      );
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /cases/:caseId/assign - Assign tech to case
 */
router.post(
  '/cases/:caseId/assign',
  validateParams(caseIdParamSchema),
  validateBody(assignTechSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const updatedCase = await dispatchService.assignTech(
        req.params.caseId,
        req.body,
        auditContext
      );
      res.json(updatedCase);
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
 * GET /cases/:caseId/evidence - Get case evidence
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
 * GET /cases/:caseId/report - Get report
 */
router.get(
  '/cases/:caseId/report',
  validateParams(caseIdParamSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const opinion = await opinionService.getOpinionReport(req.params.caseId);
      if (!opinion) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'Report not available' });
        return;
      }
      res.json(opinion);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /techs/available - Get available technicians
 */
router.get(
  '/techs/available',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const techs = await dispatchService.getAvailableTechs();
      res.json({ techs });
    } catch (error) {
      next(error);
    }
  }
);

// --- Billing routes ---

/**
 * GET /orgs/:orgId/accruals - List accruals for org
 */
router.get(
  '/orgs/:orgId/accruals',
  validateParams(orgIdParamSchema),
  validateQuery(getAccrualsQuerySchema),
  requireOrgMembership((req) => req.params.orgId),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accruals = await billingService.getOrgAccruals(
        req.params.orgId,
        req.query as unknown as GetAccrualsQuery
      );
      res.json({ accruals });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /orgs/:orgId/billing/summary - Get billing summary
 */
router.get(
  '/orgs/:orgId/billing/summary',
  validateParams(orgIdParamSchema),
  requireOrgMembership((req) => req.params.orgId),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await billingService.getOrgBillingSummary(req.params.orgId);
      res.json(summary);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /orgs/:orgId/invoices/generate - Generate invoice
 */
router.post(
  '/orgs/:orgId/invoices/generate',
  validateParams(orgIdParamSchema),
  validateBody(generateInvoiceSchema),
  requireOrgMembership((req) => req.params.orgId),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const auditContext = createAuditContext(req.user!);
      const invoice = await billingService.generateInvoice(
        req.params.orgId,
        req.body,
        auditContext
      );
      res.status(201).json(invoice);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /orgs/:orgId/invoices - List invoices
 */
router.get(
  '/orgs/:orgId/invoices',
  validateParams(orgIdParamSchema),
  requireOrgMembership((req) => req.params.orgId),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoices = await billingService.getOrgInvoices(req.params.orgId);
      res.json({ invoices });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
