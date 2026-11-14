import { Router } from 'express';
import { getOrphanAttendances, reviewOrphanAttendance } from '../controllers/report.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';

const router = Router();
router.get('/orphan-attendances', getOrphanAttendances);
router.post('/orphan-attendances/:id/assign', requireCapability('attendance.write'), reviewOrphanAttendance);
export default router;
