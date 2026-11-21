import express from 'express';
import helmet from 'helmet';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Employee, EmployeeProfile, Department, Position, Area, Attendance, Device, DeviceCommand, EmploymentPeriod, WorkSchedule, ScheduleDay, EmployeeSchedule } from '../models/index.js';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import { calculateEmployeeAttendance, calculateBatchAttendance } from '../services/attendance-calculation.service.js';
import { changeEmployment } from '../services/employee-lifecycle.service.js';
import { recordAudit } from '../services/audit.service.js';
import { logger } from '../services/logger.service.js';
import { queueUpdateUserInfoCommand, queueDeleteUserCommand } from '../services/adms-command.service.js';
import { writeEmployeeToDevice, deleteEmployeeFromDevice } from '../services/device-user-write.service.js';
import { getZktecoAttendances, getZktecoUsers, testZktecoConnection } from '../services/zkteco.service.js';
import { failSyncJob, finishSyncJob, getSyncJobsStatus, startSyncJob } from '../services/sync-status.service.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (message) => Object.assign(new Error(message), { statusCode: 400 });
const integer = (value, fallback, max) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw invalid('Paginación inválida');
  return Number(value);
};
const date = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('Envía from y to con formato YYYY-MM-DD');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid('Fecha inválida');
  return parsed;
};

const CLOCK_ROLES = new Set([0, 2, 8, 12, 14]);
export const validateExternalClockUser = (body = {}) => {
  const text = (value, field, max) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw invalid(`${field} es obligatorio y admite máximo ${max} caracteres`);
    if (/\r|\n|\t/.test(value)) throw invalid(`${field} contiene caracteres no permitidos`);
    return value.trim();
  };
  const deviceUserId = text(body.deviceUserId, 'deviceUserId', 50);
  const name = text(body.name, 'name', 160);
  const deviceUid = Number(body.deviceUid);
  const deviceRole = body.deviceRole === undefined ? 0 : Number(body.deviceRole);
  if (!Number.isInteger(deviceUid) || deviceUid < 1 || deviceUid > 65535) throw invalid('deviceUid debe ser un entero entre 1 y 65535');
  if (!Number.isInteger(deviceRole) || !CLOCK_ROLES.has(deviceRole)) throw invalid('deviceRole debe ser uno de: 0, 2, 8, 12 o 14');
  const devicePin = body.devicePin === null || body.devicePin === undefined || body.devicePin === '' ? null : String(body.devicePin).trim();
  if (devicePin && !/^\d{1,20}$/.test(devicePin)) throw invalid('devicePin debe contener solo números y máximo 20 dígitos');
  const cardNumber = body.cardNumber === null || body.cardNumber === undefined || body.cardNumber === '' ? null : String(body.cardNumber).trim();
  if (cardNumber && !/^\d{1,50}$/.test(cardNumber)) throw invalid('cardNumber debe contener solo dígitos y máximo 50 caracteres');
  return { deviceUserId, deviceUid, name, deviceRole, devicePin, cardNumber };
};

// Contrato de lectura del reloj: el PIN solo se incluye cuando la ruta v3
// privilegiada lo solicita explícitamente.
export const externalClockUser = (user, { includePin = false } = {}) => ({
  deviceUserId: String(user.userId),
  deviceUid: Number(user.uid),
  name: user.name || '',
  deviceRole: Number(user.role || 0),
  ...(includePin ? { devicePin: user.password || null } : {}),
  cardNumber: user.cardno ? String(user.cardno) : null
});

export const externalDevice = (device) => ({
  deviceId: device.id,
  name: device.name,
  ip: device.ip,
  port: device.port,
  serialNumber: device.serialNumber || null,
  active: device.active === true,
  admsStatus: device.admsStatus || 'UNKNOWN',
  lastConnectionAt: device.lastConnectionAt || null,
  lastAdmsAt: device.lastAdmsAt || null
});

export const verifyExternalClockUser = (users, deviceUserId, expected = 'EXISTS') => {
  const user = users.find((item) => String(item.userId) === String(deviceUserId)) || null;
  const existsInClock = Boolean(user);
  return {
    expected,
    existsInClock,
    verified: expected === 'ABSENT' ? !existsInClock : existsInClock,
    user
  };
};

// Contrato externo por lista de campos: no serializar modelos ni incidencias completas.
export const externalCalculation = (data) => ({
  employee: { id: data.employee.id, employeeNumber: data.employee.deviceUserId, name: data.employee.name },
  from: data.from, to: data.to, timeZone: data.timeZone,
  summary: {
    totalDays: data.summary.totalDays, present: data.summary.present, absent: data.summary.absent,
    excused: data.summary.excused, rest: data.summary.rest, late: data.summary.late,
    earlyDeparture: data.summary.earlyDeparture, incomplete: data.summary.incomplete,
    workedMinutes: data.summary.workedMinutes, workedHoursFormatted: data.summary.workedHoursFormatted
  },
  days: data.days.map(externalCalculationDay)
});

const externalCalculationException = (exception) => {
  if (!exception) return null;
  const item = typeof exception.toJSON === 'function' ? exception.toJSON() : exception;
  return {
    id: item.id || null, name: item.name || null, date: item.date || null,
    type: item.type || null, scope: item.scope || null, description: item.description || null,
    employeeId: item.employeeId || null, departmentId: item.departmentId || null,
    areaId: item.areaId || null, scheduleId: item.scheduleId || null,
    isWorkDay: item.isWorkDay === true, entryTime: item.entryTime || null,
    exitTime: item.exitTime || null, workMinutes: item.workMinutes || null,
    active: item.active !== false
  };
};

const externalCalculationDay = (day) => ({
  date: day.date, status: day.status, statuses: day.statuses || [day.status],
  reason: day.reason || null, rule: day.rule || null,
  exception: externalCalculationException(day.exception),
  firstEntry: day.firstEntry || null, lastExit: day.lastExit || null,
  punches: day.punches || [],
  punchDetails: (day.punchDetails || []).map((punch) => ({
    id: punch.id, time: punch.time, recordTime: punch.recordTime, source: punch.source || 'DEVICE'
  })),
  workedMinutes: day.workedMinutes || 0
});

const externalBatchCalculation = (data) => ({
  from: data.from, to: data.to, timeZone: data.timeZone, scope: data.scope,
  department: data.department ? { id: data.department.id, code: data.department.code || null, name: data.department.name } : null,
  totalEmployees: data.totalEmployees,
  companySummary: data.companySummary,
  employees: (data.employees || []).map((item) => ({
    employee: { id: item.employee.id, employeeNumber: item.employee.deviceUserId, name: item.employee.name, department: item.employee.department || null, area: item.employee.area || null, position: item.employee.position || null },
    summary: item.summary,
    days: (item.days || []).map(externalCalculationDay)
  }))
});

