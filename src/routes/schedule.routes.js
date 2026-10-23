import { Router } from 'express';

import {
  createSchedule,
  getSchedules,
  assignSchedule
} from '../controllers/schedule.controller.js';

const router = Router();

router.get('/', getSchedules);
router.post('/', createSchedule);
router.post('/:scheduleId/assign', assignSchedule);

export default router;