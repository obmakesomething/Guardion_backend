import { Router, Request, Response, NextFunction } from 'express';
import { validateBody } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import {
  oauthStartSchema,
  oauthCallbackSchema,
  oauthLinkSchema,
  phoneOtpSendSchema,
  phoneOtpVerifySchema,
  linkPhoneSchema,
  refreshSchema,
} from './oauth.schema';
import * as oauthService from './oauth.service';

const router = Router();

// POST /auth/oauth/google/start
router.post(
  '/oauth/google/start',
  validateBody(oauthStartSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await oauthService.startGoogleOAuth(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/oauth/google/callback
router.post(
  '/oauth/google/callback',
  validateBody(oauthCallbackSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userAgent = req.headers['user-agent'];
      const ip = req.ip || req.socket.remoteAddress;
      const result = await oauthService.completeGoogleOAuth(req.body, userAgent, ip);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/oauth/google/link (requires auth)
router.post(
  '/oauth/google/link',
  authenticate,
  validateBody(oauthLinkSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await oauthService.linkGoogleIdentity(req.user!.user_id, req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/refresh
router.post(
  '/refresh',
  validateBody(refreshSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userAgent = req.headers['user-agent'];
      const ip = req.ip || req.socket.remoteAddress;
      const result = await oauthService.refreshAccessToken(req.body.refresh_token, userAgent, ip);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/logout (requires auth)
router.post(
  '/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract session ID from token
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        const jwt = await import('jsonwebtoken');
        const decoded = jwt.default.decode(token) as { session_id?: string };
        if (decoded?.session_id) {
          await oauthService.logout(decoded.session_id);
        }
      }
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/phone/send
router.post(
  '/phone/send',
  validateBody(phoneOtpSendSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await oauthService.sendPhoneOtp(req.body);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/phone/verify
router.post(
  '/phone/verify',
  validateBody(phoneOtpVerifySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userAgent = req.headers['user-agent'];
      const ip = req.ip || req.socket.remoteAddress;
      const result = await oauthService.verifyPhoneOtp(req.body, userAgent, ip);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/link-phone (requires auth)
router.post(
  '/link-phone',
  authenticate,
  validateBody(linkPhoneSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await oauthService.linkPhone(req.user!.user_id, req.body.otp_id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
