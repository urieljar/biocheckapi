import sequelize from '../config/database.js';
import { Device } from '../models/index.js';
import { getSyncJobsStatus } from '../services/sync-status.service.js';
import { getDeviceMonitorStatus } from '../services/device-monitor.service.js';

const deviceHealth = async () => {
  const devices = await Device.findAll({
    where: { active: true },
    attributes: ['id', 'name', 'ip', 'port', 'lastConnectionAt'],
    order: [['name', 'ASC']]
  });
  const staleMinutes = Number(process.env.DEVICE_HEALTH_STALE_MINUTES || 15);
  const now = Date.now();
  return devices.map((device) => {
    const lastConnectionAt = device.lastConnectionAt;
    const stale = !lastConnectionAt || now - new Date(lastConnectionAt).getTime() > staleMinutes * 60 * 1000;
    return { id: device.id, name: device.name, ip: device.ip, port: device.port, lastConnectionAt, stale, monitor: getDeviceMonitorStatus(device.id) };
  });
};

export const health = async (req, res) => {
  const checks = { database: 'up' };
  let status = 'ok';
  try {
    await sequelize.authenticate();
  } catch (error) {
    checks.database = 'down';
    status = 'degraded';
  }
  const syncJobs = getSyncJobsStatus();
  res.status(status === 'ok' ? 200 : 503).json({
    ok: status === 'ok',
    status,
    service: 'biocheck-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
    syncJobs
  });
};

export const readiness = async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ ok: true, status: 'ready', checks: { database: 'up' }, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ ok: false, status: 'not_ready', checks: { database: 'down' }, timestamp: new Date().toISOString() });
  }
};

export const deviceHealthStatus = async (req, res) => {
  try {
    const devices = await deviceHealth();
    res.json({ ok: true, data: devices, staleAfterMinutes: Number(process.env.DEVICE_HEALTH_STALE_MINUTES || 15) });
  } catch (error) {
    res.status(503).json({ ok: false, message: 'No se pudo consultar el estado de los relojes' });
  }
};
