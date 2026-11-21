import { DeviceCommand } from '../models/index.js';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';

const cleanCommandValue = (value) => {
  if (value === undefined || value === null) return '';

  return String(value)
    .replaceAll('\t', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .trim();
};

const toAdmsPrivilege = (deviceRole) => {
  const role = Number(deviceRole) || 0;

  return role === 14 ? 14 : 0;
};

export const buildUpdateUserInfoCommand = (employee) => {
  const fields = [
    `PIN=${cleanCommandValue(employee.deviceUserId)}`,
    `Name=${cleanCommandValue(employee.name)}`,
    `Pri=${toAdmsPrivilege(employee.deviceRole)}`,
    `Passwd=${cleanCommandValue(employee.devicePin)}`,
    `Card=${cleanCommandValue(employee.cardNumber)}`
  ];

  return `DATA UPDATE USERINFO ${fields.join('\t')}`;
};

export const buildDeleteUserInfoCommand = (employee) =>
  `DATA DELETE USERINFO PIN=${cleanCommandValue(employee.deviceUserId)}`;

export const queueUpdateUserInfoCommand = async ({
  device,
  employee,
  serialNumber: serialNumberOverride
}) => {
  const serialNumber =
    serialNumberOverride ||
    device?.serialNumber ||
    process.env.ZK_SERIAL_NUMBER;

  if (!serialNumber) {
    throw new Error(
      'El dispositivo no tiene serialNumber. Configura ZK_SERIAL_NUMBER o espera a que el checador se conecte por ADMS'
    );
  }

  const command = buildUpdateUserInfoCommand(employee);
  // Las operaciones de integración v3 escriben directamente en el reloj y
  // deliberadamente no crean un Employee local. En ese flujo employee.id no
  // existe y DeviceCommand debe conservar employeeId como NULL.
  const employeeId = employee?.id ?? null;
  const commandOwner = employeeId || `external:${cleanCommandValue(employee?.deviceUserId)}`;
  return sequelize.transaction(async (transaction) => {
    // Serializa las solicitudes simultáneas del mismo empleado/comando sin
    // borrar comandos históricos ni depender de una restricción destructiva.
    await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:key))', {
      replacements: { key: `adms:${serialNumber}:${commandOwner}:${command}` },
      transaction
    });
    const existing = await DeviceCommand.findOne({
      where: {
        serialNumber,
        employeeId,
        command,
        status: { [Op.in]: ['PENDING', 'SENT'] }
      },
      order: [['createdAt', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (existing) return existing;
    return DeviceCommand.create({
      deviceId: device?.id ?? null,
      employeeId,
      serialNumber,
      command,
      status: 'PENDING',
      attemptCount: 0,
      maxAttempts: Math.max(1, Number(process.env.ADMS_MAX_ATTEMPTS || 3)),
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastError: null
    }, { transaction });
  });
};

export const queueDeleteUserCommand = async ({ device, employee, serialNumber: serialNumberOverride }) => {
  const serialNumber = serialNumberOverride || device?.serialNumber || process.env.ZK_SERIAL_NUMBER;
  if (!serialNumber) throw new Error('El dispositivo no tiene serialNumber para retirar al empleado por ADMS');
  const command = buildDeleteUserInfoCommand(employee);
  const employeeId = employee?.id ?? null;
  return DeviceCommand.create({
    deviceId: device?.id ?? null,
    employeeId,
    serialNumber,
    command,
    status: 'PENDING',
    attemptCount: 0,
    maxAttempts: Math.max(1, Number(process.env.ADMS_MAX_ATTEMPTS || 3)),
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastError: null
  });
};
