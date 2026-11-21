import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import sequelize from '../src/config/database.js';
import { Device, Employee, EmployeeProfile } from '../src/models/index.js';
import { createEmployeeSynchronizer, reconcileClockEmployee } from '../src/services/employee-sync.service.js';

let records, terminated, locks;
const originals = [];
const replace = (object, key, value) => { originals.push([object, key, object[key]]); object[key] = value; };
const device = { id: 'clock', name: 'Reloj', ip: '192.0.2.1', async update() {} };
const makeEmployee = (deviceUserId, status = 'SYNCED', extra = {}) => ({
  id: deviceUserId, deviceId: device.id, deviceUserId, name: 'Nombre local', deviceSyncStatus: status,
  deviceSyncError: status === 'ERROR' ? 'Sin conexión' : null, deviceSyncedAt: null,
  active: true, devicePin: '9876', cardNumber: '88', deviceRole: 14, ...extra,
  async update(values, options) { assert.ok(options?.transaction); Object.assign(this, values); return this; }
});
const reset = () => { records = []; terminated = new Set(); locks = []; };
const clockUser = (userId) => ({ userId, name: 'Nombre anterior del reloj', uid: 1, role: 0, password: '1234', cardno: '11' });
const readSnapshot = (ids) => createEmployeeSynchronizer({ readUsers: async () => ids.map(clockUser) })();
before(() => {
  replace(sequelize, 'transaction', async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } }));
  replace(Device, 'findOrCreate', async () => [device]);
  replace(Employee, 'findOne', async (options) => {
    assert.equal(options.lock, 'UPDATE'); locks.push(options.where.deviceUserId);
    return records.find((item) => item.deviceId === options.where.deviceId && item.deviceUserId === options.where.deviceUserId) || null;
  });
  replace(EmployeeProfile, 'findOne', async ({ where }) => terminated.has(where.employeeId) ? { employmentStatus: 'TERMINATED' } : null);
  replace(Employee, 'create', async (values, options) => { assert.ok(options.transaction); const record = makeEmployee(values.deviceUserId, values.deviceSyncStatus, values); records.push(record); return record; });
  replace(Employee, 'count', async ({ where }) => records.filter((item) => !item.deletedAt && item.deviceId === where.deviceId && where.deviceSyncStatus[Op.in].includes(item.deviceSyncStatus)).length);
  replace(Employee, 'update', async (values, { where }) => {
    assert.equal(where.deviceSyncStatus, 'SYNCED', 'La exclusión debe estar en el UPDATE, no solo en un filtro en memoria');
    const matches = records.filter((item) => !item.deletedAt && item.deviceId === where.deviceId && item.active === where.active && item.deviceSyncStatus === where.deviceSyncStatus && !where.deviceUserId[Op.notIn].includes(item.deviceUserId));
    matches.forEach((item) => Object.assign(item, values)); return [matches.length];
  });
});
after(() => { for (const [object, key, value] of originals) object[key] = value; });

test('no sobrescribe nombres, PIN, tarjeta, rol ni estado PENDING/ERROR que sí aparecen en el reloj', async () => {
  reset();
  for (const status of ['PENDING', 'ERROR']) {
    const employee = makeEmployee(status, status); records.push(employee);
    const before = JSON.stringify(employee);
    assert.equal(await reconcileClockEmployee(device, clockUser(status)), 'skippedUnsynced');
    assert.equal(JSON.stringify(employee), before);
  }
  assert.deepEqual(locks, ['PENDING', 'ERROR']);
});

test('altas pendientes y errores ausentes del reloj no se desactivan; SYNCED ausente sí', async () => {
  reset();
  records = [makeEmployee('pending', 'PENDING'), makeEmployee('error', 'ERROR'), makeEmployee('confirmed'), makeEmployee('other', 'SYNCED', { deviceId: 'otro-reloj' })];
  const result = await readSnapshot(['new']);
  assert.equal(records[0].active, true); assert.equal(records[1].active, true);
  assert.equal(records[2].active, false); assert.equal(records[3].active, true);
  assert.equal(result.deactivated, 1); assert.equal(result.created, 1); assert.equal(result.preservedLocal, 2);
});

test('respuesta distingue registros importados, archivados y conservados', async () => {
  reset();
  records = [makeEmployee('pending', 'PENDING'), makeEmployee('error', 'ERROR'), makeEmployee('confirmed'), makeEmployee('archived', 'PENDING', { deletedAt: new Date() })];
  const result = await readSnapshot(['pending', 'error', 'confirmed', 'archived', 'new']);
  assert.equal(result.skippedUnsynced, 2); assert.equal(result.skippedDeleted, 1);
  assert.equal(result.updated, 1); assert.equal(result.created, 1); assert.equal(result.preservedLocal, 2);
  assert.equal(records[2].name, 'Nombre anterior del reloj'); assert.equal(records[2].devicePin, '1234');
  assert.ok(records[3].deletedAt);
});

test('un empleado dado de baja no se reactiva al importar', async () => {
  reset(); const employee = makeEmployee('terminated', 'SYNCED', { active: false }); records.push(employee); terminated.add(employee.id);
  await readSnapshot(['terminated']); assert.equal(employee.active, false);
});

test('una lectura vacía se rechaza sin desactivar ni modificar empleados', async () => {
  reset(); records = [makeEmployee('pending', 'PENDING'), makeEmployee('confirmed')];
  const before = JSON.stringify(records);
  await assert.rejects(readSnapshot([]), /no devolvió usuarios/);
  assert.equal(JSON.stringify(records), before);
});

test('después de resolver el envío y pasar a SYNCED, vuelve a admitir importación', async () => {
  reset(); const employee = makeEmployee('pending', 'PENDING'); records.push(employee);
  await readSnapshot(['pending']); assert.equal(employee.name, 'Nombre local');
  employee.deviceSyncStatus = 'SYNCED';
  const result = await readSnapshot(['pending']);
  assert.equal(employee.name, 'Nombre anterior del reloj'); assert.equal(result.updated, 1); assert.equal(result.preservedLocal, 0);
});
