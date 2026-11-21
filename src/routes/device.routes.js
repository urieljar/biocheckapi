import { Router } from 'express';

import {
  testConnection,
  syncEmployees,
  syncAttendances
} from '../controllers/device.controller.js';
import { checkEmployeePresence } from '../controllers/device.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';
import { getAdmsEvents } from '../controllers/device-adms-event.controller.js';

const router = Router();

// Descargar checadas es operación diaria (ROOT, ADMIN y SUPERVISOR).
// Importar usuarios del reloj puede desactivar empleados en masa: ROOT y ADMIN.
router.get('/test', testConnection);
router.get('/adms-events', getAdmsEvents);
router.post('/verify-employees', requireCapability('employee.write'), checkEmployeePresence);
router.post('/sync-users', requireCapability('device.import'), syncEmployees);
router.post('/sync-attendances', requireCapability('attendance.sync'), syncAttendances);

export default router;
