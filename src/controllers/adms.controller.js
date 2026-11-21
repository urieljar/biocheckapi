import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import { Device, DeviceCommand, DeviceAdmsEvent, Employee } from '../models/index.js';
import { redactCommandPin } from '../middlewares/device-pin.middleware.js';
import { logger } from '../services/logger.service.js';

const ADMS_COMMAND_TIMEOUT_MINUTES = Number(process.env.ADMS_COMMAND_TIMEOUT_MINUTES || 10);
const ADMS_RETRY_DELAY_SECONDS = Number(process.env.ADMS_RETRY_DELAY_SECONDS || 60);
const ADMS_DEFAULT_MAX_ATTEMPTS = Number(process.env.ADMS_MAX_ATTEMPTS || 3);
const ADMS_COMMAND_TIMEOUT_MESSAGE = 'El checador recibió el comando, pero no envió confirmación';

const getSerialNumber = (req) => {
  const value = req.query.SN || req.query.sn || req.body?.SN || req.body?.sn || null;
  return value === null || value === undefined ? null : String(value).trim();
};

const getRequestSource = (req) => ({
  ip: req.ip,
  forwardedFor: req.headers['x-forwarded-for'] || null,
  userAgent: req.headers['user-agent'] || null
});

const findKnownDevice = async (serialNumber) => {
  if (!serialNumber) return null;
  const bySerial = await Device.findOne({ where: { serialNumber, active: true } });
  if (bySerial) return bySerial;
  if (process.env.ZK_SERIAL_NUMBER !== serialNumber || !process.env.ZK_IP) return null;
  return Device.findOne({ where: { ip: process.env.ZK_IP, active: true } });
};

const recordAdmsEvent = async ({ device, serialNumber, eventType, commandId = null, returnCode = null, requestBody = null, req, accepted = true, error = null }) => {
  try {
    await DeviceAdmsEvent.create({
      deviceId: device?.id || null,
      serialNumber: serialNumber || 'UNKNOWN',
      eventType,
      commandId: commandId || null,
      returnCode,
      requestBody: requestBody ? String(requestBody).slice(0, 16000) : null,
      sourceIp: req ? getRequestSource(req).ip : null,
      userAgent: req ? getRequestSource(req).userAgent : null,
      accepted,
      error
    });
  } catch (recordError) {
    logger.warn('adms_event_persist_failed', { error: recordError.message, eventType, serialNumber });
  }
};

const registerDeviceHeartbeat = async (serialNumber, device = null) => {
  const currentDevice = device || await findKnownDevice(serialNumber);
  if (!currentDevice) return null;
  await currentDevice.update({
    serialNumber: currentDevice.serialNumber || serialNumber,
    admsStatus: 'ONLINE',
    lastAdmsAt: new Date(),
    admsLastError: null
  });
  return currentDevice;
};

const parseDeviceCommandResult = (req) => {
  const body = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body || {}).toString();
  const params = new URLSearchParams(body);
  return {
    commandId: params.get('ID') || params.get('id') || req.body?.ID || req.body?.id || req.query.ID || req.query.id || null,
    returnCode: params.get('Return') || params.get('return') || req.body?.Return || req.body?.return || req.query.Return || req.query.return || null,
    rawBody: body
  };
};

const findRecentSentCommand = async (serialNumber) => DeviceCommand.findOne({
  where: {
    serialNumber,
    status: 'SENT',
    sentAt: { [Op.gte]: new Date(Date.now() - 5 * 60 * 1000) }
  },
  order: [['sentAt', 'DESC']]
});

const updateEmployeeSyncState = async (command, status, message) => {
  if (!command.employeeId) return;
  const employee = await Employee.findByPk(command.employeeId);
  if (!employee) return;
  await employee.update({
    deviceSyncStatus: status === 'CONFIRMED' ? 'SYNCED' : status === 'ERROR' ? 'ERROR' : 'PENDING',
    deviceSyncError: status === 'CONFIRMED' ? null : message || null,
    deviceSyncedAt: status === 'CONFIRMED' ? new Date() : null
  });
};

const scheduleRetryOrFail = async (command, { error, returnCode = null, responseBody = null }) => {
  const now = new Date();
  const attemptCount = Number(command.attemptCount || 0);
  const maxAttempts = Math.max(1, Number(command.maxAttempts || ADMS_DEFAULT_MAX_ATTEMPTS));
  const terminal = attemptCount >= maxAttempts;
  const nextAttemptAt = terminal ? null : new Date(now.getTime() + ADMS_RETRY_DELAY_SECONDS * 1000);
  await command.update({
    status: terminal ? 'ERROR' : 'PENDING',
    returnCode,
    responseBody,
    returnedAt: now,
    lastError: error,
    nextAttemptAt
  });
  await updateEmployeeSyncState(command, terminal ? 'ERROR' : 'PENDING', error);
  return { terminal, nextAttemptAt };
};

const expireStaleCommands = async (serialNumber) => {
  const staleBefore = new Date(Date.now() - ADMS_COMMAND_TIMEOUT_MINUTES * 60 * 1000);
  const commands = await DeviceCommand.findAll({
    where: { serialNumber, status: 'SENT', sentAt: { [Op.lt]: staleBefore } }
  });
  for (const command of commands) {
    await scheduleRetryOrFail(command, { error: ADMS_COMMAND_TIMEOUT_MESSAGE });
    logger.warn('adms_command_timeout', { commandId: command.commandId, serialNumber, attemptCount: command.attemptCount });
  }
};

const validateDeviceRequest = async (req, eventType) => {
  const serialNumber = getSerialNumber(req);
  const device = await findKnownDevice(serialNumber);
  if (!serialNumber || !device) {
    await recordAdmsEvent({ device, serialNumber, eventType, req, accepted: false, error: 'Número de serie no registrado' });
    return { serialNumber, device, valid: false };
  }
  await registerDeviceHeartbeat(serialNumber, device);
  return { serialNumber, device, valid: true };
};

