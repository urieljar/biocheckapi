import { Op } from 'sequelize';
import { Employee, EmployeeProfile, Device, Department, Position } from '../models/index.js';

export const EVENT_TIME_ZONE = 'America/Mazatlan';
const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const text = (value, field) => {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 255) invalid(`${field} debe ser texto de máximo 255 caracteres`);
  return value.trim();
};
const integer = (value, fallback, maximum, field) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > maximum) invalid(`${field} debe ser entero entre 1 y ${maximum}`);
  return Number(value);
};
const boundary = (value, end, field) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field} debe usar YYYY-MM-DD`);
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) invalid(`${field} no es una fecha válida`);
  return new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}-07:00`);
};

export const buildEventQuery = (query) => {
  const page = integer(query.page, 1, 1000000, 'page');
  const limit = integer(query.limit, 20, 100, 'limit');
  const where = {};
  for (const field of ['employeeId', 'deviceId', 'departmentId', 'positionId']) {
    const value = text(query[field], field);
    if (!value) continue;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) invalid(`${field} debe ser un UUID válido`);
    where[field === 'departmentId' || field === 'positionId' ? `$employee.profile.${field}$` : field] = value;
  }
  const deviceUserId = text(query.deviceUserId, 'deviceUserId');
  if (deviceUserId) where.deviceUserId = deviceUserId;
  const search = text(query.search, 'search');
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    where[Op.or] = ['deviceUserId', '$employee.name$', '$employee.profile.firstName$', '$employee.profile.lastName$'].map((field) => ({ [field]: { [Op.iLike]: pattern } }));
  }
  const from = boundary(text(query.from, 'from'), false, 'from');
  const to = boundary(text(query.to, 'to'), true, 'to');
  if (from && to && from > to) invalid('La fecha inicial no puede ser posterior a la final');
  if (from || to) where.recordTime = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
  return { page, limit, options: {
    where,
    attributes: ['id', 'deviceId', 'employeeId', 'deviceUserId', 'deviceUserSn', 'recordTime', 'deviceIp', 'source'],
    include: [
      { model: Employee, as: 'employee', attributes: ['id', 'name', 'deviceUserId'], required: false,
        include: [{ model: EmployeeProfile, as: 'profile', required: false,
          attributes: ['firstName', 'lastName', 'departmentId', 'positionId'],
          include: [
            { model: Department, as: 'department', attributes: ['id', 'name'], required: false },
            { model: Position, as: 'position', attributes: ['id', 'name'], required: false }
          ]
        }]
      },
      { model: Device, as: 'device', attributes: ['id', 'name', 'ip'], required: false }
    ],
    subQuery: false, order: [['recordTime', 'DESC'], ['id', 'DESC']]
  } };
};

export const eventReportRow = (row) => {
  const item = typeof row.toJSON === 'function' ? row.toJSON() : row;
  const profile = item.employee?.profile;
  const profileName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: EVENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(item.recordTime)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { ...item,
    employeeName: profileName || item.employee?.name || 'Sin empleado vinculado',
    departmentName: profile?.department?.name || 'Sin información', positionName: profile?.position?.name || 'Sin información',
    eventType: 'UNCLASSIFIED', eventLabel: 'Sin clasificar',
    localDate: `${parts.year}-${parts.month}-${parts.day}`, localTime: `${parts.hour}:${parts.minute}:${parts.second}`,
    recordTimeLocal: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`, timeZone: EVENT_TIME_ZONE
  };
};

export const csvCell = (value) => {
  let result = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(result) || /^[\t\r\n]/.test(result)) result = `'${result}`;
  return `"${result.replaceAll('"', '""')}"`;
};
export const eventCsvLine = (item) => [item.id, item.deviceUserId, item.employeeName, item.departmentName, item.positionName,
  item.localDate, item.localTime, item.eventLabel, item.device?.name || 'Sin información',
  item.deviceIp || item.device?.ip || 'Sin información', item.source, item.timeZone
].map(csvCell).join(',') + '\r\n';
export const EVENT_CSV_HEADER = ['Registro', 'ID empleado', 'Empleado', 'Departamento', 'Cargo', 'Fecha', 'Hora', 'Evento', 'Dispositivo', 'IP', 'Origen', 'Zona horaria'].map(csvCell).join(',') + '\r\n';
export const htmlCell = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
