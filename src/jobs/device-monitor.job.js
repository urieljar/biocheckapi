import { Device } from '../models/index.js';
import { testZktecoConnection } from '../services/zkteco.service.js';
import { logger } from '../services/logger.service.js';
import { getDeviceMonitorStatus, setDeviceMonitorStatus } from '../services/device-monitor.service.js';

let timer = null;
let running = false;

export const monitorDeviceOnce = async () => {
  if (running) return;
  running = true;
  const started = Date.now();
  const ip = process.env.ZK_IP;
  try {
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
