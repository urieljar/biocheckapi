import { Router } from 'express';
import {
  getAttendances,
  createManualAttendance,
  deleteManualAttendance
} from '../controllers/attendance.controller.js';
import { getEvents, getEventFilters, exportEvents, exportEventsExcel } from '../controllers/event-report.controller.js';
import { authenticate, requireCapability } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', getAttendances);
router.get('/events', getEvents);
router.get('/filters', getEventFilters);
router.get('/export.csv', exportEvents);
router.get('/export.xls', exportEventsExcel);

// Registro manual de checada olvidada
router.post('/manual', authenticate, requireCapability('attendance.write'), createManualAttendance);
router.post('/', authenticate, requireCapability('attendance.write'), createManualAttendance);
router.delete('/manual/:id', authenticate, requireCapability('attendance.write'), deleteManualAttendance);
router.delete('/:id', authenticate, requireCapability('attendance.write'), deleteManualAttendance);

export default router;
