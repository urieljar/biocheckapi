import { Device, Employee } from '../models/index.js';
import { getZktecoUsers } from './zkteco.service.js';

// Compara una lectura del reloj con la base local sin reconciliar ni escribir datos.
export const createEmployeePresenceVerifier = ({
  readUsers = getZktecoUsers,
  findDevice = (ip) => Device.findOne({ where: { ip } }),
  findEmployees = (deviceId) => Employee.findAll({
    where: { deviceId }, attributes: ['id', 'deviceUserId', 'name'], order: [['name', 'ASC']]
  }),
  clockIp = () => process.env.ZK_IP,
  now = () => new Date()
} = {}) => async () => {
  const ip = clockIp();
  if (!ip) throw Object.assign(new Error('No hay un reloj configurado para verificar'), { statusCode: 400 });
  const device = await findDevice(ip);
  if (!device) throw Object.assign(new Error('El reloj configurado no está registrado'), { statusCode: 404 });
  const employees = await findEmployees(device.id);
  const users = await readUsers();
  // Una respuesta vacía o mal formada no demuestra la ausencia de toda la plantilla.
  if (!Array.isArray(users) || users.length === 0) {
    throw Object.assign(new Error('El reloj no devolvió usuarios. No se pudo verificar la presencia de empleados.'), { statusCode: 502 });
  }
  const ids = new Set();
  for (const user of users) {
    const raw = user?.userId;
    if (!['string', 'number'].includes(typeof raw) || (typeof raw === 'number' && !Number.isFinite(raw)) || !String(raw).trim()) {
      throw Object.assign(new Error('La lista de usuarios recibida del reloj es inválida. No se verificaron empleados.'), { statusCode: 502 });
    }
    const id = String(raw).trim();
    if (ids.has(id)) throw Object.assign(new Error('El reloj devolvió identificadores repetidos. No se verificaron empleados.'), { statusCode: 502 });
    ids.add(id);
  }
  const checkedAt = now().toISOString();
  const result = employees.map((employee) => ({
    id: employee.id, deviceUserId: employee.deviceUserId, name: employee.name,
    present: ids.has(String(employee.deviceUserId).trim())
  }));
  const found = result.filter((employee) => employee.present).length;
  return {
    device: { id: device.id, name: device.name }, checkedAt, clockUsers: ids.size,
    total: result.length, found, missing: result.length - found, employees: result
  };
};

export const verifyEmployeePresence = createEmployeePresenceVerifier();
