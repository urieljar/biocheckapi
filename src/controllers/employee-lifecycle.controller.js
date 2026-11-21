import { changeEmployment, archiveEmployee, restoreEmployee } from '../services/employee-lifecycle.service.js';
import { EmploymentPeriod } from '../models/index.js';
const handle = (operation) => async (req, res) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.id)) return res.status(400).json({ ok: false, message: 'Identificador de empleado inválido' });
  try { res.json({ ok: true, data: await operation(req) }); }
  catch (error) {
    console.error('Operación laboral:', error.message);
    res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible completar la operación laboral' });
  }
};
export const terminate = handle((req) => changeEmployment({ employeeId: req.params.id, action: 'terminate', body: req.body, actorId: req.user.id }));
export const rehire = handle((req) => changeEmployment({ employeeId: req.params.id, action: 'rehire', body: req.body, actorId: req.user.id }));
export const archive = handle((req) => archiveEmployee({ employeeId: req.params.id, actorId: req.user.id, confirmation: req.body?.confirmation, force: Boolean(req.body?.force) }));
export const restore = handle((req) => restoreEmployee(req.params.id));
export const employmentHistory = handle((req) => EmploymentPeriod.findAll({ where: { employeeId: req.params.id }, order: [['createdAt', 'ASC']] }));
