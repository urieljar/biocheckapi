import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import { User, Device, Employee, DeviceCommand, SystemSetting } from '../models/index.js';
import {
  ROLES,
  ROLE_LIST,
  CAPABILITIES,
  CAPABILITY_METADATA,
  getCapabilities,
  setDynamicCapabilities,
  resetDynamicCapabilities,
  normalizeRole
} from '../security/roles.js';
import { PUBLIC_USER_FIELDS, publicUser } from '../services/user-validation.service.js';

const DEFAULT_SETTINGS = {
  allowManualPunches: true,
  requireJustificationReason: true,
  autoSyncDeviceOnEmployeeChange: true,
  allowBatchExport: true,
  strictPunchesAudit: false,
  systemMaintenanceMessage: ''
};

// 1. Obtener la matriz actual de capacidades y roles
export const getPermissions = async (req, res) => {
  try {
    try {
      const stored = await SystemSetting.findByPk('role_capabilities');
      if (stored && stored.value && typeof stored.value === 'object') {
        setDynamicCapabilities(stored.value);
      }
    } catch {
      // Si la BD no tiene la tabla o falla, se devuelven los permisos en memoria
    }

    return res.json({
      ok: true,
      data: {
        capabilities: getCapabilities(),
        defaultCapabilities: CAPABILITIES,
        metadata: CAPABILITY_METADATA,
        roles: ROLE_LIST
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al obtener los permisos del sistema'
    });
  }
};

// 2. Guardar y aplicar nueva matriz de capacidades por rol
export const updatePermissions = async (req, res) => {
  try {
    const { capabilities } = req.body;
    if (!capabilities || typeof capabilities !== 'object') {
      return res.status(400).json({
        ok: false,
        message: 'Debes enviar un objeto con la matriz de capacidades por rol'
      });
    }

    const updated = setDynamicCapabilities(capabilities);

    try {
      await SystemSetting.upsert({
        key: 'role_capabilities',
        value: updated,
        description: 'Matriz dinámica de capacidades asignadas por ROOT',
        updatedBy: req.user.id
      });
    } catch (dbErr) {
      console.warn('No se pudo persistir role_capabilities en PostgreSQL:', dbErr.message);
    }

    return res.json({
      ok: true,
      message: 'Matriz de permisos actualizada correctamente en todo el sistema',
      data: {
        capabilities: updated
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al guardar permisos'
    });
  }
};

// 3. Restaurar permisos originales de fábrica
export const resetPermissions = async (req, res) => {
  try {
    const reset = resetDynamicCapabilities();

    try {
      await SystemSetting.destroy({ where: { key: 'role_capabilities' } });
    } catch {
      // Ignorar error si no existe en BD
    }

    return res.json({
      ok: true,
      message: 'Permisos del sistema restablecidos a los valores por defecto',
      data: {
        capabilities: reset
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al restablecer permisos'
    });
  }
};

// 4. Obtener interruptores de funcionalidad (Feature Toggles)
export const getSettings = async (req, res) => {
  try {
    let settings = { ...DEFAULT_SETTINGS };
    try {
      const record = await SystemSetting.findByPk('system_feature_toggles');
      if (record && record.value && typeof record.value === 'object') {
        settings = { ...DEFAULT_SETTINGS, ...record.value };
      }
    } catch {
      // fallback
    }

    return res.json({
      ok: true,
      data: settings
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al obtener configuraciones'
    });
  }
};

// 5. Guardar interruptores de funcionalidad (Feature Toggles)
export const updateSettings = async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({
        ok: false,
        message: 'Debes enviar el objeto con las configuraciones del sistema'
      });
    }

    const merged = { ...DEFAULT_SETTINGS, ...settings };

    try {
      await SystemSetting.upsert({
        key: 'system_feature_toggles',
        value: merged,
        description: 'Interruptores de funcionalidades globales gestionados por ROOT',
        updatedBy: req.user.id
      });
    } catch (dbErr) {
      console.warn('No se pudo persistir system_feature_toggles en PostgreSQL:', dbErr.message);
    }

    return res.json({
      ok: true,
      message: 'Configuraciones de funciones actualizadas correctamente',
      data: merged
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al actualizar configuraciones'
    });
  }
};

