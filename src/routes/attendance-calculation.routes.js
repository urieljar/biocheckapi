import { Router } from 'express';
import {
  getEmployeeAttendanceCalculation,
  getBatchAttendanceCalculation
} from '../controllers/attendance-calculation.controller.js';

const router = Router();

router.get('/', getBatchAttendanceCalculation);
router.get('/batch', getBatchAttendanceCalculation);
router.get('/employees/:employeeId', getEmployeeAttendanceCalculation);

export default router;
