import { Router } from 'express';
import {
  getCalendarExceptions,
  getCalendarException,
  createCalendarException,
  updateCalendarException,
  deleteCalendarException
} from '../controllers/calendar-exception.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';

const router = Router();

// Las incidencias se consultan con cualquier rol; se modifican con exception.write.
router.get('/', getCalendarExceptions);
router.get('/:id', getCalendarException);
router.post('/', requireCapability('exception.write'), createCalendarException);
router.patch('/:id', requireCapability('exception.write'), updateCalendarException);
router.delete('/:id', requireCapability('exception.write'), deleteCalendarException);

export default router;
