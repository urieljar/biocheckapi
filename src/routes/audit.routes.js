import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.middleware.js';
import { listAuditLogs, exportAuditLogs } from '../controllers/audit.controller.js';

const router = Router();
router.get('/export.csv', requireCapability('audit.read'), exportAuditLogs);
router.get('/', requireCapability('audit.read'), listAuditLogs);
export default router;
