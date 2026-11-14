import express from 'express';
import helmet from 'helmet';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Employee, EmployeeProfile, Department, Position, Area, Attendance, Device } from '../models/index.js';
import { Op } from 'sequelize';
import { calculateEmployeeAttendance } from '../services/attendance-calculation.service.js';

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

// Contrato externo por lista de campos: no serializar modelos ni incidencias completas.
export const externalCalculation = (data) => ({
  employee: { id: data.employee.id, employeeNumber: data.employee.deviceUserId, name: data.employee.name },
  from: data.from, to: data.to, timeZone: data.timeZone,
  summary: {
    totalDays: data.summary.totalDays, present: data.summary.present, absent: data.summary.absent,
    excused: data.summary.excused, rest: data.summary.rest, late: data.summary.late,
    earlyDeparture: data.summary.earlyDeparture, incomplete: data.summary.incomplete
  },
  days: data.days.map((day) => ({
    date: day.date, status: day.status, statuses: day.statuses || [day.status],
    reason: day.reason || null, firstEntry: day.firstEntry || null, lastExit: day.lastExit || null,
    punches: day.punches, workedMinutes: day.workedMinutes
  }))
});

// Contrato de expediente externo. Solo incluye datos laborales y de contacto
// autorizados; nunca serializa el modelo completo ni secretos del reloj.
export const externalEmployee = (employee) => {
  const item = typeof employee.toJSON === 'function' ? employee.toJSON() : employee;
  const profile = item.profile || {};
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || item.name;
  return {
    id: item.id,
    employeeNumber: profile.employeeNumber || item.deviceUserId,
    clockNumber: item.deviceUserId,
    name: fullName,
    firstName: profile.firstName || null,
    lastName: profile.lastName || null,
    department: profile.department ? { id: profile.department.id, name: profile.department.name } : null,
    position: profile.position ? { id: profile.position.id, name: profile.position.name } : null,
    area: profile.area ? { id: profile.area.id, name: profile.area.name } : null,
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
  const profile = item.employee?.profile || {};
  return {
    id: String(item.id),
    employee: item.employee ? {
      id: item.employee.id,
      employeeNumber: item.employee.deviceUserId,
      firstName: profile.firstName || null,
      lastName: profile.lastName || null,
      name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || item.employee.name
    } : null,
    deviceUserId: item.deviceUserId,
    recordTime: item.recordTime,
    device: item.device ? { id: item.device.id, name: item.device.name, ip: item.device.ip } : { id: item.deviceId, ip: item.deviceIp }
  };
};

const employeeProfileInclude = {
  model: EmployeeProfile, as: 'profile', required: false,
  attributes: ['firstName', 'lastName', 'employeeNumber', 'employmentType', 'hireDate', 'employmentStatus', 'terminationDate', 'terminationReason', 'phone', 'officePhone', 'mobilePhone', 'email', 'city', 'birthDate'],
  include: [
    { model: Department, as: 'department', attributes: ['id', 'name'], required: false },
    { model: Position, as: 'position', attributes: ['id', 'name'], required: false },
    { model: Area, as: 'area', attributes: ['id', 'name'], required: false }
  ]
};

export const createIntegrationApp = ({ keyHash = process.env.INTEGRATION_API_KEY_SHA256 } = {}) => {
  if (!/^[a-f0-9]{64}$/i.test(keyHash || '')) throw new Error('Configura INTEGRATION_API_KEY_SHA256 (SHA-256 hexadecimal)');
  const expected = Buffer.from(keyHash, 'hex');
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const authorization = req.headers.authorization || '';
    const key = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const digest = createHash('sha256').update(key).digest();
    if (!key || !timingSafeEqual(digest, expected)) return res.status(401).json({ ok: false, message: 'Credencial de integración inválida' });
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
    res.on('finish', () => console.info(JSON.stringify({ integration: 'pilot', method: req.method, path: req.path, status: res.statusCode })));
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
        { model: Employee, as: 'employee', attributes: ['id', 'deviceUserId', 'name'], required: false,
          include: [{ model: EmployeeProfile, as: 'profile', attributes: ['firstName', 'lastName'], required: false }] },
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
  app.use((_req, res) => res.status(404).json({ ok: false, message: 'Operación no disponible en la integración' }));
  app.use((error, _req, res, _next) => {
    const status = [400, 404].includes(error.statusCode) ? error.statusCode : 500;
    res.status(status).json({ ok: false, message: status === 500 ? 'No fue posible consultar la integración' : error.message });
  });
  return app;
};