export const admsHandshake = async (req, res) => {
  const result = await validateDeviceRequest(req, 'HANDSHAKE');
  console.log('[ADMS] handshake', { serialNumber: result.serialNumber, accepted: result.valid, source: getRequestSource(req) });
  if (!result.valid) return res.type('text/plain').status(403).send('ERROR');
  await recordAdmsEvent({ ...result, eventType: 'HANDSHAKE', req });
  res.type('text/plain').send('OK');
};

export const admsPing = async (req, res) => {
  const result = await validateDeviceRequest(req, 'PING');
  console.log('[ADMS] ping', { serialNumber: result.serialNumber, accepted: result.valid, source: getRequestSource(req) });
  if (!result.valid) return res.type('text/plain').status(403).send('ERROR');
  await recordAdmsEvent({ ...result, eventType: 'PING', req });
  res.type('text/plain').send('OK');
};

export const admsGetRequest = async (req, res) => {
  const result = await validateDeviceRequest(req, 'GETREQUEST');
  const preview = req.query.preview === 'true';
  console.log('[ADMS] getrequest', { serialNumber: result.serialNumber, preview, accepted: result.valid, source: getRequestSource(req) });
  if (!result.valid) return res.type('text/plain').status(403).send('ERROR');

  await expireStaleCommands(result.serialNumber);
  const now = new Date();
  let command;
  const transaction = await sequelize.transaction();
  try {
    command = await DeviceCommand.findOne({
      where: {
        serialNumber: result.serialNumber,
        status: 'PENDING',
        [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: now } }]
      },
      order: [['createdAt', 'ASC']],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (command && !preview) {
      const attemptCount = Number(command.attemptCount || 0) + 1;
      await command.update({ status: 'SENT', sentAt: now, lastAttemptAt: now, attemptCount, nextAttemptAt: null }, { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  await recordAdmsEvent({ ...result, eventType: 'GETREQUEST', commandId: command?.commandId, req });
  if (!command) {
    console.log('[ADMS] no pending command', { serialNumber: result.serialNumber });
    return res.type('text/plain').send('OK');
  }
  console.log('[ADMS] sending command', { commandId: command.commandId, serialNumber: result.serialNumber, preview, attemptCount: command.attemptCount, command: redactCommandPin(command.command) });
  res.type('text/plain').send(`C:${command.commandId}:${command.command}\n`);
};

export const admsDeviceCommandResult = async (req, res) => {
  const result = await validateDeviceRequest(req, 'DEVICECMD');
  const { commandId, returnCode, rawBody } = parseDeviceCommandResult(req);
  const parsedReturnCode = returnCode === null || returnCode === '' ? null : Number(returnCode);
  const hasValidReturnCode = parsedReturnCode !== null && Number.isFinite(parsedReturnCode);
  console.log('[ADMS] devicecmd', { commandId, serialNumber: result.serialNumber, returnCode, accepted: result.valid, rawBody, source: getRequestSource(req) });
  if (!result.valid) return res.type('text/plain').status(403).send('ERROR');

  let command = commandId ? await DeviceCommand.findByPk(commandId) : null;
  let inferredEmptyAck = false;
  // Algunos firmwares MB160 llaman /devicecmd con SN, pero dejan el cuerpo
  // vacío. Esa llamada ocurre inmediatamente después de recibir C:<id>:...;
  // se considera el acuse del último comando SENT del mismo reloj.
  if (!command && !commandId && !rawBody.trim() && returnCode === null) {
    command = await findRecentSentCommand(result.serialNumber);
    inferredEmptyAck = Boolean(command);
  }
  if (!command) {
    await recordAdmsEvent({ ...result, eventType: 'DEVICECMD', commandId, returnCode: hasValidReturnCode ? parsedReturnCode : null, requestBody: rawBody, req, accepted: false, error: 'Comando no encontrado' });
    return res.type('text/plain').send('OK');
  }

  const belongsToDevice = command.serialNumber === result.serialNumber;
  if (!belongsToDevice) {
    const message = `ADMS SN inesperado: ${result.serialNumber}`;
    await scheduleRetryOrFail(command, { error: message, returnCode: hasValidReturnCode ? parsedReturnCode : null, responseBody: rawBody });
    await recordAdmsEvent({ ...result, eventType: 'DEVICECMD', commandId, returnCode: parsedReturnCode, requestBody: rawBody, req, accepted: false, error: message });
    return res.type('text/plain').send('ERROR');
  }

  if (inferredEmptyAck || (hasValidReturnCode && parsedReturnCode === 0)) {
    await command.update({ status: 'CONFIRMED', returnCode: 0, responseBody: inferredEmptyAck ? 'EMPTY_ACK' : rawBody, returnedAt: new Date(), lastError: null, nextAttemptAt: null });
    await updateEmployeeSyncState(command, 'CONFIRMED', null);
    await recordAdmsEvent({ ...result, eventType: 'DEVICECMD', commandId: command.commandId, returnCode: 0, requestBody: rawBody || 'EMPTY_ACK', req });
  } else {
    const message = `ADMS Return=${returnCode || 'sin valor'}`;
    await scheduleRetryOrFail(command, { error: message, returnCode: hasValidReturnCode ? parsedReturnCode : null, responseBody: rawBody });
    await recordAdmsEvent({ ...result, eventType: 'DEVICECMD', commandId, returnCode: hasValidReturnCode ? parsedReturnCode : null, requestBody: rawBody, req, accepted: false, error: message });
  }
  res.type('text/plain').send('OK');
};
