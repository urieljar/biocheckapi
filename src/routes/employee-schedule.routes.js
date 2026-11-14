import { Router } from 'express';
import {
  getEmployeeSchedules,
  getEmployeeScheduleById,
  updateEmployeeSchedule,
  deleteEmployeeSchedule
} from '../controllers/schedule.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', getEmployeeSchedules);
router.get('/:id', getEmployeeScheduleById);
router.patch('/:id', requireCapability('schedule.write'), updateEmployeeSchedule);
router.delete('/:id', requireCapability('schedule.write'), deleteEmployeeSchedule);

export default router;
