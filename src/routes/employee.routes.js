import { Router } from 'express';
import {
  createEmployee,
  getEmployee,
  queueEmployeeAdmsSync,
  syncEmployeeToDeviceById,
  syncPendingEmployeesToDevice,
  updateEmployeeDeviceSettings,
  getEmployeeProfile,
  createEmployeeProfile,
  updateEmployeeProfile,
  getEmployees
} from '../controllers/employee.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';
import { terminate, rehire, archive, restore, employmentHistory } from '../controllers/employee-lifecycle.controller.js';
import { getEmployeeSyncStatus } from '../controllers/employee-sync-status.controller.js';

const router = Router();

// Consulta abierta a cualquier rol; escritura con employee.write (CONSULTA solo lee).
router.get('/', getEmployees);
router.post('/', requireCapability('employee.write'), createEmployee);
router.post('/sync-pending-to-device', requireCapability('employee.write'), syncPendingEmployeesToDevice);
router.get('/:id/sync-status', getEmployeeSyncStatus);
router.get('/:id', getEmployee);
router.post('/:id/termination', requireCapability('employee.status'), terminate);
router.post('/:id/rehire', requireCapability('employee.status'), rehire);
router.delete('/:id', requireCapability('employee.delete'), archive);
router.post('/:id/restore', requireCapability('employee.delete'), restore);
router.get('/:id/employment-history', employmentHistory);
router.get('/:id/profile', getEmployeeProfile);
router.post('/:id/profile', requireCapability('employee.write'), createEmployeeProfile);
router.patch('/:id/profile', requireCapability('employee.write'), updateEmployeeProfile);
router.patch('/:id/device-settings', requireCapability('employee.write'), updateEmployeeDeviceSettings);
router.post('/:id/queue-adms-sync', requireCapability('employee.write'), queueEmployeeAdmsSync);
router.post('/:id/sync-to-device', requireCapability('employee.write'), syncEmployeeToDeviceById);

export default router;
