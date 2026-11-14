import { Op } from 'sequelize';
import {
  CalendarException,
  Employee,
  Department,
  Area,
  WorkSchedule
} from '../models/index.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const TYPES = new Set([
  'HOLIDAY',
  'VACATION',
  'PERMISSION',
  'SICK_LEAVE',
  'SPECIAL_REST',
  'REDUCED_DAY',
  'SCHEDULE_CHANGE'
]);
const SCOPES = new Set(['GLOBAL', 'EMPLOYEE', 'DEPARTMENT', 'AREA']);

const includes = [
  { model: Employee, as: 'employee', attributes: ['id', 'deviceUserId', 'name'] },
  { model: Department, as: 'department', attributes: ['id', 'code', 'name'] },
  { model: Area, as: 'area', attributes: ['id', 'code', 'name'] },
  { model: WorkSchedule, as: 'schedule', attributes: ['id', 'name', 'type'] }
];

const normalize = (body, current = {}) => {
  const name = String(body.name ?? current.name ?? '').trim();
  const date = body.date ?? current.date;
  const type = String(body.type ?? current.type ?? '').toUpperCase();
  const scope = String(body.scope ?? current.scope ?? 'GLOBAL').toUpperCase();
  const isWorkDay = body.isWorkDay ?? current.isWorkDay ?? false;
  const entryTime = body.entryTime ?? current.entryTime ?? null;
  const exitTime = body.exitTime ?? current.exitTime ?? null;
  const workMinutes = body.workMinutes ?? current.workMinutes ?? null;

  if (!name) return { error: 'name es obligatorio' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { error: 'date debe usar YYYY-MM-DD' };
  if (!TYPES.has(type)) return { error: 'type no es válido' };
  if (!SCOPES.has(scope)) return { error: 'scope no es válido' };
  if (typeof isWorkDay !== 'boolean') return { error: 'isWorkDay debe ser booleano' };
  if (entryTime && !TIME_PATTERN.test(entryTime)) return { error: 'entryTime no es válida' };
  if (exitTime && !TIME_PATTERN.test(exitTime)) return { error: 'exitTime no es válida' };

  const minutes = workMinutes === null || workMinutes === '' ? null : Number(workMinutes);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)) {
    return { error: 'workMinutes debe estar entre 1 y 1440' };
  }

  return {
    value: {
      name,
      date,
      type,
      scope,
      description: body.description ?? current.description ?? null,
      employeeId: body.employeeId ?? current.employeeId ?? null,
      departmentId: body.departmentId ?? current.departmentId ?? null,
      areaId: body.areaId ?? current.areaId ?? null,
      scheduleId: body.scheduleId ?? current.scheduleId ?? null,
      isWorkDay,
      entryTime: isWorkDay ? entryTime : null,
      exitTime: isWorkDay ? exitTime : null,
      workMinutes: isWorkDay ? minutes : null,
      active: body.active ?? current.active ?? true
    }
  };
};

const validateReferences = async (data) => {
  if (data.scope === 'EMPLOYEE' && !data.employeeId) return 'employeeId es obligatorio para scope EMPLOYEE';
  if (data.scope === 'DEPARTMENT' && !data.departmentId) return 'departmentId es obligatorio para scope DEPARTMENT';
  if (data.scope === 'AREA' && !data.areaId) return 'areaId es obligatorio para scope AREA';

  if (data.employeeId && !(await Employee.findByPk(data.employeeId))) return 'Empleado no encontrado';
  if (data.departmentId && !(await Department.findByPk(data.departmentId))) return 'Departamento no encontrado';
  if (data.areaId && !(await Area.findByPk(data.areaId))) return 'Área no encontrada';
  if (data.scheduleId && !(await WorkSchedule.findByPk(data.scheduleId))) return 'Horario no encontrado';

  return null;
};

export const getCalendarExceptions = async (req, res) => {
  try {
    const where = {};
    if (req.query.date) where.date = req.query.date;
    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.departmentId) where.departmentId = req.query.departmentId;
    if (req.query.areaId) where.areaId = req.query.areaId;
    if (req.query.active !== undefined) where.active = req.query.active === 'true';
    if (req.query.from || req.query.to) {
      where.date = {};
      if (req.query.from) where.date[Op.gte] = req.query.from;
      if (req.query.to) where.date[Op.lte] = req.query.to;
    }

    const rows = await CalendarException.findAll({
      where,
      include: includes,
      order: [['date', 'ASC'], ['createdAt', 'ASC']]
    });

    res.json({ ok: true, data: rows });
  } catch (error) {
    console.error('Error al consultar excepciones:', error.message);
    res.status(500).json({ ok: false, message: 'No fue posible consultar el calendario' });
  }
};

