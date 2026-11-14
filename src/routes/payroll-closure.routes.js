import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.middleware.js';
import { getPayrollClosures, closePayroll, reopenPayroll } from '../controllers/payroll-closure.controller.js';

const router = Router();
router.get('/', getPayrollClosures);
router.post('/', requireCapability('payroll.close'), closePayroll);
router.post('/:id/reopen', requireCapability('payroll.reopen'), reopenPayroll);
export default router;
