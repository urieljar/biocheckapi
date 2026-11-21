import { Employee, Device, DeviceCommand } from '../models/index.js';

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
    lastConnectionAt: employee.device.lastConnectionAt,
    admsStatus: employee.device.admsStatus,
    lastAdmsAt: employee.device.lastAdmsAt,
    admsLastError: employee.device.admsLastError
  } : null
});

export const getEmployeeSyncStatus = async (req, res) => {
  const employee = await Employee.findByPk(req.params.id, {
    attributes: ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncError', 'deviceSyncedAt'],
    include: [{ model: Device, as: 'device', attributes: ['id', 'name', 'ip', 'port', 'lastConnectionAt', 'admsStatus', 'lastAdmsAt', 'admsLastError'], required: false }]
  });
  if (!employee) return res.status(404).json({ ok: false, message: 'Empleado no encontrado' });
  const command = await DeviceCommand.findOne({
    where: { employeeId: employee.id },
    order: [['createdAt', 'DESC']],
    attributes: ['commandId', 'serialNumber', 'status', 'attemptCount', 'maxAttempts', 'nextAttemptAt', 'lastAttemptAt', 'sentAt', 'returnedAt', 'returnCode', 'responseBody', 'lastError', 'createdAt']
  });
  const data = payload(employee);
  data.command = command;
  return res.json({ ok: true, data });
};
