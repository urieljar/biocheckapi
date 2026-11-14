import { getOrphanAttendanceReport, assignOrphanAttendance } from '../services/report.service.js';

export const getOrphanAttendances = async (req, res) => {
  try { return res.json({ ok: true, ...(await getOrphanAttendanceReport({ query: req.query })) }); }
  catch (error) { return res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible consultar las checadas huérfanas' }); }
};

export const reviewOrphanAttendance = async (req, res) => {
  try { return res.json({ ok: true, message: 'Checada asociada manualmente y marcada como revisada', data: await assignOrphanAttendance({ attendanceId: req.params.id, ...req.body, actorId: req.user.id }) }); }
  catch (error) { return res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible revisar la checada huérfana' }); }
};
