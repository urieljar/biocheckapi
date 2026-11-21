import { Op } from 'sequelize';
import { Device, Employee, EmployeeProfile } from '../models/index.js';
import sequelize from '../config/database.js';
import { getZktecoUsers } from './zkteco.service.js';

const registerDevice = async () => {
  const [device] = await Device.findOrCreate({
    where: {
      ip: process.env.ZK_IP
    },
    defaults: {
      name: process.env.ZK_NAME || 'ZKTeco',
      ip: process.env.ZK_IP,
      port: Number(process.env.ZK_PORT),
      deviceNumber: Number(process.env.ZK_DEVICE_NUMBER) || null,
      serialNumber: process.env.ZK_SERIAL_NUMBER || null,
      active: true,
      lastConnectionAt: new Date()
    }
  });

  await device.update({
    name: process.env.ZK_NAME || device.name,
    port: Number(process.env.ZK_PORT),
    deviceNumber:
      Number(process.env.ZK_DEVICE_NUMBER) || device.deviceNumber,
    active: true,
    lastConnectionAt: new Date()
  });

  return device;
};

export const reconcileClockEmployee = async (device, user) => sequelize.transaction(async (transaction) => {
    const deviceUserId = String(user.userId);

    const employee = await Employee.findOne({
      paranoid: false,
      transaction,
      lock: transaction.LOCK.UPDATE,
      where: {
        deviceId: device.id,
        deviceUserId
      }
    });

    if (employee?.deletedAt) return 'skippedDeleted';
    // El reloj puede devolver datos anteriores a un alta/cambio local pendiente.
    // No sobrescribirlos ni convertir el registro en SYNCED al importar.
    if (employee && ['PENDING', 'ERROR'].includes(employee.deviceSyncStatus)) return 'skippedUnsynced';
    const profile = employee ? await EmployeeProfile.findOne({ where: { employeeId: employee.id }, transaction }) : null;

    const employeeData = {
      deviceId: device.id,
      deviceUserId,
      deviceUid: Number(user.uid) || null,
      name: user.name || `Empleado ${deviceUserId}`,
      // role: Number(user.role) || 0,
      deviceRole: Number(user.role) || 0,
      devicePin: user.password ? String(user.password) : null,
      cardNumber: user.cardno ? String(user.cardno) : null,
      deviceSyncStatus: 'SYNCED',
      deviceSyncError: null,
      deviceSyncedAt: new Date(),
      active: profile?.employmentStatus !== 'TERMINATED'
    };

    if (employee) {
      await employee.update(employeeData, { transaction });
      return 'updated';
    } else {
      await Employee.create(employeeData, { transaction });
      return 'created';
    }

});

export const createEmployeeSynchronizer = ({ readUsers = getZktecoUsers } = {}) => async () => {
  const users = await readUsers();

  if (users.length === 0) {
    throw new Error(
      'El reloj no devolvió usuarios. Se detiene la reconciliación para evitar desactivar empleados por error.'
    );
  }
   console.log(
    '[SYNC USERS]',
    users.map((user) => ({
      userId: user.userId,
      uid: user.uid,
      name: user.name
    }))
  );

  const device = await registerDevice();

  let created = 0;
  let updated = 0;
  let skippedDeleted = 0;
  let skippedUnsynced = 0;

  for (const user of users) {
    const outcome = await reconcileClockEmployee(device, user);
    if (outcome === 'created') created++;
    else if (outcome === 'updated') updated++;
    else if (outcome === 'skippedDeleted') skippedDeleted++;
    else if (outcome === 'skippedUnsynced') skippedUnsynced++;
  }

  const deviceUserIds = users.map((user) => String(user.userId));
  const preservedLocal = await Employee.count({
    where: { deviceId: device.id, deviceSyncStatus: { [Op.in]: ['PENDING', 'ERROR'] } }
  });
  const [deactivated] = await Employee.update(
    {
      active: false
    },
    {
      where: {
        deviceId: device.id,
        deviceUserId: {
          [Op.notIn]: deviceUserIds
        },
        active: true,
        // Se evalúa en el UPDATE: protege también cambios locales concurrentes.
        deviceSyncStatus: 'SYNCED'
      }
    }
  );

  return {
    device: {
      id: device.id,
      name: device.name,
      ip: device.ip
    },
    received: users.length,
    created,
    updated,
    skippedDeleted,
    skippedUnsynced,
    preservedLocal,
    deactivated
  };
};

export const synchronizeEmployees = createEmployeeSynchronizer();
