import { Router } from 'express';
import { health, readiness, deviceHealthStatus } from '../controllers/health.controller.js';
import { authenticate } from '../middlewares/auth.middleware.js';

const router = Router();
router.get('/', health);
router.get('/ready', readiness);
router.get('/devices', authenticate, deviceHealthStatus);

export default router;
