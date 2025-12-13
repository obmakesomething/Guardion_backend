import { Router } from 'express';
import { authRoutes, oauthRoutes } from '../modules/auth';
import { sseRoutes } from '../modules/realtime';
import customerRoutes from './customer.routes';
import callcenterRoutes from './callcenter.routes';
import techRoutes from './tech.routes';

const router = Router();

// Auth routes (public and protected)
router.use('/auth', authRoutes);
router.use('/auth', oauthRoutes);

// Get current user (/me is part of auth routes)
// /me endpoint is in auth.routes.ts

// Customer routes
router.use('/', customerRoutes);

// Callcenter routes
router.use('/', callcenterRoutes);

// Tech routes
router.use('/tech', techRoutes);

// Realtime SSE routes
router.use('/realtime', sseRoutes);

export default router;
