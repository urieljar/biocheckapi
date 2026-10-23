import { Op } from 'sequelize';
import { Device, DeviceCommand, Employee } from '../models/index.js';

const ADMS_COMMAND_TIMEOUT_MINUTES = 10;
const ADMS_COMMAND_TIMEOUT_MESSAGE =
  'El checador recibió el comando, pero no envió confirmación';

const getSerialNumber = (req) => {
  return (
    req.query.SN ||
    req.query.sn ||
    req.body?.SN ||
    req.body?.sn ||
    null
  );
};

const getRequestSource = (req) => {
  return {
    ip: req.ip,
    forwardedFor: req.headers['x-forwarded-for'] || null,
    userAgent: req.headers['user-agent'] || null
  };
};

const registerDeviceHeartbeat = async (serialNumber) => {
  if (!serialNumber) return null;

  let device = await Device.findOne({
    where: {
      serialNumber
    }
  });

  if (!device && process.env.ZK_IP) {
    device = await Device.findOne({
      where: {
        ip: process.env.ZK_IP
      }
    });
  }

  if (!device) return null;

  await device.update({
    serialNumber: device.serialNumber || serialNumber,
    active: true,
    lastConnectionAt: new Date()
  });

  return device;
};

const parseDeviceCommandResult = (req) => {
  const body =
    typeof req.body === 'string'
      ? req.body
      : new URLSearchParams(req.body || {}).toString();

  const params = new URLSearchParams(body);

  return {
    commandId:
      params.get('ID') ||
      params.get('id') ||
      req.body?.ID ||
      req.body?.id ||
      null,
    returnCode:
      params.get('Return') ||
      params.get('return') ||
      req.body?.Return ||
      req.body?.return ||
      null,
    rawBody: body
  };
};

const expireStaleCommands = async (serialNumber) => {
  const staleBefore = new Date(
    Date.now() - ADMS_COMMAND_TIMEOUT_MINUTES * 60 * 1000
  );

  const commands = await DeviceCommand.findAll({
    where: {
      serialNumber,
      status: 'SENT',
      sentAt: {
        [Op.lt]: staleBefore
      }
    }
  });

  for (const command of commands) {
    await command.update({
      status: 'ERROR',
      responseBody: ADMS_COMMAND_TIMEOUT_MESSAGE,
      returnedAt: new Date()
    });

    if (command.employeeId) {
      const employee = await Employee.findByPk(command.employeeId);

      if (employee) {
        await employee.update({
          deviceSyncStatus: 'ERROR',
          deviceSyncError: ADMS_COMMAND_TIMEOUT_MESSAGE,
          deviceSyncedAt: null
        });
      }
    }
  }
};

export const admsHandshake = async (req, res) => {
  const serialNumber = getSerialNumber(req);

  console.log('[ADMS] handshake', {
    serialNumber,
    source: getRequestSource(req)
  });

  await registerDeviceHeartbeat(serialNumber);

  res.type('text/plain').send('OK');
};

export const admsGetRequest = async (req, res) => {
  const serialNumber = getSerialNumber(req);
  const preview = req.query.preview === 'true';

  console.log('[ADMS] getrequest', {
    serialNumber,
    preview,
    source: getRequestSource(req)
  });

  if (!serialNumber) {
    return res.type('text/plain').send('OK');
  }

  await expireStaleCommands(serialNumber);
  await registerDeviceHeartbeat(serialNumber);

  const command = await DeviceCommand.findOne({
    where: {
      serialNumber,
      status: 'PENDING'
    },
    order: [['createdAt', 'ASC']]
  });

  if (!command) {
    console.log('[ADMS] no pending command', {
      serialNumber
    });

    return res.type('text/plain').send('OK');
  }

  if (!preview) {
    await command.update({
      status: 'SENT',
      sentAt: new Date()
    });
  }

  console.log('[ADMS] sending command', {
    commandId: command.commandId,
    serialNumber,
    preview,
    command: command.command
  });

  res
    .type('text/plain')
    .send(`C:${command.commandId}:${command.command}\n`);
};

export const admsDeviceCommandResult = async (req, res) => {
  const serialNumber = getSerialNumber(req);
  const { commandId, returnCode, rawBody } =
    parseDeviceCommandResult(req);

  console.log('[ADMS] devicecmd', {
    commandId,
    serialNumber,
    returnCode,
    rawBody,
    source: getRequestSource(req)
  });

  if (commandId) {
    const command = await DeviceCommand.findByPk(commandId);

    if (command) {
      const parsedReturnCode =
        returnCode === null || returnCode === ''
          ? null
          : Number(returnCode);
      const hasValidReturnCode =
        parsedReturnCode !== null && Number.isFinite(parsedReturnCode);
      const belongsToDevice =
        !serialNumber || serialNumber === command.serialNumber;
      const success =
        hasValidReturnCode && parsedReturnCode === 0 && belongsToDevice;

      if (serialNumber && !belongsToDevice) {
        console.warn('[ADMS] resultado rechazado: SN no coincide', {
          commandId,
          expectedSerialNumber: command.serialNumber,
          receivedSerialNumber: serialNumber
        });
      }

      await command.update({
        status: success ? 'SUCCESS' : 'ERROR',
        returnCode: hasValidReturnCode ? parsedReturnCode : null,
        responseBody: rawBody,
        returnedAt: new Date()
      });

      if (command.employeeId) {
        const employee = await Employee.findByPk(command.employeeId);

        if (employee) {
          await employee.update({
            deviceSyncStatus: success ? 'SYNCED' : 'ERROR',
            deviceSyncError: success
              ? null
              : serialNumber && !belongsToDevice
                ? `ADMS SN inesperado: ${serialNumber}`
                : `ADMS Return=${returnCode || 'sin valor'}`,
            deviceSyncedAt: success ? new Date() : null
          });
        }
      }
    }
  }

  res.type('text/plain').send('OK');
};
