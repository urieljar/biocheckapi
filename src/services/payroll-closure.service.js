import { Op } from 'sequelize';
import { EmployeeProfile, PayrollClosure } from '../models/index.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
const validDate = (value, field) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${field} debe usar YYYY-MM-DD`);
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) fail(`${field} no es válida`);
  return value;
};

export const assertPeriodOpen = async ({ date, departmentId = null, transaction }) => {
  const rows = await PayrollClosure.findAll({ where: { status: 'CLOSED', fromDate: { [Op.lte]: date }, toDate: { [Op.gte]: date }, [Op.or]: [{ departmentId: null }, ...(departmentId ? [{ departmentId }] : [])] }, transaction });
  if (rows.length) fail(`El periodo está cerrado (${rows[0].fromDate} al ${rows[0].toDate}). Reabre la pre-nómina para modificarlo.`, 409);
};

export const closePayrollPeriod = async ({ fromDate, toDate, departmentId = null, notes = null, actorId }) => {
  validDate(fromDate, 'fromDate'); validDate(toDate, 'toDate');
  if (fromDate > toDate) fail('fromDate no puede ser posterior a toDate');
  if (notes != null && (typeof notes !== 'string' || notes.length > 500)) fail('notes debe tener máximo 500 caracteres');
  const overlap = await PayrollClosure.findOne({ where: { status: 'CLOSED', fromDate: { [Op.lte]: toDate }, toDate: { [Op.gte]: fromDate }, [Op.or]: [{ departmentId: null }, ...(departmentId ? [{ departmentId }] : [])] } });
  if (overlap) fail('El periodo se cruza con otro cierre activo', 409);
  return PayrollClosure.create({ fromDate, toDate, departmentId, notes: notes || null, closedBy: actorId, status: 'CLOSED' });
};

export const reopenPayrollPeriod = async ({ id, reason, actorId }) => {
  if (!reason || typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 500) fail('Debes indicar un motivo de reapertura (5 a 500 caracteres)');
  const closure = await PayrollClosure.findByPk(id);
  if (!closure) fail('Cierre de pre-nómina no encontrado', 404);
  if (closure.status !== 'CLOSED') fail('El periodo ya está reabierto', 409);
  await closure.update({ status: 'REOPENED', reopenedBy: actorId, reopenedAt: new Date(), reopenReason: reason.trim() });
  return closure;
};

export const listPayrollClosures = () => PayrollClosure.findAll({ order: [['fromDate', 'DESC'], ['createdAt', 'DESC']], limit: 100 });

export const assertAttendancePeriodOpen = async ({ employeeId, date, transaction }) => {
  let departmentId = null;
  if (employeeId) departmentId = (await EmployeeProfile.findOne({ where: { employeeId }, attributes: ['departmentId'], transaction }))?.departmentId || null;
  return assertPeriodOpen({ date, departmentId, transaction });
};
