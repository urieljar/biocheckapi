import { Op } from 'sequelize';
import sequelize from '../config/database.js';

import {
  WorkSchedule,
  ScheduleDay,
  EmployeeSchedule,
  Employee,
  EmployeeProfile
} from '../models/index.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const SCHEDULE_TYPES = new Set(['NORMAL', 'FLEXIBLE', 'MIXED']);
const DAY_TYPES = new Set(['NORMAL', 'FLEXIBLE', 'REST']);

const previousDate = (dateString) => {
  const date = new Date(`${dateString}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
};

const parseScheduleConfig = (body) => {
  const name = body.name?.trim();
  const type = String(body.type || 'NORMAL').toUpperCase();
  const tolerance = Number(body.toleranceMinutes ?? 10);
  const workMinutes = body.workMinutes === undefined || body.workMinutes === null || body.workMinutes === ''
    ? null
    : Number(body.workMinutes);

  if (!name) return { error: 'El nombre del horario es obligatorio' };
  if (!SCHEDULE_TYPES.has(type)) return { error: 'type debe ser NORMAL, FLEXIBLE o MIXED' };
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 180) {
    return { error: 'La tolerancia debe estar entre 0 y 180 minutos' };
  }
  if (type === 'FLEXIBLE' && (!Number.isInteger(workMinutes) || workMinutes < 1 || workMinutes > 1440)) {
    return { error: 'workMinutes es obligatorio para FLEXIBLE y debe estar entre 1 y 1440' };
  }
  if (workMinutes !== null && (!Number.isInteger(workMinutes) || workMinutes < 1 || workMinutes > 1440)) {
    return { error: 'workMinutes debe estar entre 1 y 1440 minutos' };
  }

  return {
    value: {
      name,
      description: body.description?.trim() || null,
      type,
      workMinutes,
      toleranceMinutes: tolerance,
      timeZone: body.timeZone?.trim() || 'America/Mazatlan',
      active: body.active !== false
    }
  };
};

const validateDays = (days, scheduleType, scheduleWorkMinutes) => {
  if (!Array.isArray(days) || days.length !== 7) {
    return 'Debes enviar exactamente los siete días de la semana';
  }

  const uniqueDays = new Set(days.map((day) => Number(day.dayOfWeek)));
  if (uniqueDays.size !== 7) return 'No se pueden repetir días de la semana';

  for (const day of days) {
    const dayNumber = Number(day.dayOfWeek);
    const isWorkDay = day.isWorkDay !== false;
    const dayType = String(
      day.dayType || (isWorkDay ? scheduleType === 'MIXED' ? 'NORMAL' : scheduleType : 'REST')
    ).toUpperCase();
    const dayWorkMinutes = day.workMinutes ?? scheduleWorkMinutes;

    if (!Number.isInteger(dayNumber) || dayNumber < 0 || dayNumber > 6) {
      return 'Existe un número de día inválido';
    }
    if (!DAY_TYPES.has(dayType)) return `El día ${dayNumber} tiene un dayType inválido`;
    if (!isWorkDay && dayType !== 'REST') return `El día ${dayNumber} debe ser REST si no es laboral`;
    if (isWorkDay && dayType === 'REST') return `El día ${dayNumber} debe ser laboral para usar NORMAL o FLEXIBLE`;
    if (scheduleType !== 'MIXED' && isWorkDay && dayType !== scheduleType) {
      return `El día ${dayNumber} debe usar dayType ${scheduleType}`;
    }
    if (isWorkDay && (!TIME_PATTERN.test(day.entryTime || '') || !TIME_PATTERN.test(day.exitTime || ''))) {
      return `El día ${dayNumber} necesita una hora de entrada y salida válida`;
    }
    if (isWorkDay && dayType === 'FLEXIBLE' && (!Number.isInteger(Number(dayWorkMinutes)) || Number(dayWorkMinutes) < 1 || Number(dayWorkMinutes) > 1440)) {
      return `El día ${dayNumber} necesita workMinutes entre 1 y 1440`;
    }
  }

  return null;
};

const buildScheduleDays = (scheduleId, days, scheduleType, scheduleWorkMinutes) => days.map((day) => {
  const isWorkDay = day.isWorkDay !== false;
  const dayType = String(
    day.dayType || (isWorkDay ? scheduleType === 'MIXED' ? 'NORMAL' : scheduleType : 'REST')
  ).toUpperCase();

  return {
    scheduleId,
    dayOfWeek: Number(day.dayOfWeek),
    isWorkDay,
    dayType,
    workMinutes: isWorkDay && dayType === 'FLEXIBLE'
      ? Number(day.workMinutes ?? scheduleWorkMinutes)
      : null,
    entryTime: isWorkDay ? day.entryTime : null,
    exitTime: isWorkDay ? day.exitTime : null,
    crossesMidnight: isWorkDay && day.crossesMidnight === true
  };
});

const scheduleInclude = {
  model: ScheduleDay,
  as: 'days'
};

export const createSchedule = async (req, res) => {
  try {
    const { value, error } = parseScheduleConfig(req.body);
    const { days } = req.body;

    if (error) return res.status(400).json({ ok: false, message: error });

    const daysError = validateDays(days, value.type, value.workMinutes);

    if (daysError) {
      return res.status(400).json({
        ok: false,
        message: daysError
      });
    }

    const schedule = await sequelize.transaction(
      async (transaction) => {
        const createdSchedule = await WorkSchedule.create(
          {
            ...value
          },
          { transaction }
        );

        await ScheduleDay.bulkCreate(
          buildScheduleDays(createdSchedule.id, days, value.type, value.workMinutes),
          {
          transaction
          }
        );

        return createdSchedule;
      }
    );

    const result = await WorkSchedule.findByPk(schedule.id, {
      include: [
        scheduleInclude
      ],
      order: [
        [
          {
            model: ScheduleDay,
            as: 'days'
          },
          'dayOfWeek',
          'ASC'
        ]
      ]
    });

    res.status(201).json({
      ok: true,
      message: 'Horario creado correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error al crear horario:', error.message);

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        ok: false,
        message: 'Ya existe un horario con ese nombre'
      });
    }

    res.status(500).json({
      ok: false,
      message: 'No fue posible crear el horario'
    });
  }
};

export const getSchedules = async (req, res) => {
  try {
    const schedules = await WorkSchedule.findAll({
      include: [
        {
          model: ScheduleDay,
          as: 'days'
        },
        {
          model: EmployeeSchedule,
          as: 'employeeAssignments',
          where: { active: true },
          required: false,
          attributes: ['id', 'employeeId']
        }
      ],
      order: [
        ['name', 'ASC'],
        [
          {
            model: ScheduleDay,
            as: 'days'
          },
          'dayOfWeek',
          'ASC'
        ]
      ]
    });

    res.json({
      ok: true,
      data: schedules
    });
  } catch (error) {
    console.error('Error al consultar horarios:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los horarios'
    });
  }
};

export const getSchedule = async (req, res) => {
  try {
    const schedule = await WorkSchedule.findByPk(req.params.id, {
      include: [scheduleInclude],
      order: [[{ model: ScheduleDay, as: 'days' }, 'dayOfWeek', 'ASC']]
    });

    if (!schedule) {
      return res.status(404).json({
        ok: false,
        message: 'Horario no encontrado'
      });
    }

    res.json({ ok: true, data: schedule });
  } catch (error) {
    console.error('Error al consultar horario:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el horario'
    });
  }
};

export const updateSchedule = async (req, res) => {
  try {
    const schedule = await WorkSchedule.findByPk(req.params.id);

    if (!schedule) {
      return res.status(404).json({ ok: false, message: 'Horario no encontrado' });
    }

    const mergedBody = {
      name: req.body.name ?? schedule.name,
      description: req.body.description ?? schedule.description,
      type: req.body.type ?? schedule.type,
      workMinutes: req.body.workMinutes ?? schedule.workMinutes,
      toleranceMinutes: req.body.toleranceMinutes ?? schedule.toleranceMinutes,
      timeZone: req.body.timeZone ?? schedule.timeZone,
      active: req.body.active ?? schedule.active
    };
    const { value, error } = parseScheduleConfig(mergedBody);

    if (error) return res.status(400).json({ ok: false, message: error });

    const days = req.body.days;
    if (days !== undefined) {
      const daysError = validateDays(days, value.type, value.workMinutes);
      if (daysError) return res.status(400).json({ ok: false, message: daysError });
    }

    await sequelize.transaction(async (transaction) => {
      await schedule.update(value, { transaction });

      if (days !== undefined) {
        await ScheduleDay.destroy({
          where: { scheduleId: schedule.id },
          transaction
        });
        await ScheduleDay.bulkCreate(
          buildScheduleDays(schedule.id, days, value.type, value.workMinutes),
          { transaction }
        );
      }
    });

    const result = await WorkSchedule.findByPk(schedule.id, {
      include: [scheduleInclude]
    });

    res.json({
      ok: true,
      message: 'Horario actualizado correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error al actualizar horario:', error.message);
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ ok: false, message: 'Ya existe un horario con ese nombre' });
    }
    res.status(500).json({ ok: false, message: 'No fue posible actualizar el horario' });
  }
};

export const deleteSchedule = async (req, res) => {
  try {
    const schedule = await WorkSchedule.findByPk(req.params.id);

    if (!schedule) {
      return res.status(404).json({ ok: false, message: 'Horario no encontrado' });
    }

    const assignments = await EmployeeSchedule.count({
      where: { scheduleId: schedule.id, active: true }
    });

    if (assignments > 0) {
      return res.status(409).json({
        ok: false,
        message: 'No se puede eliminar porque el horario tiene empleados asignados',
        data: { assignments }
      });
    }

    await schedule.update({ active: false });

    res.json({
      ok: true,
      message: 'Horario desactivado correctamente',
      data: schedule
    });
  } catch (error) {
    console.error('Error al eliminar horario:', error.message);
    res.status(500).json({ ok: false, message: 'No fue posible eliminar el horario' });
  }
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const getEmployeeSchedule = async (id) => {
  return EmployeeSchedule.findByPk(id, {
    include: [
      {
        model: Employee,
        as: 'employee',
        attributes: ['id', 'deviceUserId', 'name']
      },
      {
        model: WorkSchedule,
        as: 'schedule'
      }
    ]
  });
};

export const getEmployeeSchedules = async (req, res) => {
  try {
    const where = {};

    if (req.query.employeeId) where.employeeId = req.query.employeeId;
    if (req.query.scheduleId) where.scheduleId = req.query.scheduleId;
    if (req.query.active !== undefined) {
      where.active = req.query.active === 'true';
    } else if (req.query.all !== 'true') {
      where.active = true;
    }

    const assignments = await EmployeeSchedule.findAll({
      where,
      include: [
        {
          model: Employee,
          as: 'employee',
          attributes: ['id', 'deviceUserId', 'name', 'active']
        },
        {
          model: WorkSchedule,
          as: 'schedule',
          include: [scheduleInclude]
        }
      ],
      order: [['validFrom', 'DESC']]
    });

    res.json({
      ok: true,
      data: assignments
    });
  } catch (error) {
    console.error('Error al consultar asignaciones:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar las asignaciones de horarios'
    });
  }
};

export const getEmployeeScheduleById = async (req, res) => {
  try {
    const assignment = await getEmployeeSchedule(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        ok: false,
        message: 'Asignación de horario no encontrada'
      });
    }

    res.json({
      ok: true,
      data: assignment
    });
  } catch (error) {
    console.error('Error al consultar asignación:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar la asignación de horario'
    });
  }
};

export const updateEmployeeSchedule = async (req, res) => {
  try {
    const assignment = await EmployeeSchedule.findByPk(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        ok: false,
        message: 'Asignación de horario no encontrada'
      });
    }

    const updates = {};
    const scheduleId = req.body.scheduleId ?? assignment.scheduleId;
    const validFrom = req.body.validFrom ?? assignment.validFrom;
    const validTo = req.body.validTo ?? assignment.validTo;

    if (!DATE_PATTERN.test(validFrom)) {
      return res.status(400).json({
        ok: false,
        message: 'validFrom debe usar el formato YYYY-MM-DD'
      });
    }

    if (validTo !== null && validTo !== undefined && !DATE_PATTERN.test(validTo)) {
      return res.status(400).json({
        ok: false,
        message: 'validTo debe usar el formato YYYY-MM-DD o null'
      });
    }

    if (validTo && validTo < validFrom) {
      return res.status(400).json({
        ok: false,
        message: 'validTo no puede ser anterior a validFrom'
      });
    }

    const schedule = await WorkSchedule.findByPk(scheduleId);

    if (!schedule || (req.body.active !== false && !schedule.active)) {
      return res.status(404).json({
        ok: false,
        message: 'Horario activo no encontrado'
      });
    }

    if (req.body.scheduleId !== undefined) updates.scheduleId = scheduleId;
    if (req.body.validFrom !== undefined) updates.validFrom = validFrom;
    if (req.body.validTo !== undefined) updates.validTo = validTo || null;

    if (req.body.active !== undefined) {
      if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({
          ok: false,
          message: 'active debe ser booleano'
        });
      }

      updates.active = req.body.active;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Envía scheduleId, validFrom, validTo o active'
      });
    }

    if (updates.active !== false) {
      const anotherActive = await EmployeeSchedule.findOne({
        where: {
          employeeId: assignment.employeeId,
          active: true,
          id: { [Op.ne]: assignment.id }
        }
      });

      if (anotherActive) {
        return res.status(409).json({
          ok: false,
          message: 'El empleado ya tiene otra asignación activa'
        });
      }
    }

    await assignment.update(updates);
    const result = await getEmployeeSchedule(assignment.id);

    res.json({
      ok: true,
      message: 'Asignación de horario actualizada correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error al actualizar asignación:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar la asignación de horario'
    });
  }
};

export const deleteEmployeeSchedule = async (req, res) => {
  try {
    const assignment = await EmployeeSchedule.findByPk(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        ok: false,
        message: 'Asignación de horario no encontrada'
      });
    }

    await assignment.destroy();

    res.json({
      ok: true,
      message: 'Asignación de horario eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar asignación:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible eliminar la asignación de horario'
    });
  }
};

export const assignSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { validFrom } = req.body;
    const rawIds = Array.isArray(req.body.employeeIds)
      ? req.body.employeeIds
      : req.body.employeeId
        ? [req.body.employeeId]
        : [];

    const targetEmployeeIds = [...new Set(rawIds.filter(Boolean))];

    if (targetEmployeeIds.length === 0 || !validFrom) {
      return res.status(400).json({
        ok: false,
        message: 'Debes seleccionar al menos un empleado y una fecha válida'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      return res.status(400).json({
        ok: false,
        message: 'validFrom debe usar el formato YYYY-MM-DD'
      });
    }

    const schedule = await WorkSchedule.findByPk(scheduleId);

    if (!schedule || !schedule.active) {
      return res.status(404).json({
        ok: false,
        message: 'Horario activo no encontrado'
      });
    }

    const createdIds = await sequelize.transaction(async (transaction) => {
      const created = [];

      for (const employeeId of targetEmployeeIds) {
        const employee = await Employee.findByPk(employeeId, { transaction });
        if (!employee) continue;
        const profile = await EmployeeProfile.findOne({ where: { employeeId }, transaction });
        if (profile?.employmentStatus === 'TERMINATED') {
          const err = new Error(`El empleado "${employee.name}" está dado de baja y no puede recibir horarios.`);
          err.statusCode = 409;
          throw err;
        }

        const currentAssignment = await EmployeeSchedule.findOne({
          where: {
            employeeId,
            active: true
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (currentAssignment) {
          if (currentAssignment.scheduleId === scheduleId) {
            continue; // Ya asignado a este mismo horario
          }
          const conflicting = await WorkSchedule.findByPk(currentAssignment.scheduleId, { transaction });
          const err = new Error(
            `El empleado "${employee.name}" ya cuenta con el horario "${conflicting?.name || 'otro horario'}" asignado. Solo se permite un horario por empleado; desasígnalo primero.`
          );
          err.statusCode = 409;
          throw err;
        }

        const newAsg = await EmployeeSchedule.create(
          {
            employeeId,
            scheduleId,
            validFrom,
            validTo: null,
            active: true
          },
          { transaction }
        );
        created.push(newAsg.id);
      }

      return created;
    });

    const results = await EmployeeSchedule.findAll({
      where: { id: createdIds },
      include: [
        {
          model: Employee,
          as: 'employee',
          attributes: ['id', 'deviceUserId', 'name']
        },
        {
          model: WorkSchedule,
          as: 'schedule'
        }
      ]
    });

    res.status(201).json({
      ok: true,
      message: `Horario asignado correctamente a ${results.length} empleado(s)`,
      data: results.length === 1 ? results[0] : results
    });
  } catch (error) {
    console.error('Error al asignar horario:', error.message);

    res.status(error.statusCode || 500).json({
      ok: false,
      message:
        error.statusCode
          ? error.message
          : 'No fue posible asignar el horario'
    });
  }
};
