import { Router, Request, Response, NextFunction } from 'express';
import { validateBody } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import {
  loginSchema,
  registerSchema,
  verifyPhoneSchema,
  refreshTokenSchema,
} from './auth.schema';
import * as authService from './auth.service';

const router = Router();

// POST /auth/register
router.post(
  '/register',
  validateBody(registerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user, tokens } = await authService.registerUser(req.body);
      res.status(201).json({
        user: {
          user_id: user.user_id,
          role: user.role,
          email: user.email,
          phone: user.phone,
          display_name: user.display_name,
        },
        ...tokens,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/login
router.post(
  '/login',
  validateBody(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user, tokens } = await authService.login(req.body);
      res.json({
        user: {
          user_id: user.user_id,
          role: user.role,
          email: user.email,
          phone: user.phone,
          display_name: user.display_name,
        },
        ...tokens,
      });
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/refresh
router.post(
  '/refresh',
  validateBody(refreshTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tokens = await authService.refreshAccessTokenSimple(req.body.refresh_token);
      res.json(tokens);
    } catch (error) {
      next(error);
    }
  }
);

// POST /auth/verify-phone
router.post(
  '/verify-phone',
  validateBody(verifyPhoneSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await authService.verifyPhone(req.body.phone, req.body.code);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// GET /me
router.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await authService.getUserWithOrgs(req.user!.user_id);
      if (!data) {
        res.status(404).json({ code: 'NOT_FOUND', message: 'User not found' });
        return;
      }
      res.json({
        user_id: data.user.user_id,
        role: data.user.role,
        email: data.user.email,
        phone: data.user.phone,
        display_name: data.user.display_name,
        orgs: data.orgs,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
