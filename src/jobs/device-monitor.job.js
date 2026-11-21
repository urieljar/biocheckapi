import { Device } from '../models/index.js';
import { testZktecoConnection } from '../services/zkteco.service.js';
import { logger } from '../services/logger.service.js';
import { getDeviceMonitorStatus, setDeviceMonitorStatus } from '../services/device-monitor.service.js';
import { Op } from 'sequelize';

let timer = null;
let running = false;

const markStaleAdmsDevices = async () => {
  const timeoutMs = Math.max(60000, Number(process.env.ADMS_HEARTBEAT_TIMEOUT_MS || 180000));
  const cutoff = new Date(Date.now() - timeoutMs);
  await Device.update(
    { admsStatus: 'OFFLINE', admsLastError: 'Sin consultas ADMS recientes' },
    { where: { admsStatus: 'ONLINE', lastAdmsAt: { [Op.lt]: cutoff } } }
  );
};

export const monitorDeviceOnce = async () => {
  if (running) return;
  running = true;
  const started = Date.now();
  const ip = process.env.ZK_IP;
  try {
    await markStaleAdmsDevices();
    if (!ip) throw new Error('ZK_IP no está configurada');
    const result = await testZktecoConnection();
    const device = await Device.findOne({ where: { ip } });
    const now = new Date();
    if (device) await device.update({ active: true, lastConnectionAt: now });
    const value = { status: 'UP', checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), latencyMs: Date.now() - started, deviceTime: result.deviceTime || null, error: null };
    if (device) setDeviceMonitorStatus(device.id, value);
    logger.info('device_monitor_up', { ip, latencyMs: value.latencyMs });
    return value;
  } catch (error) {
    const device = ip ? await Device.findOne({ where: { ip } }).catch(() => null) : null;
    const previous = device ? getDeviceMonitorStatus(device.id) : null;
    const value = { status: 'DOWN', checkedAt: new Date().toISOString(), lastSuccessAt: previous?.lastSuccessAt || null, latencyMs: Date.now() - started, deviceTime: null, error: error.message };
    if (device) setDeviceMonitorStatus(device.id, value);
    logger.warn('device_monitor_down', { ip: ip || null, error: error.message, latencyMs: value.latencyMs });
    return value;
  } finally {
    running = false;
  }
};

export const startDeviceMonitor = () => {
  if (timer || (process.env.DEVICE_MONITOR_ENABLED !== 'true' && !process.env.ZK_IP)) return;
  const interval = Math.max(15000, Number(process.env.DEVICE_MONITOR_INTERVAL_MS || 60000));
  monitorDeviceOnce().catch(() => {});
  timer = setInterval(() => monitorDeviceOnce().catch(() => {}), interval);
  timer.unref?.();
  logger.info('device_monitor_started', { intervalMs: interval });
};

export const stopDeviceMonitor = () => {
  if (timer) clearInterval(timer);
  timer = null;
};