// Contrato de expediente externo. Solo incluye datos laborales y de contacto
// autorizados; nunca serializa el modelo completo ni secretos del reloj.
export const externalEmployee = (employee) => {
  const item = typeof employee.toJSON === 'function' ? employee.toJSON() : employee;
  const profile = item.profile || {};
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || item.name;
  const department = profile.department ? { id: profile.department.id, code: profile.department.code || null, name: profile.department.name } : null;
  const position = profile.position ? { id: profile.position.id, code: profile.position.code || null, name: profile.position.name } : null;
  const area = profile.area ? { id: profile.area.id, code: profile.area.code || null, name: profile.area.name } : null;
  return {
    id: item.id,
    employeeNumber: profile.employeeNumber || item.deviceUserId,
    clockNumber: item.deviceUserId,
    name: fullName,
    firstName: profile.firstName || null,
    lastName: profile.lastName || null,
    organization: { department, area, position },
    // Se conservan estos campos de primer nivel para no romper consumidores existentes.
    department,
    position,
    area,
    personal: {
      socialSecurityNumber: profile.socialSecurityNumber || null,
      passportNumber: profile.passportNumber || null,
      driverLicenseVehicle: profile.driverLicenseVehicle || null,
      driverLicenseMotorcycle: profile.driverLicenseMotorcycle || null,
      nationalId: profile.nationalId || null,
      religion: profile.religion || null,
      address: profile.address || null,
      city: profile.city || null,
      postalCode: profile.postalCode || null,
      birthDate: profile.birthDate || null
    },
    labor: {
      employeeNumber: profile.employeeNumber || item.deviceUserId,
      employmentType: profile.employmentType || null,
      status: profile.employmentStatus || (item.active ? 'ACTIVE' : 'INACTIVE'),
      hireDate: profile.hireDate || null,
      terminationDate: profile.terminationDate || null,
      terminationReason: profile.terminationReason || null
    },
    employment: {
      type: profile.employmentType || null,
      status: profile.employmentStatus || (item.active ? 'ACTIVE' : 'INACTIVE'),
      hireDate: profile.hireDate || null,
      terminationDate: profile.terminationDate || null,
      terminationReason: profile.terminationReason || null
    },
    contact: {
      phone: profile.phone || null,
      officePhone: profile.officePhone || null,
      mobilePhone: profile.mobilePhone || null,
      email: profile.email || null,
      city: profile.city || null
    },
    birthDate: profile.birthDate || null,
    device: { syncStatus: item.deviceSyncStatus || null, syncedAt: item.deviceSyncedAt || null }
  };
};

export const externalAttendance = (attendance) => {
  const item = typeof attendance.toJSON === 'function' ? attendance.toJSON() : attendance;
  return {
    id: String(item.id),
    employee: item.employee ? externalEmployee(item.employee) : null,
    deviceUserId: item.deviceUserId,
    recordTime: item.recordTime,
    device: item.device ? { id: item.device.id, name: item.device.name, ip: item.device.ip } : { id: item.deviceId, ip: item.deviceIp }
  };
};

const employeeProfileInclude = {
  model: EmployeeProfile, as: 'profile', required: false,
  attributes: [
    'firstName', 'lastName', 'employeeNumber', 'departmentId', 'positionId', 'areaId',
    'employmentType', 'hireDate', 'employmentStatus', 'terminationDate', 'terminationReason',
    'socialSecurityNumber', 'passportNumber', 'driverLicenseVehicle', 'driverLicenseMotorcycle',
    'phone', 'officePhone', 'mobilePhone', 'nationalId', 'religion', 'city', 'address', 'postalCode',
    'email', 'birthDate'
  ],
  include: [
    { model: Department, as: 'department', attributes: ['id', 'code', 'name'], required: false },
    { model: Position, as: 'position', attributes: ['id', 'code', 'name'], required: false },
    { model: Area, as: 'area', attributes: ['id', 'code', 'name'], required: false }
  ]
};

