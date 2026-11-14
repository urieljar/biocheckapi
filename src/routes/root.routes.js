import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.middleware.js';
import {
  getPermissions,
  updatePermissions,
  resetPermissions,
  getSettings,
  updateSettings,
  getSystemStatus,
  purgeDeviceCommands,
  forceDeviceSync,
  changeUserRole,
  getAllUsersForRoot
} from '../controllers/root.controller.js';

const router = Router();

// Doble candado: capacidad 'system.rootControl' y validación explícita de rol ROOT
const ensureRootOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'ROOT') {
    return res.status(403).json({
      ok: false,
      message: 'Acceso restringido exclusivamente al propietario (ROOT)'
    });
  }
  next();
};

router.use(requireCapability('system.rootControl'));
router.use(ensureRootOnly);

// Matriz de permisos
router.get('/permissions', getPermissions);
router.put('/permissions', updatePermissions);
router.post('/permissions/reset', resetPermissions);

// Configuraciones y funcionalidades del sistema
router.get('/settings', getSettings);
router.put('/settings', updateSettings);

// Diagnóstico y acciones maestras
router.get('/system-status', getSystemStatus);
router.post('/actions/purge-commands', purgeDeviceCommands);
router.post('/actions/sync-devices', forceDeviceSync);

// Usuarios y asignación de roles
router.get('/users', getAllUsersForRoot);
router.patch('/users/:id/role', changeUserRole);

export default router;
