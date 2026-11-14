import { once } from 'node:events';
import { Attendance, Device, Department, Position } from '../models/index.js';
import sequelize from '../config/database.js';
import { buildEventQuery, eventReportRow, EVENT_TIME_ZONE, EVENT_CSV_HEADER, eventCsvLine, htmlCell } from '../services/event-report.service.js';

const reportError = (res, error) => {
  if (error.statusCode === 400) return res.status(400).json({ ok: false, message: error.message });
  console.error('Error en reporte de eventos:', error.message);
  return res.status(500).json({ ok: false, message: 'No fue posible consultar el reporte de eventos' });
};
export const getEvents = async (req, res) => {
  try {
    const { options, page, limit } = buildEventQuery(req.query);
    const { count, rows } = await Attendance.findAndCountAll({ ...options, limit, offset: (page - 1) * limit, distinct: true });
    return res.json({ ok: true, data: rows.map(eventReportRow), timeZone: EVENT_TIME_ZONE,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (error) { return reportError(res, error); }
};
export const getEventFilters = async (_req, res) => {
  try {
    const options = { attributes: ['id', 'name'], order: [['name', 'ASC']] };
    const [devices, departments, positions] = await Promise.all([Device.findAll(options), Department.findAll(options), Position.findAll(options)]);
    return res.json({ ok: true, data: { devices, departments, positions } });
  } catch (error) { return reportError(res, error); }
};
export const exportEvents = async (req, res) => {
  try {
    const { options } = buildEventQuery(req.query);
    await sequelize.transaction({ isolationLevel: 'REPEATABLE READ', readOnly: true }, async (transaction) => {
      const batchSize = 1000;
      let offset = 0;
      let rows = await Attendance.findAll({ ...options, limit: batchSize, offset, transaction });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="eventos.csv"');
      res.setHeader('Cache-Control', 'no-store');
      res.write('\uFEFF' + EVENT_CSV_HEADER);
      while (rows.length && !res.destroyed) {
        const chunk = rows.map((row) => eventCsvLine(eventReportRow(row))).join('');
        if (!res.write(chunk)) await once(res, 'drain', { signal: AbortSignal.timeout(30000) });
        if (rows.length < batchSize) break;
        offset += batchSize;
        rows = await Attendance.findAll({ ...options, limit: batchSize, offset, transaction });
      }
    });
    res.end();
  } catch (error) {
    if (res.headersSent) { res.destroy(error); return; }
    return reportError(res, error);
  }
};

export const exportEventsExcel = async (req, res) => {
  try {
    const { options } = buildEventQuery(req.query);
    const rows = await Attendance.findAll({ ...options, limit: 100000, offset: 0 });
    const body = rows.map((row) => { const item = eventReportRow(row); return `<tr>${[item.id, item.deviceUserId, item.employeeName, item.departmentName, item.positionName, item.localDate, item.localTime, item.eventLabel, item.device?.name || 'Sin información'].map((value) => `<td>${htmlCell(value)}</td>`).join('')}</tr>`; }).join('');
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="eventos.xls"');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(`\uFEFF<html><head><meta charset="utf-8"></head><body><table border="1"><thead><tr>${['Registro', 'ID empleado', 'Empleado', 'Departamento', 'Cargo', 'Fecha', 'Hora', 'Evento', 'Dispositivo'].map((value) => `<th>${htmlCell(value)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  } catch (error) { return reportError(res, error); }
};