export const createIntegrationApp = ({ keyHash = process.env.INTEGRATION_API_KEY_SHA256, writeKeyHash = process.env.INTEGRATION_WRITE_API_KEY_SHA256 || keyHash, v3KeyHash = process.env.INTEGRATION_V3_API_KEY_SHA256 || writeKeyHash } = {}) => {
  if (!/^[a-f0-9]{64}$/i.test(keyHash || '')) throw new Error('Configura INTEGRATION_API_KEY_SHA256 (SHA-256 hexadecimal)');
  if (!/^[a-f0-9]{64}$/i.test(writeKeyHash || '')) throw new Error('Configura INTEGRATION_WRITE_API_KEY_SHA256 (SHA-256 hexadecimal)');
  if (!/^[a-f0-9]{64}$/i.test(v3KeyHash || '')) throw new Error('Configura INTEGRATION_V3_API_KEY_SHA256 (SHA-256 hexadecimal)');
  const expected = Buffer.from(keyHash, 'hex');
  const writeExpected = Buffer.from(writeKeyHash, 'hex');
  const v3Expected = Buffer.from(v3KeyHash, 'hex');
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.headers.authorization || '';
    const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const digest = createHash('sha256').update(key).digest();
    const isV3 = req.path.startsWith('/api/integrations/v3');
    const isV2Write = req.path.startsWith('/api/integrations/v2') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const expectedKey = isV3 ? v3Expected : isV2Write ? writeExpected : expected;
    if (!key || !timingSafeEqual(digest, expectedKey)) return res.status(401).json({ ok: false, message: 'Credencial de integración inválida' });
    next();
  });
  // Un consumidor por proceso en este piloto. Límite global, sin confiar en X-Forwarded-For.
  let windowStart = Date.now();
  let requests = 0;
  app.use((req, res, next) => {
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 60) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((60000 - (Date.now() - windowStart)) / 1000))));
      return res.status(429).json({ ok: false, message: 'Máximo 60 consultas por minuto' });
    }
    res.on('finish', () => logger.info('integration_request', { integration: 'pilot', method: req.method, path: req.path, status: res.statusCode, ip: req.ip }));
    next();
  });
  const base = '/api/integrations/v1';
  app.get(`${base}/employees`, async (req, res) => {
    const page = integer(req.query.page, 1, 1000000);
    const limit = integer(req.query.limit, 20, 100);
    const { rows, count } = await Employee.findAndCountAll({
      attributes: ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncedAt'],
      include: [employeeProfileInclude], order: [['name', 'ASC'], ['id', 'ASC']],
      limit, offset: (page - 1) * limit
    });
    res.json({ ok: true, data: rows.map(externalEmployee),
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  });
  app.get(`${base}/employees/:employeeId`, async (req, res) => {
    if (!uuid.test(req.params.employeeId)) throw invalid('employeeId debe ser un UUID válido');
    const employee = await Employee.findByPk(req.params.employeeId, {
      attributes: ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncedAt'],
      include: [employeeProfileInclude]
    });
    if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { statusCode: 404 });
    res.json({ ok: true, data: externalEmployee(employee) });
  });
  app.get(`${base}/attendance-events`, async (req, res) => {
    const limit = integer(req.query.limit, 50, 100);
    const sinceId = req.query.sinceId === undefined ? 0 : Number(req.query.sinceId);
    if (!Number.isSafeInteger(sinceId) || sinceId < 0) throw invalid('sinceId debe ser un entero mayor o igual a 0');
    const where = sinceId ? { id: { [Op.gt]: sinceId } } : {};
    if (req.query.employeeNumber) where.deviceUserId = String(req.query.employeeNumber).trim().slice(0, 120);
    const rows = await Attendance.findAll({
      where, limit, order: [['id', 'ASC']],
      attributes: ['id', 'deviceId', 'employeeId', 'deviceUserId', 'recordTime', 'deviceIp', 'source'],
      include: [
        { model: Employee, as: 'employee', attributes: ['id', 'deviceId', 'deviceUid', 'deviceUserId', 'name', 'deviceRole', 'active', 'deviceSyncStatus', 'deviceSyncedAt'], required: false,
          include: [employeeProfileInclude] },
        { model: Device, as: 'device', attributes: ['id', 'name', 'ip'], required: false }
      ]
    });
    const data = rows.map(externalAttendance);
    const lastId = data.length ? data[data.length - 1].id : String(sinceId);
    res.json({ ok: true, data, cursor: { sinceId: lastId, hasMore: data.length === limit }, timeZone: 'America/Mazatlan' });
  });
  app.get(`${base}/attendance-calculations/employees/:employeeId`, async (req, res) => {
    if (!uuid.test(req.params.employeeId)) throw invalid('employeeId debe ser un UUID válido');
    const from = req.query.from || req.query.date;
    const to = req.query.to || req.query.date || from;
    const days = (date(to) - date(from)) / 86400000 + 1;
    if (days < 1 || days > 31) throw invalid('El rango permitido es de 1 a 31 días');
    const data = await calculateEmployeeAttendance({ employeeId: req.params.employeeId, from, to });
    res.json({ ok: true, data: externalCalculation(data) });
  });
  const calculationRange = (req) => {
    const from = req.query.from || req.query.date;
    const to = req.query.to || req.query.date || from;
    const days = (date(to) - date(from)) / 86400000 + 1;
    if (days < 1 || days > 31) throw invalid('El rango permitido es de 1 a 31 días');
    return { from, to };
  };
  app.get(`${base}/attendance-calculations/company`, async (req, res) => {
    const { from, to } = calculationRange(req);
    const data = await calculateBatchAttendance({ from, to });
    res.json({ ok: true, data: externalBatchCalculation(data) });
  });
  app.get(`${base}/attendance-calculations/departments/:departmentId`, async (req, res) => {
    if (!uuid.test(req.params.departmentId)) throw invalid('departmentId debe ser un UUID válido');
    const { from, to } = calculationRange(req);
    const data = await calculateBatchAttendance({ from, to, departmentId: req.params.departmentId });
    res.json({ ok: true, data: externalBatchCalculation(data) });
  });

  // v2 de escritura: separado de v1 y protegido por la misma credencial del
  // proceso. Todas las mutaciones quedan auditadas y devuelven el expediente
  // externo, nunca secretos del reloj.
  const writeBase = '/api/integrations/v2';
  app.get(`${writeBase}/employees/:employeeId/sync-status`, async (req, res) => {
    if (!uuid.test(req.params.employeeId)) throw invalid('employeeId debe ser un UUID válido');
    const employee = await Employee.findByPk(req.params.employeeId, {
      attributes: ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncError', 'deviceSyncedAt'],
      include: [{ model: Device, as: 'device', attributes: ['id', 'name', 'ip', 'port', 'lastConnectionAt'], required: false }]
    });
    if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { statusCode: 404 });
    res.json({ ok: true, data: {
      employeeId: employee.id,
      employeeNumber: employee.deviceUserId,
      name: employee.name,
      active: employee.active,
      status: employee.deviceSyncStatus,
      error: employee.deviceSyncError || null,
      syncedAt: employee.deviceSyncedAt || null,
      device: employee.device ? {
        id: employee.device.id,
        name: employee.device.name,
        ip: employee.device.ip,
        port: employee.device.port,
        lastConnectionAt: employee.device.lastConnectionAt
      } : null
    } });
  });
  const catalogEndpoint = (path, Model, label) => app.get(`${writeBase}/${path}`, async (_req, res) => {
    const rows = await Model.findAll({ where: { active: true }, attributes: ['id', 'code', 'name', 'active', 'parentId'], order: [['name', 'ASC'], ['id', 'ASC']], limit: 500 });
    res.json({ ok: true, data: rows, catalog: label });
  });
  catalogEndpoint('departments', Department, 'departamentos');
  catalogEndpoint('positions', Position, 'cargos');
  catalogEndpoint('areas', Area, 'áreas');
  const catalogWrite = (path, Model, label) => {
    app.post(`${writeBase}/${path}`, async (req, res) => {
      const body = req.body || {};
      const code = requireText(body.code, 'code', 50);
      const name = requireText(body.name, 'name', 160);
      const parentId = body.parentId || null;
      if (parentId && !uuid.test(String(parentId))) throw invalid('parentId debe ser un UUID válido');
      if (parentId && !(await Model.findOne({ where: { id: parentId, active: true } }))) throw invalid(`${label} superior no encontrado o inactivo`);
      try {
        const row = await Model.create({ code, name, parentId, active: body.active !== false });
        await writeAudit(req, `POST /${path}`, row.id, null, row.toJSON());
        return res.status(201).json({ ok: true, message: `${label} creado correctamente`, data: row });
      } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') throw Object.assign(new Error(`Ya existe un ${label} con ese código o nombre`), { statusCode: 409 });
        throw error;
      }
    });
    app.patch(`${writeBase}/${path}/:id`, async (req, res) => {
      if (!uuid.test(req.params.id)) throw invalid('id debe ser un UUID válido');
      const row = await Model.findByPk(req.params.id);
      if (!row) throw Object.assign(new Error(`${label} no encontrado`), { statusCode: 404 });
      const before = row.toJSON();
      const updates = {};
      for (const key of ['code', 'name', 'active']) if (req.body?.[key] !== undefined) updates[key] = req.body[key];
      if (req.body?.parentId !== undefined) {
        if (req.body.parentId && (!uuid.test(String(req.body.parentId)) || req.body.parentId === req.params.id)) throw invalid('parentId inválido');
        if (req.body.parentId && !(await Model.findOne({ where: { id: req.body.parentId, active: true } }))) throw invalid(`${label} superior no encontrado o inactivo`);
        updates.parentId = req.body.parentId || null;
      }
      if (updates.code !== undefined) updates.code = requireText(updates.code, 'code', 50);
      if (updates.name !== undefined) updates.name = requireText(updates.name, 'name', 160);
      if (!Object.keys(updates).length) throw invalid('Envía code, name, parentId o active');
      try {
        await row.update(updates);
      } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') throw Object.assign(new Error(`Ya existe un ${label} con ese código o nombre`), { statusCode: 409 });
        throw error;
      }
      await writeAudit(req, `PATCH /${path}/:id`, row.id, before, row.toJSON());
      return res.json({ ok: true, message: `${label} actualizado correctamente`, data: row });
    });
    app.delete(`${writeBase}/${path}/:id`, async (req, res) => {
      if (!uuid.test(req.params.id)) throw invalid('id debe ser un UUID válido');
      const row = await Model.findByPk(req.params.id);
      if (!row) throw Object.assign(new Error(`${label} no encontrado`), { statusCode: 404 });
      const before = row.toJSON();
      await row.update({ active: false });
      await writeAudit(req, `DELETE /${path}/:id`, row.id, before, row.toJSON(), { softDelete: true });
      return res.json({ ok: true, message: `${label} desactivado correctamente`, data: row });
    });
  };
  catalogWrite('departments', Department, 'departamento');
  catalogWrite('positions', Position, 'cargo');
  catalogWrite('areas', Area, 'área');

  const schedulePayload = (body, current = {}) => {
    const value = { name: body.name ?? current.name, description: body.description ?? current.description ?? null, type: String(body.type ?? current.type ?? 'NORMAL').toUpperCase(), workMinutes: body.workMinutes ?? current.workMinutes ?? null, timeZone: body.timeZone ?? current.timeZone ?? 'America/Mazatlan', toleranceMinutes: body.toleranceMinutes ?? current.toleranceMinutes ?? 10, active: body.active ?? current.active ?? true };
    if (!value.name || !['NORMAL', 'FLEXIBLE', 'MIXED'].includes(value.type)) throw invalid('name y type NORMAL, FLEXIBLE o MIXED son obligatorios');
    if (!Number.isInteger(Number(value.toleranceMinutes)) || value.toleranceMinutes < 0 || value.toleranceMinutes > 180) throw invalid('toleranceMinutes debe estar entre 0 y 180');
    if (value.type === 'FLEXIBLE' && (!Number.isInteger(Number(value.workMinutes)) || value.workMinutes < 1 || value.workMinutes > 1440)) throw invalid('workMinutes es obligatorio para FLEXIBLE');
    return value;
  };
  const scheduleTime = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
  const validateScheduleDays = (days, type, workMinutes) => {
    if (!Array.isArray(days) || days.length !== 7) throw invalid('days debe contener exactamente los 7 días');
    const seen = new Set();
    for (const day of days) {
      const dayOfWeek = Number(day.dayOfWeek);
      if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6 || seen.has(dayOfWeek)) throw invalid('days debe contener dayOfWeek únicos del 0 al 6');
      seen.add(dayOfWeek);
      const isWorkDay = day.isWorkDay !== false;
      const dayType = String(day.dayType || (isWorkDay ? type === 'MIXED' ? 'NORMAL' : type : 'REST')).toUpperCase();
      if (!['NORMAL', 'FLEXIBLE', 'REST'].includes(dayType)) throw invalid(`dayType inválido para el día ${dayOfWeek}`);
      if (!isWorkDay && dayType !== 'REST') throw invalid(`El día ${dayOfWeek} debe ser REST`);
      if (isWorkDay && dayType === 'REST') throw invalid(`El día ${dayOfWeek} debe ser laboral`);
      if (type !== 'MIXED' && isWorkDay && dayType !== type) throw invalid(`El día ${dayOfWeek} debe usar dayType ${type}`);
      if (isWorkDay && (!scheduleTime.test(String(day.entryTime || '')) || !scheduleTime.test(String(day.exitTime || '')))) throw invalid(`El día ${dayOfWeek} necesita entryTime y exitTime válidos`);
      const minutes = day.workMinutes ?? workMinutes;
      if (isWorkDay && dayType === 'FLEXIBLE' && (!Number.isInteger(Number(minutes)) || Number(minutes) < 1 || Number(minutes) > 1440)) throw invalid(`El día ${dayOfWeek} necesita workMinutes entre 1 y 1440`);
    }
  };
  const validFutureDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('La fecha debe usar YYYY-MM-DD');
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid('Fecha inválida');
  };
  const scheduleResult = (schedule) => schedule?.toJSON ? schedule.toJSON() : schedule;
  const scheduleInclude = [{ model: ScheduleDay, as: 'days' }];
  app.get(`${writeBase}/schedules`, async (_req, res) => res.json({ ok: true, data: await WorkSchedule.findAll({ where: { active: true }, include: scheduleInclude, order: [['name', 'ASC']] }) }));
  app.get(`${writeBase}/schedules/:id`, async (req, res) => {
    if (!uuid.test(req.params.id)) throw invalid('id debe ser un UUID válido');
    const schedule = await WorkSchedule.findByPk(req.params.id, { include: scheduleInclude });
    if (!schedule) throw Object.assign(new Error('Horario no encontrado'), { statusCode: 404 });
    return res.json({ ok: true, data: schedule });
  });
  app.post(`${writeBase}/schedules`, async (req, res) => {
    const value = schedulePayload(req.body || {});
    const days = req.body?.days;
    validateScheduleDays(days, value.type, value.workMinutes);
    const result = await sequelize.transaction(async (transaction) => {
      const schedule = await WorkSchedule.create(value, { transaction });
      await ScheduleDay.bulkCreate(days.map((day) => ({ scheduleId: schedule.id, dayOfWeek: Number(day.dayOfWeek), isWorkDay: day.isWorkDay !== false, dayType: String(day.dayType || (day.isWorkDay === false ? 'REST' : value.type)).toUpperCase(), workMinutes: day.workMinutes ?? null, entryTime: day.isWorkDay === false ? null : day.entryTime, exitTime: day.isWorkDay === false ? null : day.exitTime, crossesMidnight: day.crossesMidnight === true })), { transaction });
      return WorkSchedule.findByPk(schedule.id, { include: scheduleInclude, transaction });
    });
    await writeAudit(req, 'POST /schedules', result.id, null, scheduleResult(result));
    return res.status(201).json({ ok: true, message: 'Horario creado correctamente', data: result });
  });
  app.patch(`${writeBase}/schedules/:id`, async (req, res) => {
    if (!uuid.test(req.params.id)) throw invalid('id debe ser un UUID válido');
    const schedule = await WorkSchedule.findByPk(req.params.id);
    if (!schedule) throw Object.assign(new Error('Horario no encontrado'), { statusCode: 404 });
    const before = scheduleResult(await WorkSchedule.findByPk(schedule.id, { include: scheduleInclude }));
    const value = schedulePayload(req.body || {}, schedule);
    if (req.body?.days !== undefined) validateScheduleDays(req.body.days, value.type, value.workMinutes);
    const result = await sequelize.transaction(async (transaction) => {
      await schedule.update(value, { transaction });
      if (Array.isArray(req.body?.days)) {
        await ScheduleDay.destroy({ where: { scheduleId: schedule.id }, transaction });
        await ScheduleDay.bulkCreate(req.body.days.map((day) => ({ scheduleId: schedule.id, dayOfWeek: Number(day.dayOfWeek), isWorkDay: day.isWorkDay !== false, dayType: String(day.dayType || (day.isWorkDay === false ? 'REST' : value.type)).toUpperCase(), workMinutes: day.workMinutes ?? null, entryTime: day.isWorkDay === false ? null : day.entryTime, exitTime: day.isWorkDay === false ? null : day.exitTime, crossesMidnight: day.crossesMidnight === true })), { transaction });
      }
      return WorkSchedule.findByPk(schedule.id, { include: scheduleInclude, transaction });
    });
    await writeAudit(req, 'PATCH /schedules/:id', schedule.id, before, scheduleResult(result));
    return res.json({ ok: true, message: 'Horario actualizado correctamente', data: result });
  });
  app.delete(`${writeBase}/schedules/:id`, async (req, res) => {
    if (!uuid.test(req.params.id)) throw invalid('id debe ser un UUID válido');
    const schedule = await WorkSchedule.findByPk(req.params.id);
    if (!schedule) throw Object.assign(new Error('Horario no encontrado'), { statusCode: 404 });
    const assignments = await EmployeeSchedule.count({ where: { scheduleId: schedule.id, active: true } });
    if (assignments) throw Object.assign(new Error('No se puede desactivar un horario con empleados asignados'), { statusCode: 409 });
    const before = schedule.toJSON(); await schedule.update({ active: false });
    await writeAudit(req, 'DELETE /schedules/:id', schedule.id, before, schedule.toJSON(), { softDelete: true });
    return res.json({ ok: true, message: 'Horario desactivado correctamente', data: schedule });
  });
  app.post(`${writeBase}/schedules/:scheduleId/assign`, async (req, res) => {
    if (!uuid.test(req.params.scheduleId)) throw invalid('scheduleId debe ser un UUID válido');
    const employeeIds = [...new Set((Array.isArray(req.body?.employeeIds) ? req.body.employeeIds : [req.body?.employeeId]).filter(Boolean))];
    if (!employeeIds.length) throw invalid('Envía al menos un employeeId');
    validFutureDate(req.body?.validFrom);
    const schedule = await WorkSchedule.findOne({ where: { id: req.params.scheduleId, active: true } });
    if (!schedule) throw Object.assign(new Error('Horario activo no encontrado'), { statusCode: 404 });
    const created = await sequelize.transaction(async (transaction) => {
      const rows = [];
      for (const employeeId of employeeIds) {
        const employee = await Employee.findByPk(employeeId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { statusCode: 404 });
        const profile = await EmployeeProfile.findOne({ where: { employeeId }, transaction });
        if (profile?.employmentStatus === 'TERMINATED') throw Object.assign(new Error(`El empleado "${employee.name}" está dado de baja`), { statusCode: 409 });
        const current = await EmployeeSchedule.findOne({ where: { employeeId, active: true }, transaction });
        if (current && current.scheduleId !== schedule.id) throw Object.assign(new Error(`El empleado "${employee.name}" ya tiene otro horario`), { statusCode: 409 });
        if (!current) rows.push(await EmployeeSchedule.create({ employeeId, scheduleId: schedule.id, validFrom: req.body.validFrom, active: true }, { transaction }));
      }
      return rows;
    });
    await writeAudit(req, 'POST /schedules/:scheduleId/assign', req.params.scheduleId, null, { employeeIds, validFrom: req.body.validFrom });
    return res.status(201).json({ ok: true, message: `Horario asignado a ${created.length} empleado(s)`, data: created });
  });
  app.get(`${writeBase}/employees/:employeeId/schedules`, async (req, res) => {
    if (!uuid.test(req.params.employeeId)) throw invalid('employeeId debe ser un UUID válido');
    const rows = await EmployeeSchedule.findAll({ where: { employeeId: req.params.employeeId }, include: [{ model: WorkSchedule, as: 'schedule', include: scheduleInclude }], order: [['validFrom', 'DESC']] });
    return res.json({ ok: true, data: rows });
  });
  const profileFields = ['firstName', 'lastName', 'employeeNumber', 'departmentId', 'positionId', 'areaId', 'employmentType', 'hireDate', 'phone', 'officePhone', 'mobilePhone', 'nationalId', 'city', 'postalCode', 'email', 'birthDate'];
  const pickProfile = (body) => Object.fromEntries(profileFields.filter((key) => body[key] !== undefined).map((key) => [key, body[key] === '' ? null : body[key]]));
  const resolveCatalog = async (Model, value, label, transaction) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const candidate = typeof value === 'object' ? (value.id || value.code || value.name) : value;
    const where = uuid.test(String(candidate)) ? { id: candidate, active: true } : { [Op.or]: [{ code: String(candidate) }, { name: String(candidate) }], active: true };
    const row = await Model.findOne({ where, transaction });
    if (!row) throw invalid(`${label} no encontrado o inactivo`);
    return row.id;
  };
  const profileInput = async (body, transaction) => {
    const profile = pickProfile(body);
    if (body.department !== undefined) profile.departmentId = await resolveCatalog(Department, body.department, 'Departamento', transaction);
    if (body.position !== undefined || body.cargo !== undefined) profile.positionId = await resolveCatalog(Position, body.position ?? body.cargo, 'Cargo', transaction);
    if (body.area !== undefined) profile.areaId = await resolveCatalog(Area, body.area, 'Área', transaction);
    return profile;
  };
  const requireText = (value, field, max = 120) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`${field} es obligatorio y admite máximo ${max} caracteres`);
    return value.trim();
  };
  const findExternal = async (id, options = {}) => Employee.findByPk(id, {
    ...options,
    attributes: ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncedAt'],
    include: [employeeProfileInclude]
  });
  const writeAudit = (req, action, resourceId, beforeData, afterData, metadata = {}) => recordAudit({
    actorId: null, action, category: 'INTEGRATION_WRITE', resourceType: 'Employee', resourceId,
    method: req.method, path: req.originalUrl || req.path, statusCode: 200, success: true,
    ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
    userAgent: req.get('user-agent'), beforeData, afterData, metadata: { consumer: 'integration-v2', ...metadata }
  });

  app.post(`${writeBase}/employees`, async (req, res) => {
    const body = req.body || {};
    const deviceUserId = requireText(body.deviceUserId || body.employeeNumber, 'deviceUserId', 50);
    const name = requireText(body.name || [body.firstName, body.lastName].filter(Boolean).join(' '), 'name', 160);
    const device = body.deviceId ? await Device.findByPk(body.deviceId) : await Device.findOne({ where: { ip: process.env.ZK_IP, active: true } });
    if (!device) throw invalid('Envía deviceId o configura un dispositivo activo con ZK_IP');
    const profileData = await profileInput(body);
    if (!profileData.employeeNumber) profileData.employeeNumber = deviceUserId;
    if (body.employmentType !== undefined) profileData.employmentType = body.employmentType;
    return sequelize.transaction(async (transaction) => {
      const existing = await Employee.findOne({ where: { deviceId: device.id, deviceUserId }, paranoid: false, transaction });
      if (existing) throw Object.assign(new Error('Ya existe un empleado con ese deviceUserId para el dispositivo'), { statusCode: 409 });
      const employee = await Employee.create({ deviceId: device.id, deviceUserId, deviceUid: body.deviceUid ?? null, name, deviceRole: body.deviceRole ?? 0, devicePin: body.devicePin ?? null, cardNumber: body.cardNumber ?? null, active: body.active !== false, deviceSyncStatus: 'PENDING', deviceSyncError: null, deviceSyncedAt: null }, { transaction });
      await EmployeeProfile.create({ employeeId: employee.id, employmentStatus: 'ACTIVE', hireDate: body.hireDate || null, ...profileData }, { transaction });
      const result = await findExternal(employee.id, { transaction });
      await writeAudit(req, 'POST /employees', employee.id, null, result.toJSON());
      return res.status(201).json({ ok: true, message: 'Empleado creado y pendiente de sincronizar al reloj', data: externalEmployee(result) });
    });
  });

  app.patch(`${writeBase}/employees/:employeeId`, async (req, res) => {
    if (!uuid.test(req.params.employeeId)) throw invalid('employeeId debe ser un UUID válido');
    const body = req.body || {};
    return sequelize.transaction(async (transaction) => {
      const employee = await Employee.findByPk(req.params.employeeId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { statusCode: 404 });
      const profile = await EmployeeProfile.findOne({ where: { employeeId: employee.id }, transaction, lock: transaction.LOCK.UPDATE });
      const before = await findExternal(employee.id, { transaction });
      const employeeUpdates = {};
      for (const key of ['name', 'deviceUid', 'deviceRole', 'devicePin', 'cardNumber']) if (body[key] !== undefined) employeeUpdates[key] = body[key];
      if (Object.keys(employeeUpdates).length) Object.assign(employeeUpdates, { deviceSyncStatus: 'PENDING', deviceSyncError: null, deviceSyncedAt: null });
      if (Object.keys(employeeUpdates).length) await employee.update(employeeUpdates, { transaction });
      const profileUpdates = await profileInput(body, transaction);
      if (profile) {
        if (Object.keys(profileUpdates).length) await profile.update(profileUpdates, { transaction });
      } else if (Object.keys(profileUpdates).length) await EmployeeProfile.create({ employeeId: employee.id, employmentStatus: employee.active ? 'ACTIVE' : 'TERMINATED', ...profileUpdates }, { transaction });
      if (!Object.keys(employeeUpdates).length && !Object.keys(profileUpdates).length) throw invalid('Envía al menos un campo modificable');
      const result = await findExternal(employee.id, { transaction });
      await writeAudit(req, 'PATCH /employees/:employeeId', employee.id, before?.toJSON(), result.toJSON());
      return res.json({ ok: true, message: 'Empleado actualizado y pendiente de sincronizar al reloj', data: externalEmployee(result) });
    });
  });

  const employmentAction = (action, label) => async (req, res) => {
    if (!uuid.test(req.params.employeeId)) throw invalid('employeeId debe ser un UUID válido');
    const before = await findExternal(req.params.employeeId);
    if (!before) throw Object.assign(new Error('Empleado no encontrado'), { statusCode: 404 });
    const result = await changeEmployment({ employeeId: req.params.employeeId, action, body: req.body || {}, actorId: null });
    const after = await findExternal(req.params.employeeId);
    await writeAudit(req, `POST /employees/:employeeId/${action}`, req.params.employeeId, before.toJSON(), after?.toJSON(), { reason: req.body?.reason || null });
    return res.json({ ok: true, message: label, data: externalEmployee(after) });
  };
  app.post(`${writeBase}/employees/:employeeId/terminate`, employmentAction('terminate', 'Empleado dado de baja correctamente'));
  app.post(`${writeBase}/employees/:employeeId/reactivate`, employmentAction('rehire', 'Empleado reactivado correctamente'));

  // v3: puente de reloj para sistemas externos. No crea Employee ni Profile;
  // únicamente escribe el usuario solicitado en el dispositivo configurado.
  const clockBase = '/api/integrations/v3';
  app.get(`${clockBase}/devices`, async (_req, res) => {
    const devices = await Device.findAll({ where: { active: true }, order: [['name', 'ASC'], ['id', 'ASC']] });
    return res.json({ ok: true, data: devices.map(externalDevice), total: devices.length });
  });

  app.get(`${clockBase}/devices/:deviceId/status`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    return res.json({ ok: true, data: { ...externalDevice(device), tcp: { lastConnectionAt: device.lastConnectionAt || null }, adms: { status: device.admsStatus || 'UNKNOWN', lastConnectionAt: device.lastAdmsAt || null, lastError: device.admsLastError || null } } });
  });

  app.post(`${clockBase}/devices/:deviceId/test-connection`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    try {
      const result = await testZktecoConnection(device);
      const checkedAt = new Date();
      await device.update({ lastConnectionAt: checkedAt });
      return res.json({ ok: true, data: { deviceId: device.id, connected: true, transport: 'TCP', ip: result.ip, port: result.port, deviceTime: result.deviceTime, checkedAt } });
    } catch (error) {
      logger.warn('integration_v3_device_test_failed', { deviceId: device.id, error: error.message });
      throw Object.assign(new Error('No fue posible conectar con el reloj por TCP'), { statusCode: 502 });
    }
  });

  app.post(`${clockBase}/devices/:deviceId/attendances/sync`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    if (getSyncJobsStatus().attendances?.running) throw Object.assign(new Error('Ya hay una sincronización de checadas en curso'), { statusCode: 409 });
    startSyncJob('attendances');
    try {
      // v3 es un puente directo: lee el reloj y entrega los datos al consumidor.
      // No consulta ni escribe Employee/Attendance en PostgreSQL.
      const clockRecords = await getZktecoAttendances(device);
      const events = clockRecords.map((record) => ({
        deviceId: device.id,
        deviceUserId: String(record.deviceUserId ?? record.userId ?? ''),
        deviceUserSn: Number.isFinite(Number(record.userSn)) ? Number(record.userSn) : null,
        recordTime: record.recordTime ?? record.timestamp ?? null,
        deviceIp: record.ip || device.ip,
        source: 'CLOCK'
      }));
      const result = { received: events.length, events };
      finishSyncJob('attendances', result);
      return res.json({ ok: true, message: 'Checadas descargadas directamente del reloj', data: { deviceId: device.id, ...result, source: 'CLOCK', storedInBioCheck: false } });
    } catch (error) {
      failSyncJob('attendances', error);
      logger.error('integration_v3_attendance_sync_failed', { deviceId: device.id, error: error.message });
      throw Object.assign(new Error('No fue posible descargar las checadas del reloj'), { statusCode: 502 });
    }
  });

  app.post(`${clockBase}/devices/:deviceId/clock-users`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    const clockUser = validateExternalClockUser(req.body);

    // La lectura previa evita sobrescribir un usuario existente en el reloj.
    const currentUsers = await getZktecoUsers(device);
    if (currentUsers.some((user) => String(user.userId) === clockUser.deviceUserId)) {
      throw Object.assign(new Error('Ya existe un usuario con ese deviceUserId en el reloj'), { statusCode: 409 });
    }
    if (currentUsers.some((user) => Number(user.uid) === clockUser.deviceUid)) {
      throw Object.assign(new Error('Ya existe un usuario con ese deviceUid en el reloj'), { statusCode: 409 });
    }

    if (clockUser.deviceUserId.length > 8) {
      const command = await queueUpdateUserInfoCommand({ device, employee: clockUser });
      await recordAudit({
        actorId: null, action: 'POST /v3/clock-users', category: 'INTEGRATION_V3_CLOCK', resourceType: 'DeviceCommand', resourceId: String(command.commandId),
        method: req.method, path: req.originalUrl || req.path, statusCode: 202, success: true,
        ipAddress: req.ip, userAgent: req.get('user-agent'), afterData: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, transport: 'ADMS', status: command.status },
        metadata: { consumer: 'integration-v3', localEmployeeCreated: false }
      });
      return res.status(202).json({ ok: true, message: 'Usuario encolado para el reloj por ADMS', data: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, name: clockUser.name, deviceRole: clockUser.deviceRole, transport: 'ADMS', operationId: String(command.commandId), status: command.status, storedInBioCheckEmployees: false } });
    }

    await writeEmployeeToDevice(clockUser, { device });
    const verifiedUsers = await getZktecoUsers(device);
    const verified = verifiedUsers.some((user) => String(user.userId) === clockUser.deviceUserId && Number(user.uid) === clockUser.deviceUid);
    if (!verified) throw Object.assign(new Error('El reloj no confirmó al usuario después de crearlo'), { statusCode: 502 });
    await recordAudit({
      actorId: null, action: 'POST /v3/clock-users', category: 'INTEGRATION_V3_CLOCK', resourceType: 'ClockUser', resourceId: `${device.id}:${clockUser.deviceUserId}`,
      method: req.method, path: req.originalUrl || req.path, statusCode: 201, success: true,
      ipAddress: req.ip, userAgent: req.get('user-agent'), afterData: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, transport: 'TCP', status: 'VERIFIED' },
      metadata: { consumer: 'integration-v3', localEmployeeCreated: false }
    });
    return res.status(201).json({ ok: true, message: 'Usuario creado y verificado en el reloj', data: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, name: clockUser.name, deviceRole: clockUser.deviceRole, transport: 'TCP', status: 'VERIFIED', storedInBioCheckEmployees: false } });
  });

  const findClockUser = async (device, deviceUserId) => {
    const users = await getZktecoUsers(device);
    const user = users.find((item) => String(item.userId) === String(deviceUserId));
    if (!user) throw Object.assign(new Error('Usuario no encontrado en el reloj'), { statusCode: 404 });
    return user;
  };
  const updatePayload = (current, body = {}) => {
    if (body.deviceUserId !== undefined || body.deviceUid !== undefined) throw invalid('deviceUserId y deviceUid no se modifican en esta ruta');
    if (!['name', 'deviceRole', 'devicePin', 'cardNumber'].some((field) => body[field] !== undefined)) throw invalid('Envía name, deviceRole, devicePin o cardNumber');
    const hasPassword = Object.prototype.hasOwnProperty.call(current, 'password');
    const hasCard = Object.prototype.hasOwnProperty.call(current, 'cardno');
    if (body.devicePin === undefined && !hasPassword) throw invalid('El reloj no devolvió PIN; envía devicePin para evitar sobrescribirlo');
    if (body.cardNumber === undefined && !hasCard) throw invalid('El reloj no devolvió tarjeta; envía cardNumber para evitar sobrescribirla');
    return validateExternalClockUser({
      deviceUserId: String(current.userId), deviceUid: Number(current.uid),
      name: body.name === undefined ? current.name : body.name,
      deviceRole: body.deviceRole === undefined ? Number(current.role || 0) : body.deviceRole,
      devicePin: body.devicePin === undefined ? (current.password || null) : body.devicePin,
      cardNumber: body.cardNumber === undefined ? (current.cardno ? String(current.cardno) : null) : body.cardNumber
    });
  };

  app.get(`${clockBase}/devices/:deviceId/clock-users`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    const users = await getZktecoUsers(device);
    return res.json({ ok: true, data: users.map((user) => externalClockUser(user, { includePin: true })), total: users.length, source: 'CLOCK', storedInBioCheckEmployees: false });
  });

  app.get(`${clockBase}/devices/:deviceId/clock-users/:deviceUserId`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    const user = await findClockUser(device, req.params.deviceUserId);
    return res.json({ ok: true, data: externalClockUser(user, { includePin: true }), source: 'CLOCK', storedInBioCheckEmployees: false });
  });

  app.post(`${clockBase}/devices/:deviceId/clock-users/verify`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const deviceUserId = typeof req.body?.deviceUserId === 'string' ? req.body.deviceUserId.trim() : '';
    if (!deviceUserId || deviceUserId.length > 50 || /\r|\n|\t/.test(deviceUserId)) throw invalid('deviceUserId es obligatorio y debe ser válido');
    const expected = String(req.body?.expected || 'EXISTS').toUpperCase();
    if (!['EXISTS', 'ABSENT'].includes(expected)) throw invalid('expected debe ser EXISTS o ABSENT');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    const users = await getZktecoUsers(device);
    const result = verifyExternalClockUser(users, deviceUserId, expected);
    return res.json({
      ok: true,
      data: {
        deviceId: device.id,
        deviceUserId,
        expected: result.expected,
        existsInClock: result.existsInClock,
        verified: result.verified,
        user: result.user ? externalClockUser(result.user, { includePin: true }) : null,
        checkedAt: new Date().toISOString()
      },
      source: 'CLOCK',
      storedInBioCheckEmployees: false
    });
  });

  app.patch(`${clockBase}/devices/:deviceId/clock-users/:deviceUserId`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    const current = await findClockUser(device, req.params.deviceUserId);
    const clockUser = updatePayload(current, req.body);
    if (clockUser.deviceUserId.length > 8) {
      const command = await queueUpdateUserInfoCommand({ device, employee: clockUser });
      return res.status(202).json({ ok: true, message: 'Actualización encolada por ADMS', data: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, transport: 'ADMS', operationId: String(command.commandId), status: command.status, storedInBioCheckEmployees: false } });
    }
    await writeEmployeeToDevice(clockUser, { device });
    const verified = await findClockUser(device, clockUser.deviceUserId);
    if (Number(verified.uid) !== clockUser.deviceUid || String(verified.name) !== clockUser.name) throw Object.assign(new Error('El reloj no confirmó los cambios solicitados'), { statusCode: 502 });
    return res.json({ ok: true, message: 'Usuario actualizado y verificado en el reloj', data: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, transport: 'TCP', status: 'VERIFIED', storedInBioCheckEmployees: false } });
  });

  app.delete(`${clockBase}/devices/:deviceId/clock-users/:deviceUserId`, async (req, res) => {
    if (!uuid.test(req.params.deviceId)) throw invalid('deviceId debe ser un UUID válido');
    if (String(req.body?.confirmationDeviceUserId || '') !== String(req.params.deviceUserId)) throw invalid('Envía confirmationDeviceUserId igual al ID que deseas retirar');
    const device = await Device.findOne({ where: { id: req.params.deviceId, active: true } });
    if (!device) throw Object.assign(new Error('Dispositivo activo no encontrado'), { statusCode: 404 });
    const current = await findClockUser(device, req.params.deviceUserId);
    const clockUser = { deviceUserId: String(current.userId), deviceUid: Number(current.uid) };
    if (clockUser.deviceUserId.length > 8) {
      const command = await queueDeleteUserCommand({ device, employee: clockUser });
      return res.status(202).json({ ok: true, message: 'Retiro encolado por ADMS. El reloj eliminará también sus biométricos.', data: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, transport: 'ADMS', operationId: String(command.commandId), status: command.status, storedInBioCheckEmployees: false } });
    }
    await deleteEmployeeFromDevice(clockUser, { device });
    const usersAfter = await getZktecoUsers(device);
    if (usersAfter.some((item) => String(item.userId) === clockUser.deviceUserId)) throw Object.assign(new Error('El reloj no confirmó el retiro del usuario'), { statusCode: 502 });
    return res.json({ ok: true, message: 'Usuario retirado y verificado en el reloj. Sus biométricos fueron eliminados del dispositivo.', data: { deviceId: device.id, deviceUserId: clockUser.deviceUserId, deviceUid: clockUser.deviceUid, transport: 'TCP', status: 'VERIFIED', storedInBioCheckEmployees: false } });
  });

  app.get(`${clockBase}/device-operations/:operationId`, async (req, res) => {
    if (!/^\d+$/.test(req.params.operationId)) throw invalid('operationId debe ser numérico');
    const operation = await DeviceCommand.findByPk(req.params.operationId);
    if (!operation || operation.employeeId) throw Object.assign(new Error('Operación externa no encontrada'), { statusCode: 404 });
    res.json({ ok: true, data: { operationId: String(operation.commandId), deviceId: operation.deviceId, status: operation.status, transport: 'ADMS', attempts: operation.attemptCount, maxAttempts: operation.maxAttempts, error: operation.lastError || null, createdAt: operation.createdAt, sentAt: operation.sentAt, confirmedAt: operation.returnedAt } });
  });

  app.use((_req, res) => res.status(404).json({ ok: false, message: 'Operación no disponible en la integración' }));
  app.use((error, req, res, _next) => {
    const status = [400, 404, 409, 502].includes(error.statusCode) ? error.statusCode : 500;
    logger.error('integration_request_failed', { method: req.method, path: req.originalUrl, status, error: error.message });
    res.status(status).json({ ok: false, message: status === 500 ? 'No fue posible consultar la integración' : error.message });
  });
  return app;
};
