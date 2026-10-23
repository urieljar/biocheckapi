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

const router = Router();

router.get('/', getEmployees);
router.post('/', createEmployee);
router.post('/sync-pending-to-device', syncPendingEmployeesToDevice);
router.get('/:id', getEmployee);
router.get('/:id/profile', getEmployeeProfile);
router.post('/:id/profile', createEmployeeProfile);
router.patch('/:id/profile', updateEmployeeProfile);
router.patch('/:id/device-settings', updateEmployeeDeviceSettings);
router.post('/:id/queue-adms-sync', queueEmployeeAdmsSync);
router.post('/:id/sync-to-device', syncEmployeeToDeviceById);

export default router;
