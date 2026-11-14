import { Op } from 'sequelize';
import { Attendance, Device, Employee } from '../models/index.js';
import { assertAttendancePeriodOpen } from './payroll-closure.service.js';

const TIME_ZONE = 'America/Mazatlan';
const invalid = (message) => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const dateParam = (value, end, field) => {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field} debe usar YYYY-MM-DD`);
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}-07:00`);
  if (Number.isNaN(date.getTime())) invalid(`${field} no es una fecha válida`);
  return date;
};

export const getOrphanAttendanceReport = async ({ query = {} }) => {
  const page = Math.min(Math.max(Number(query.page) || 1, 1), 1000000);
  const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100);
  const where = { employeeId: null };
  if (query.deviceUserId) where.deviceUserId = String(query.deviceUserId).trim().slice(0, 120);
  if (query.deviceId) where.deviceId = String(query.deviceId).trim();
  const from = dateParam(query.from, false, 'from');
  const to = dateParam(query.to, true, 'to');
  if (from && to && from > to) invalid('La fecha inicial no puede ser posterior a la final');
  if (from || to) where.recordTime = { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };
  const { rows, count } = await Attendance.findAndCountAll({
    where, attributes: ['id', 'deviceId', 'deviceUserId', 'deviceUserSn', 'recordTime', 'deviceIp', 'source'],
    include: [{ model: Device, as: 'device', attributes: ['id', 'name', 'ip'], required: false }],
    order: [['recordTime', 'DESC'], ['id', 'DESC']], limit, offset: (page - 1) * limit
  });
  const data = rows.map((row) => {
    const item = typeof row.toJSON === 'function' ? row.toJSON() : row;
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(item.recordTime)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    return { ...item, localDate: `${parts.year}-${parts.month}-${parts.day}`, localTime: `${parts.hour}:${parts.minute}:${parts.second}`, timeZone: TIME_ZONE, reason: 'Sin employeeId; requiere revisión manual' };
  });
  return { data, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }, timeZone: TIME_ZONE };
};

export const assignOrphanAttendance = async ({ attendanceId, employeeId, reason, confirmMismatch, actorId }) => {
  if (!employeeId || typeof employeeId !== 'string') invalid('employeeId es obligatorio');
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) invalid('Debes indicar un motivo de revisión (5 a 500 caracteres)');
  const row = await Attendance.findByPk(attendanceId);
  if (!row) invalid('Checada huérfana no encontrada', 404);
  if (row.employeeId) invalid('La checada ya está vinculada a un empleado', 409);
  const employee = await Employee.findByPk(employeeId);
  if (!employee) invalid('Empleado no encontrado', 404);
  if (String(employee.deviceUserId) !== String(row.deviceUserId) && confirmMismatch !== true) invalid('El PIN no coincide con el empleado. Confirma explícitamente la asociación.', 409);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(row.recordTime));
  await assertAttendancePeriodOpen({ employeeId, date });
  await row.update({ employeeId, reviewedAt: new Date(), reviewedBy: actorId, reviewReason: reason.trim() });
  return row;
};