export const getCalendarException = async (req, res) => {
  try {
    const row = await CalendarException.findByPk(req.params.id, { include: includes });
    if (!row) return res.status(404).json({ ok: false, message: 'Excepción no encontrada' });
    res.json({ ok: true, data: row });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'No fue posible consultar la excepción' });
  }
};

export const createCalendarException = async (req, res) => {
  try {
    const { value, error } = normalize(req.body);
    if (error) return res.status(400).json({ ok: false, message: error });
    const referenceError = await validateReferences(value);
    if (referenceError) return res.status(400).json({ ok: false, message: referenceError });

    const startDate = value.date;
    const endDate = req.body.endDate || req.body.dateTo || startDate;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      return res.status(400).json({ ok: false, message: 'endDate debe tener formato YYYY-MM-DD' });
    }

    if (endDate < startDate) {
      return res.status(400).json({ ok: false, message: 'La fecha final no puede ser anterior a la fecha inicial' });
    }

    const start = new Date(startDate + 'T00:00:00Z');
    const end = new Date(endDate + 'T00:00:00Z');
    const diffDays = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    if (diffDays > 90) {
      return res.status(400).json({ ok: false, message: 'El período máximo para registrar en una sola acción es de 90 días' });
    }

    if (diffDays === 1) {
      const whereScope = {
        date: startDate,
        scope: value.scope
      };
      if (value.scope === 'EMPLOYEE') whereScope.employeeId = value.employeeId;
      else if (value.scope === 'DEPARTMENT') whereScope.departmentId = value.departmentId;
      else if (value.scope === 'AREA') whereScope.areaId = value.areaId;

      const existing = await CalendarException.findOne({ where: whereScope });
      let result;
      if (existing) {
        await existing.update(value);
        result = await CalendarException.findByPk(existing.id, { include: includes });
      } else {
        const row = await CalendarException.create(value);
        result = await CalendarException.findByPk(row.id, { include: includes });
      }
      return res.status(201).json({ ok: true, message: 'Excepción registrada correctamente', data: result });
    }

    // Período de múltiples días (Vacaciones, Incapacidades, etc.)
    const createdRows = [];
    const curr = new Date(start);
    while (curr <= end) {
      const dateStr = curr.toISOString().slice(0, 10);
      const dayData = { ...value, date: dateStr };

      const whereScope = {
        date: dateStr,
        scope: value.scope
      };
      if (value.scope === 'EMPLOYEE') whereScope.employeeId = value.employeeId;
      else if (value.scope === 'DEPARTMENT') whereScope.departmentId = value.departmentId;
      else if (value.scope === 'AREA') whereScope.areaId = value.areaId;

      const existing = await CalendarException.findOne({ where: whereScope });
      if (existing) {
        await existing.update(dayData);
        createdRows.push(existing);
      } else {
        const created = await CalendarException.create(dayData);
        createdRows.push(created);
      }
      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    const firstResult = await CalendarException.findByPk(createdRows[0].id, { include: includes });
    return res.status(201).json({
      ok: true,
      message: `Se registraron exitosamente ${createdRows.length} días de ${value.name}`,
      count: createdRows.length,
      data: firstResult
    });
  } catch (error) {
    console.error('Error al crear excepción:', error.message);
    res.status(500).json({ ok: false, message: 'No fue posible crear la excepción' });
  }
};

export const updateCalendarException = async (req, res) => {
  try {
    const row = await CalendarException.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, message: 'Excepción no encontrada' });

    const { value, error } = normalize(req.body, row.toJSON());
    if (error) return res.status(400).json({ ok: false, message: error });
    const referenceError = await validateReferences(value);
    if (referenceError) return res.status(400).json({ ok: false, message: referenceError });

    await row.update(value);
    const result = await CalendarException.findByPk(row.id, { include: includes });
    res.json({ ok: true, message: 'Excepción actualizada correctamente', data: result });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'No fue posible actualizar la excepción' });
  }
};

export const deleteCalendarException = async (req, res) => {
  try {
    const row = await CalendarException.findByPk(req.params.id);
    if (!row) return res.status(404).json({ ok: false, message: 'Excepción no encontrada' });
    await row.update({ active: false });
    res.json({ ok: true, message: 'Excepción desactivada correctamente', data: row });
  } catch (error) {
    res.status(500).json({ ok: false, message: 'No fue posible eliminar la excepción' });
  }
};
