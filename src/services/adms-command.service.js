import { DeviceCommand } from '../models/index.js';

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

  return DeviceCommand.create({
    deviceId: device?.id ?? null,
    employeeId: employee.id,
    serialNumber,
    command: buildUpdateUserInfoCommand(employee),
    status: 'PENDING'
  });
};
