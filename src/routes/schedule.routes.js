import { Router } from 'express';

import {
  createSchedule,
  getSchedules,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  assignSchedule
} from '../controllers/schedule.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';

const router = Router();

// Los horarios se consultan con cualquier rol y se modifican con schedule.write.
router.get('/', getSchedules);
router.get('/:id', getSchedule);
router.post('/', requireCapability('schedule.write'), createSchedule);
router.patch('/:id', requireCapability('schedule.write'), updateSchedule);
router.delete('/:id', requireCapability('schedule.write'), deleteSchedule);
router.post('/:scheduleId/assign', requireCapability('schedule.write'), assignSchedule);

export default router;
