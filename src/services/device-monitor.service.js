const status = new Map();

export const setDeviceMonitorStatus = (deviceId, value) => {
  status.set(String(deviceId), { ...value });
};

export const getDeviceMonitorStatus = (deviceId) => status.get(String(deviceId)) || null;

export const getAllDeviceMonitorStatus = () => Object.fromEntries([...status.entries()]);
