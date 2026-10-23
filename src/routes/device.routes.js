import { Router } from 'express';

import {
  testConnection,
  syncEmployees,
  syncAttendances
} from '../controllers/device.controller.js';

const router = Router();

router.get('/test', testConnection);
router.post('/sync-users', syncEmployees);
router.post('/sync-attendances', syncAttendances);

export default router;
