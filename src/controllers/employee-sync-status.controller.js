import { Employee, Device } from '../models/index.js';

const payload = (employee) => ({
  employeeId: employee.id,
  employeeNumber: employee.deviceUserId,
  name: employee.name,
  active: employee.active,
  status: employee.deviceSyncStatus,
  error: employee.deviceSyncError || null,
  syncedAt: employee.deviceSyncedAt || null,
  device: employee.device ? {
    id: employee.device.id,
    name: employee.device.name,
    ip: employee.device.ip,
    port: employee.device.port,
    lastConnectionAt: employee.device.lastConnectionAt
  } : null
});

export const getEmployeeSyncStatus = async (req, res) => {
  const employee = await Employee.findByPk(req.params.id, {
    attributes: ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncError', 'deviceSyncedAt'],
    include: [{ model: Device, as: 'device', attributes: ['id', 'name', 'ip', 'port', 'lastConnectionAt'], required: false }]
  });
  if (!employee) return res.status(404).json({ ok: false, message: 'Empleado no encontrado' });
  return res.json({ ok: true, data: payload(employee) });
};
