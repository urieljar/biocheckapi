import { Op } from 'sequelize';

import {
  Attendance,
  Employee,
  Device
} from '../models/index.js';
import { assertAttendancePeriodOpen } from '../services/payroll-closure.service.js';

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


export const createManualAttendance = async (req, res) => {
  try {
    const { employeeId, deviceUserId, date, time } = req.body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, message: 'La fecha debe tener formato YYYY-MM-DD' });
    }

    if (!time || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) {
      return res.status(400).json({ ok: false, message: 'La hora debe tener formato HH:mm o HH:mm:ss' });
    }

    let employee = null;
    if (employeeId) {
      employee = await Employee.findByPk(employeeId);
    } else if (deviceUserId) {
      employee = await Employee.findOne({ where: { deviceUserId: String(deviceUserId) } });
    }

    if (!employee) {
      return res.status(404).json({ ok: false, message: 'Empleado no encontrado' });
    }

    let deviceId = employee.deviceId;
    if (!deviceId) {
      const defaultDevice = await Device.findOne();
      if (!defaultDevice) {
        return res.status(400).json({ ok: false, message: 'No hay dispositivo reloj configurado' });
      }
      deviceId = defaultDevice.id;
    }

    const formattedTime = time.length === 5 ? `${time}:00` : time;
    // Hora local en zona America/Mazatlan (-07:00 todo el año)
    const recordTime = new Date(`${date}T${formattedTime}-07:00`);

    if (Number.isNaN(recordTime.getTime())) {
      return res.status(400).json({ ok: false, message: 'Fecha u hora no válida' });
    }

    await assertAttendancePeriodOpen({ employeeId: employee.id, date, transaction: undefined });

    const existing = await Attendance.findOne({
      where: {
        deviceId,
        deviceUserId: String(employee.deviceUserId),
        recordTime
      }
    });

    if (existing) {
      return res.status(409).json({
        ok: false,
        message: `Ya existe un registro de checada exactamente a las ${formattedTime} para este colaborador`
      });
    }

    const row = await Attendance.create({
      deviceId,
      employeeId: employee.id,
      deviceUserId: String(employee.deviceUserId),
      deviceUserSn: employee.deviceUserSn || null,
      recordTime,
      deviceIp: 'MANUAL',
      source: 'MANUAL'
    });

    res.status(201).json({
      ok: true,
      message: `Checada manual registrada exitosamente para ${employee.name} (${date} ${formattedTime})`,
      data: {
        id: row.id,
        employeeId: row.employeeId,
        deviceUserId: row.deviceUserId,
        recordTime: row.recordTime,
        recordTimeLocal: formatLocalTime(row.recordTime),
        source: row.source
      }
    });
  } catch (error) {
    console.error('Error al registrar checada manual:', error.message);
    res.status(500).json({
      ok: false,
      message: error.message || 'No fue posible registrar la checada manual'
    });
  }
};

export const deleteManualAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    const row = await Attendance.findByPk(id);

    if (!row) {
      return res.status(404).json({ ok: false, message: 'Registro de checada no encontrado' });
    }

    if (row.source !== 'MANUAL') {
      return res.status(403).json({
        ok: false,
        message: 'Solo se pueden eliminar checadas registradas manualmente. Las checadas biométricas del reloj checador están protegidas contra borrado.'
      });
    }

    await assertAttendancePeriodOpen({ employeeId: row.employeeId, date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mazatlan' }).format(new Date(row.recordTime)), transaction: undefined });

    await row.destroy();

    res.json({
      ok: true,
      message: 'Checada manual eliminada correctamente'
    });
  } catch (error) {
    console.error('Error al eliminar checada manual:', error.message);
    res.status(500).json({
      ok: false,
      message: error.message || 'No fue posible eliminar la checada manual'
    });
  }
};
