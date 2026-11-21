import sequelize from '../config/database.js';
import { Employee, EmployeeProfile, Device } from '../models/index.js';
import { queueUpdateUserInfoCommand } from './adms-command.service.js';

export const validateProfileClockName = (values) => {
  if (Object.hasOwn(values, 'firstName') && (typeof values.firstName !== 'string' || !values.firstName.trim())) {
    return 'Nombre(s) no puede estar vacío: también se utiliza como nombre en el checador';
  }
  return null;
};

// El expediente y el nombre local cambian en una sola transacción. El envío es posterior.
export const saveProfileWithClockName = async ({ employeeId, profile, values }) => sequelize.transaction(async (transaction) => {
  const employee = await Employee.findByPk(employeeId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!employee) throw new Error('Empleado no encontrado al guardar el expediente');
  const name = values.firstName?.trim();
  const nameChanged = name !== undefined && name !== employee.name;
  const savedProfile = profile
    ? await profile.update(values, { transaction })
    : await EmployeeProfile.create({ employeeId, ...values }, { transaction });
  if (nameChanged) {
    await employee.update({ name, deviceSyncStatus: 'PENDING', deviceSyncError: null, deviceSyncedAt: null }, { transaction });
  }
  return { employee, profile: savedProfile, nameChanged };
});

export const sendProfileClockName = async ({ employee, profile, nameChanged, syncDirect }) => {
  if (!nameChanged) return null;
  if (employee.active === false || profile.employmentStatus === 'TERMINATED') {
    return { transport: null, status: 'SKIPPED', error: 'Nombre guardado. No se envió al reloj porque el empleado está inactivo o dado de baja.' };
  }
  const transport = String(employee.deviceUserId || '').length > 8 ? 'ADMS' : 'TCP';
  try {
    if (transport === 'ADMS') {
      const device = await Device.findByPk(employee.deviceId);
      const command = await queueUpdateUserInfoCommand({ device, employee });
      return { transport, status: command.status, commandId: command.commandId, error: null };
    }
    const result = await syncDirect(employee);
    return { transport, status: result.ok ? 'SYNCED' : 'ERROR', error: result.ok ? null : result.error.message };
  } catch (error) {
    await employee.update({ deviceSyncStatus: 'ERROR', deviceSyncError: error.message, deviceSyncedAt: null });
    return { transport, status: 'ERROR', error: error.message };
  }
};

export const profileClockNameMessage = (base, sync) => {
  if (!sync) return base;
  if (sync.status === 'SYNCED') return `${base}. Nombre sincronizado con el checador`;
  if (sync.status === 'SKIPPED') return `${base}. ${sync.error}`;
  if (sync.status === 'ERROR') return `${base}. El nombre quedó guardado, pero no se pudo sincronizar con el checador`;
  return `${base}. Nombre encolado por ADMS; pendiente de confirmación del checador`;
};
