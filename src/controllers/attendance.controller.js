import { Op } from 'sequelize';

import {
  Attendance,
  Employee,
  Device
} from '../models/index.js';

const TIME_ZONE = 'America/Mazatlan';

const formatLocalTime = (date) => {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(date));
};

const parseStartDate = (value) => {
  if (!value) return null;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00-07:00`)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

const parseEndDate = (value) => {
  if (!value) return null;

  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T23:59:59.999-07:00`)
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

export const getAttendances = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 50, 1),
      100
    );

    const offset = (page - 1) * limit;
    const where = {};

    if (req.query.deviceUserId) {
      where.deviceUserId = String(req.query.deviceUserId);
    }

    if (req.query.employeeId) {
      where.employeeId = req.query.employeeId;
    }

    const from = parseStartDate(req.query.from);
    const to = parseEndDate(req.query.to);

    if (req.query.from && !from) {
      return res.status(400).json({
        ok: false,
        message: 'La fecha inicial no es válida'
      });
    }

    if (req.query.to && !to) {
      return res.status(400).json({
        ok: false,
        message: 'La fecha final no es válida'
      });
    }

    if (from || to) {
      where.recordTime = {};

      if (from) {
        where.recordTime[Op.gte] = from;
      }

      if (to) {
        where.recordTime[Op.lte] = to;
      }
    }

    const { count, rows } = await Attendance.findAndCountAll({
      where,
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
          model: Device,
          as: 'device',
          attributes: ['id', 'name', 'ip']
        }
      ],
      order: [['recordTime', 'DESC']],
      limit,
      offset,
      distinct: true
    });

    const attendances = rows.map((attendance) => {
      const item = attendance.toJSON();

      return {
        ...item,
        recordTimeLocal: formatLocalTime(item.recordTime),
        timeZone: TIME_ZONE
      };
    });

    res.json({
      ok: true,
      data: attendances,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error al consultar checadas:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar las checadas'
    });
  }
};