// 6. Diagnóstico y estado integral del sistema
export const getSystemStatus = async (req, res) => {
  try {
    let dbStatus = 'DISCONNECTED';
    let dbError = null;
    let counts = {
      usersByRole: {},
      totalUsers: 0,
      totalEmployees: 0,
      activeEmployees: 0,
      totalDevices: 0,
      pendingCommands: 0,
      totalCommands: 0
    };

    try {
      await sequelize.authenticate();
      dbStatus = 'CONNECTED';

      const users = await User.findAll({ attributes: ['role', 'active'] });
      counts.totalUsers = users.length;
      for (const u of users) {
        const r = normalizeRole(u.role);
        counts.usersByRole[r] = (counts.usersByRole[r] || 0) + 1;
      }

      counts.totalEmployees = await Employee.count();
      counts.activeEmployees = await Employee.count({ where: { active: true } });
      counts.totalDevices = await Device.count();
      counts.pendingCommands = await DeviceCommand.count({
        where: { status: { [Op.in]: ['PENDING', 'SENT', 'ERROR'] } }
      });
      counts.totalCommands = await DeviceCommand.count();
    } catch (err) {
      dbError = err.message;
    }

    const memory = process.memoryUsage();

    return res.json({
      ok: true,
      data: {
        database: {
          status: dbStatus,
          error: dbError
        },
        counts,
        process: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          memoryMb: {
            rss: Math.round(memory.rss / 1024 / 1024),
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024)
          }
        }
      }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al obtener diagnóstico del sistema'
    });
  }
};

// 7. Purgar comandos de reloj atascados o con error
export const purgeDeviceCommands = async (req, res) => {
  try {
    const deletedCount = await DeviceCommand.destroy({
      where: {
        status: { [Op.in]: ['PENDING', 'SENT', 'ERROR'] }
      }
    });

    return res.json({
      ok: true,
      message: `Se purgaron ${deletedCount} comando(s) de reloj atascados o con error`,
      data: { purgedCount: deletedCount }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al purgar cola de comandos'
    });
  }
};

// 8. Forzar encolamiento de orden de comprobación en todos los relojes
export const forceDeviceSync = async (req, res) => {
  try {
    const devices = await Device.findAll();
    const createdCommands = [];

    for (const d of devices) {
      const cmd = await DeviceCommand.create({
        deviceId: d.id,
        serialNumber: d.serialNumber,
        command: 'CHECK',
        status: 'PENDING'
      });
      createdCommands.push(cmd);
    }

    return res.json({
      ok: true,
      message: `Órdenes de comprobación (CHECK) encoladas para ${devices.length} reloj(es)`,
      data: { enqueued: createdCommands.length }
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al sincronizar dispositivos'
    });
  }
};

// 9. Reasignación directa de rol a cualquier usuario (con protección de último ROOT)
export const changeUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const normalizedNewRole = normalizeRole(role);
    if (!ROLE_LIST.includes(normalizedNewRole)) {
      return res.status(400).json({
        ok: false,
        message: `Rol inválido. Debe ser uno de: ${ROLE_LIST.join(', ')}`
      });
    }

    const target = await User.findByPk(id);
    if (!target) {
      return res.status(404).json({
        ok: false,
        message: 'Usuario no encontrado'
      });
    }

    // Proteger al último ROOT
    if (target.active && normalizeRole(target.role) === ROLES.ROOT && normalizedNewRole !== ROLES.ROOT) {
      const activeRoots = await User.count({
        where: { active: true, role: ROLES.ROOT }
      });
      if (activeRoots <= 1) {
        return res.status(409).json({
          ok: false,
          message: 'No puedes quitar el rol al último ROOT activo del sistema'
        });
      }
    }

    await target.update({ role: normalizedNewRole });

    return res.json({
      ok: true,
      message: `Rol asignado correctamente a ${target.name}: ${normalizedNewRole}`,
      data: publicUser(target)
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al cambiar rol del usuario'
    });
  }
};

// 10. Listar todos los usuarios para la vista de asignación de roles de ROOT
export const getAllUsersForRoot = async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: PUBLIC_USER_FIELDS,
      order: [['role', 'ASC'], ['name', 'ASC']]
    });

    return res.json({
      ok: true,
      data: users.map(publicUser)
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: err.message || 'Error al obtener usuarios'
    });
  }
};
