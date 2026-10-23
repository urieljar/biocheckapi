import ZKLib from 'node-zklib';

import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const { COMMANDS } = require('node-zklib/constants.js');

const USER_RECORD_SIZE = 72;

const writeText = (buffer, value, offset, length) => {
  if (!value) return;

  const text = Buffer.from(String(value), 'ascii');
  text.copy(buffer, offset, 0, Math.min(text.length, length - 1));
};

const buildUserRecord = (employee) => {
  const buffer = Buffer.alloc(USER_RECORD_SIZE);
  const deviceUserId = String(employee.deviceUserId ?? '').trim();

  if (!deviceUserId) {
    throw new Error('deviceUserId es obligatorio para escribir en el checador');
  }

  if (deviceUserId.length > 8) {
    throw new Error(
      `deviceUserId ${deviceUserId} tiene ${deviceUserId.length} caracteres. La escritura directa admite máximo 8; usa ADMS para este empleado.`
    );
  }

  const uid = Number(employee.deviceUid) || Number(employee.deviceUserId);
  const role = Number(employee.deviceRole) || 0;
  const cardNumber = Number(employee.cardNumber) || 0;

  if (!Number.isInteger(uid) || uid <= 0 || uid > 65535) {
    throw new Error(
      `deviceUid inválido para ${employee.deviceUserId}. Usa un número entre 1 y 65535`
    );
  }

  buffer.writeUInt16LE(uid, 0);
  buffer.writeUInt8(role, 2);

  writeText(buffer, employee.devicePin, 3, 8);

  buffer.writeUInt8(0x7c, 10);

  writeText(buffer, employee.name, 11, 24);

  buffer.writeUInt32LE(cardNumber, 35);
  buffer.writeUInt8(1, 39);

  writeText(buffer, deviceUserId, 48, 9);

  return buffer;
};

const getCommandName = (command) => {
  const entry = Object.entries(COMMANDS).find(
    ([, value]) => value === command
  );

  return entry?.[0] || 'UNKNOWN';
};

export const createZktecoClient = () => {
  return new ZKLib(
    process.env.ZK_IP,
    Number(process.env.ZK_PORT) || 4370,
    10000,
    4000,
    Number(process.env.ZK_COMM_KEY) || 0,
    'tcp'
  );
};

export const writeEmployeeToDevice = async (employee) => {
  const device = createZktecoClient();

  try {
    await device.createSocket();

    if (typeof device.disableDevice === 'function') {
      await device.disableDevice();
    }

    const userRecord = buildUserRecord(employee);

    const reply = await device.executeCmd(
      COMMANDS.CMD_USER_WRQ,
      userRecord
    );

    const command = reply.readUInt16LE(0);

    if (command !== COMMANDS.CMD_ACK_OK) {
      const commandName = getCommandName(command);
      const replyHex = reply.toString('hex');

      throw new Error(
        `El checador respondió código ${command} (${commandName}). Respuesta HEX: ${replyHex}`
      );
    }

    await device.executeCmd(COMMANDS.CMD_REFRESHDATA, '');

    if (typeof device.enableDevice === 'function') {
      await device.enableDevice();
    }

    return {
      ok: true,
      deviceUserId: employee.deviceUserId,
      deviceRole: employee.deviceRole
    };
  } finally {
    try {
      if (typeof device.enableDevice === 'function') {
        await device.enableDevice();
      }
    } catch {
      // Ignoramos error al reactivar.
    }

    try {
      await device.disconnect();
    } catch {
      // La conexión ya estaba cerrada.
    }
  }
};
