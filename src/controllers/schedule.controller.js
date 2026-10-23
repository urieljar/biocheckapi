import sequelize from '../config/database.js';

import {
  WorkSchedule,
  ScheduleDay,
  EmployeeSchedule,
  Employee
} from '../models/index.js';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const previousDate = (dateString) => {
  const date = new Date(`${dateString}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() - 1);

  return date.toISOString().slice(0, 10);
};

const validateDays = (days) => {
  if (!Array.isArray(days) || days.length !== 7) {
    return 'Debes enviar exactamente los siete días de la semana';
  }

  const uniqueDays = new Set(
    days.map((day) => Number(day.dayOfWeek))
  );

  if (uniqueDays.size !== 7) {
    return 'No se pueden repetir días de la semana';
  }

  for (const day of days) {
    const dayNumber = Number(day.dayOfWeek);
    const isWorkDay = day.isWorkDay !== false;

    if (
      !Number.isInteger(dayNumber) ||
      dayNumber < 0 ||
      dayNumber > 6
    ) {
      return 'Existe un número de día inválido';
    }

    if (
      isWorkDay &&
      (
        !TIME_PATTERN.test(day.entryTime || '') ||
        !TIME_PATTERN.test(day.exitTime || '')
      )
    ) {
      return `El día ${dayNumber} necesita una hora de entrada y salida válida`;
    }
  }

  return null;
};

export const createSchedule = async (req, res) => {
  try {
    const {
      name,
      description,
      toleranceMinutes = 10,
      days
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        ok: false,
        message: 'El nombre del horario es obligatorio'
      });
    }

    const tolerance = Number(toleranceMinutes);

    if (
      !Number.isInteger(tolerance) ||
      tolerance < 0 ||
      tolerance > 180
    ) {
      return res.status(400).json({
        ok: false,
        message: 'La tolerancia debe estar entre 0 y 180 minutos'
      });
    }

    const daysError = validateDays(days);

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
            name: name.trim(),
            description: description?.trim() || null,
            toleranceMinutes: tolerance,
            timeZone: 'America/Mazatlan',
            active: true
          },
          { transaction }
        );

        const scheduleDays = days.map((day) => {
          const isWorkDay = day.isWorkDay !== false;

          return {
            scheduleId: createdSchedule.id,
            dayOfWeek: Number(day.dayOfWeek),
            isWorkDay,
            entryTime: isWorkDay
              ? day.entryTime
              : null,
            exitTime: isWorkDay
              ? day.exitTime
              : null,
            crossesMidnight:
              isWorkDay &&
              day.crossesMidnight === true
          };
        });

        await ScheduleDay.bulkCreate(scheduleDays, {
          transaction
        });

        return createdSchedule;
      }
    );

    const result = await WorkSchedule.findByPk(schedule.id, {
      include: [
        {
          model: ScheduleDay,
          as: 'days'
        }
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

export const assignSchedule = async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { employeeId, validFrom } = req.body;

    if (!employeeId || !validFrom) {
      return res.status(400).json({
        ok: false,
        message: 'employeeId y validFrom son obligatorios'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      return res.status(400).json({
        ok: false,
        message: 'validFrom debe usar el formato YYYY-MM-DD'
      });
    }

    const employee = await Employee.findByPk(employeeId);
    const schedule = await WorkSchedule.findByPk(scheduleId);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    if (!schedule || !schedule.active) {
      return res.status(404).json({
        ok: false,
        message: 'Horario activo no encontrado'
      });
    }

    const assignment = await sequelize.transaction(
      async (transaction) => {
        const currentAssignment =
          await EmployeeSchedule.findOne({
            where: {
              employeeId,
              active: true
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });

        if (
          currentAssignment &&
          validFrom <= currentAssignment.validFrom
        ) {
          const error = new Error(
            'La nueva fecha debe ser posterior al horario actual'
          );

          error.statusCode = 400;
          throw error;
        }

        if (currentAssignment) {
          await currentAssignment.update(
            {
              active: false,
              validTo: previousDate(validFrom)
            },
            { transaction }
          );
        }

        return EmployeeSchedule.create(
          {
            employeeId,
            scheduleId,
            validFrom,
            validTo: null,
            active: true
          },
          { transaction }
        );
      }
    );

    const result = await EmployeeSchedule.findByPk(
      assignment.id,
      {
        include: [
          {
            model: Employee,
            as: 'employee',
            attributes: [
              'id',
              'deviceUserId',
              'name'
            ]
          },
          {
            model: WorkSchedule,
            as: 'schedule'
          }
        ]
      }
    );

    res.status(201).json({
      ok: true,
      message: 'Horario asignado correctamente',
      data: result
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