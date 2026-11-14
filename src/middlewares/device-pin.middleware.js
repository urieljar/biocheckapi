import { hasCapability } from '../security/roles.js';

export const redactCommandPin = (command) => command.replace(/(\bPasswd=)[^\t\r\n]*/gi, '$1[OCULTO]');

// El replacer también se aplica después de toJSON() de los modelos Sequelize.
// Se filtra la salida HTTP, sin quitar el PIN que necesitan los servicios del reloj.
export const protectDevicePin = (req, res, next) => {
  const originalJson = res.json;
  res.json = function (body) {
    if (req.user?.active && hasCapability(req.user.role, 'employee.pin.read')) {
      return originalJson.call(this, body);
    }
    const json = JSON.stringify(body, (key, value) => {
      if (key === 'devicePin' || key === 'device_pin') return undefined;
      if (key === 'command' && typeof value === 'string') return redactCommandPin(value);
      return value;
    });
    return originalJson.call(this, json === undefined ? undefined : JSON.parse(json));
  };
  next();
};
