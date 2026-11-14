import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import { Employee, EmployeeProfile, EmploymentPeriod, Attendance, EmployeeSchedule, CalendarException, DeviceCommand } from '../models/index.js';

const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), { statusCode }); };
export const laborToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mazatlan' }).format(new Date());
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('La fecha debe usar YYYY-MM-DD');
  const parsed = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('Fecha inválida');
  if (value > laborToday()) fail('La fecha no puede ser futura');
  return value;
};
const note = (value, limit = 255) => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > limit) fail(`El texto admite máximo ${limit} caracteres`);
  return value.trim() || null;
};

export const changeEmployment = async ({ employeeId, action, body = {}, actorId }) => {
  const date = validDate(body.date);
  const reason = note(body.reason);
  const notes = note(body.notes, 2000);
  if (action === 'terminate' && !reason) fail('Selecciona un motivo de baja');
  return sequelize.transaction(async (transaction) => {
    const employee = await Employee.findByPk(employeeId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!employee) fail('Empleado no encontrado', 404);
    let profile = await EmployeeProfile.findOne({ where: { employeeId }, transaction });
    if (!profile) profile = await EmployeeProfile.create({ employeeId }, { transaction });
    const periods = await EmploymentPeriod.findAll({ where: { employeeId }, order: [['createdAt', 'ASC']], transaction });
    const open = periods.find((period) => !period.validTo);
    if (action === 'terminate') {
      if (profile.employmentStatus === 'TERMINATED') fail('El empleado ya está dado de baja', 409);
      const start = open?.validFrom || profile.hireDate;
      if (start && date < start) fail('La baja no puede ser anterior al ingreso');
      if (open) await open.update({ validTo: date, terminationReason: reason, notes, endedBy: actorId, endedAt: new Date() }, { transaction });
      else await EmploymentPeriod.create({ employeeId, validFrom: start || null, validTo: date, terminationReason: reason, notes, createdBy: actorId, endedBy: actorId, endedAt: new Date() }, { transaction });
      await profile.update({ employmentStatus: 'TERMINATED', terminationDate: date, terminationReason: reason }, { transaction });
      await employee.update({ active: false }, { transaction });
      // Cancela órdenes aún no entregadas para no volver a darlo de alta por ADMS.
      await DeviceCommand.update({ status: 'ERROR', responseBody: 'Cancelado por baja laboral' }, { where: { employeeId, status: 'PENDING' }, transaction });
    } else {
      if (action !== 'rehire') fail('Acción inválida');
      if (profile.employmentStatus !== 'TERMINATED' || open) fail('Solo se permite reingresar a una persona dada de baja', 409);
      const previousEnd = periods.reduce((last, period) => period.validTo && period.validTo > last ? period.validTo : last, profile.terminationDate || '');
      if (!previousEnd || date <= previousEnd) fail('El reingreso debe ser posterior a la última baja');
      if (!periods.length) await EmploymentPeriod.create({ employeeId, validFrom: profile.hireDate || null, validTo: profile.terminationDate, terminationReason: profile.terminationReason, createdBy: actorId }, { transaction });
      await EmploymentPeriod.create({ employeeId, validFrom: date, validTo: null, notes, createdBy: actorId }, { transaction });
      await profile.update({ employmentStatus: 'ACTIVE', hireDate: date, terminationDate: null, terminationReason: null }, { transaction });
      // El reingreso no envía ni modifica automáticamente a la persona en el reloj.
      await employee.update({ active: true }, { transaction });
    }
    return { id: employee.id, name: employee.name, employmentStatus: profile.employmentStatus };
  });
};

export const archiveEmployee = async ({ employeeId, actorId, confirmation }) => sequelize.transaction(async (transaction) => {
  const employee = await Employee.findByPk(employeeId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!employee) fail('Empleado no encontrado', 404);
  if (confirmation !== employee.deviceUserId) fail('Confirma el número del empleado para eliminar el registro');
  const counts = [await Attendance.count({ where: { [Op.or]: [{ employeeId }, { employeeId: null, deviceId: employee.deviceId, deviceUserId: employee.deviceUserId }] }, transaction })];
  for (const Model of [EmployeeSchedule, CalendarException, DeviceCommand, EmploymentPeriod]) {
    counts.push(await Model.count({ where: { employeeId }, transaction }));
  }
  const profile = await EmployeeProfile.findOne({ where: { employeeId }, transaction });
  if (counts.some(Boolean) || profile?.employmentStatus === 'TERMINATED') fail('El empleado tiene historial. Utiliza Dar de baja para conservarlo.', 409);
  await employee.update({ active: false, deletedBy: actorId }, { transaction });
  await employee.destroy({ transaction }); // paranoid: conserva registro y expediente.
  return { id: employee.id, name: employee.name };
});

export const restoreEmployee = async (employeeId) => sequelize.transaction(async (transaction) => {
  const employee = await Employee.findByPk(employeeId, { paranoid: false, transaction, lock: transaction.LOCK.UPDATE });
  if (!employee?.deletedAt) fail('Registro eliminado no encontrado', 404);
  await employee.restore({ transaction });
  await employee.update({ deletedBy: null }, { transaction });
  return { id: employee.id, name: employee.name };
});
