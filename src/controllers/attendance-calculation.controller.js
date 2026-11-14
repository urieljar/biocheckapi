import {
  calculateEmployeeAttendance,
  calculateBatchAttendance
} from '../services/attendance-calculation.service.js';

export const getEmployeeAttendanceCalculation = async (req, res) => {
  try {
    const from = req.query.from || req.query.date;
    const to = req.query.to || req.query.date || from;

    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({
        ok: false,
        message: 'Envía date o from/to con formato YYYY-MM-DD'
      });
    }

    if (from > to) {
      return res.status(400).json({
        ok: false,
        message: 'from no puede ser posterior a to'
      });
    }

    const days = (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000 + 1;
    if (days > 31) {
      return res.status(400).json({
        ok: false,
        message: 'El rango máximo es de 31 días'
      });
    }

    const data = await calculateEmployeeAttendance({
      employeeId: req.params.employeeId,
      from,
      to
    });

    res.json({ ok: true, data });
  } catch (error) {
    console.error('Error al calcular asistencia:', error.message);
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.statusCode ? error.message : 'No fue posible calcular la asistencia'
    });
  }
};

export const getBatchAttendanceCalculation = async (req, res) => {
  try {
    const from = req.query.from || req.query.date;
    const to = req.query.to || req.query.date || from;
    const departmentId = req.query.departmentId || null;

    if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({
        ok: false,
        message: 'Envía from y to con formato YYYY-MM-DD'
      });
    }

    if (from > to) {
      return res.status(400).json({
        ok: false,
        message: 'from no puede ser posterior a to'
      });
    }

    const days = (new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000 + 1;
    if (days > 31) {
      return res.status(400).json({
        ok: false,
        message: 'El rango máximo es de 31 días'
      });
    }

    const data = await calculateBatchAttendance({
      from,
      to,
      departmentId
    });

    res.json({ ok: true, data });
  } catch (error) {
    console.error('Error al calcular pre-nómina masiva:', error.message);
    res.status(error.statusCode || 500).json({
      ok: false,
      message: error.statusCode ? error.message : 'No fue posible calcular la pre-nómina'
    });
  }
};
