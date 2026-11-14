import { closePayrollPeriod, listPayrollClosures, reopenPayrollPeriod } from '../services/payroll-closure.service.js';

export const getPayrollClosures = async (_req, res) => res.json({ ok: true, data: await listPayrollClosures() });
export const closePayroll = async (req, res) => {
  try { return res.status(201).json({ ok: true, message: 'Periodo de pre-nómina cerrado', data: await closePayrollPeriod({ ...req.body, actorId: req.user.id }) }); }
  catch (error) { return res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible cerrar la pre-nómina' }); }
};
export const reopenPayroll = async (req, res) => {
  try { return res.json({ ok: true, message: 'Periodo de pre-nómina reabierto', data: await reopenPayrollPeriod({ id: req.params.id, reason: req.body?.reason, actorId: req.user.id }) }); }
  catch (error) { return res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible reabrir la pre-nómina' }); }
};
