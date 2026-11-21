import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sequelize from '../src/config/database.js';
import { Employee, EmployeeProfile, Device, DeviceCommand } from '../src/models/index.js';
import { saveProfileWithClockName, sendProfileClockName, validateProfileClockName } from '../src/services/profile-name-sync.service.js';

const originals = [];
const replace = (object, key, value) => { originals.push([object, key, object[key]]); object[key] = value; };
let employee;
let profile;
let commands;
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const reset = () => {
  commands = [];
  employee = { id: 'employee', deviceId: 'device', name: 'Abril', deviceUserId: '108070017', active: true,
    async update(values, options) { if (options) assert.equal(options.transaction, transaction); Object.assign(this, values); return this; } };
  profile = { firstName: 'Abril', lastName: 'Cuadras', employmentStatus: 'ACTIVE',
    async update(values, options) { assert.equal(options.transaction, transaction); Object.assign(this, values); return this; } };
};
before(() => {
  replace(sequelize, 'transaction', async (callback) => callback(transaction));
  replace(sequelize, 'query', async () => []);
  replace(Employee, 'findByPk', async (_id, options) => { assert.equal(options.transaction, transaction); assert.equal(options.lock, 'UPDATE'); return employee; });
  replace(EmployeeProfile, 'create', async (values, options) => { assert.equal(options.transaction, transaction); Object.assign(profile, values); return profile; });
  replace(Device, 'findByPk', async () => ({ id: 'device', serialNumber: 'TEST-SERIAL' }));
  replace(DeviceCommand, 'findOne', async () => null);
  replace(DeviceCommand, 'create', async (values) => { commands.push(values); return { ...values, commandId: 1 }; });
});
after(() => { for (const [object, key, value] of originals) object[key] = value; });

test('Nombre(s) no admite vacío; cambiar solo apellidos sigue permitido', () => {
  for (const firstName of [null, '', '   ', 123]) assert.ok(validateProfileClockName({ firstName }));
  assert.equal(validateProfileClockName({ firstName: 'Abril' }), null);
  assert.equal(validateProfileClockName({ lastName: 'Cuadras' }), null);
});
test('cambiar Nombre(s) guarda perfil y empleado en la misma transacción y encola ADMS', async () => {
  reset();
  const saved = await saveProfileWithClockName({ employeeId: employee.id, profile, values: { firstName: 'Abril María' } });
  assert.equal(employee.name, 'Abril María');
  assert.equal(profile.firstName, 'Abril María');
  assert.equal(employee.deviceSyncStatus, 'PENDING');
  const result = await sendProfileClockName({ ...saved, syncDirect: () => assert.fail('ID largo no debe usar TCP') });
  assert.equal(result.status, 'PENDING');
  assert.equal(result.transport, 'ADMS');
  assert.match(commands[0].command, /Name=Abril María/);
  assert.equal(employee.deviceSyncStatus, 'PENDING', 'Encolar no confirma el cambio físico');
});
test('crear expediente también alinea el nombre local', async () => {
  reset();
  const saved = await saveProfileWithClockName({ employeeId: employee.id, values: { firstName: 'Nuevo', lastName: 'Apellido' } });
  assert.equal(saved.nameChanged, true);
  assert.equal(employee.name, 'Nuevo');
  assert.equal(profile.lastName, 'Apellido');
});
test('cambiar apellidos o conservar Nombre(s) no solicita sincronización', async () => {
  for (const values of [{ lastName: 'Nuevo apellido' }, { firstName: 'Abril' }]) {
    reset();
    const saved = await saveProfileWithClockName({ employeeId: employee.id, profile, values });
    assert.equal(saved.nameChanged, false);
    assert.equal(await sendProfileClockName({ ...saved, syncDirect: () => assert.fail() }), null);
    assert.equal(employee.name, 'Abril');
  }
});
test('ID corto usa el envío directo y reporta su confirmación', async () => {
  reset(); employee.deviceUserId = '17';
  const saved = await saveProfileWithClockName({ employeeId: employee.id, profile, values: { firstName: 'Cambio' } });
  let calls = 0;
  const result = await sendProfileClockName({ ...saved, syncDirect: async (target) => { calls++; assert.equal(target.name, 'Cambio'); return { ok: true }; } });
  assert.equal(calls, 1); assert.equal(result.status, 'SYNCED'); assert.equal(commands.length, 0);
});
test('un fallo al enviar conserva ambos nombres y marca ERROR para reintentar', async () => {
  reset(); employee.deviceUserId = '17';
  const saved = await saveProfileWithClockName({ employeeId: employee.id, profile, values: { firstName: 'Guardado' } });
  const result = await sendProfileClockName({ ...saved, syncDirect: async () => { throw new Error('Reloj desconectado'); } });
  assert.equal(result.status, 'ERROR'); assert.equal(employee.deviceSyncStatus, 'ERROR');
  assert.equal(employee.name, 'Guardado'); assert.equal(profile.firstName, 'Guardado');
});
test('empleados dados de baja o inactivos no se envían al reloj', async () => {
  for (const terminated of [true, false]) {
    reset(); if (terminated) profile.employmentStatus = 'TERMINATED'; else employee.active = false;
    const result = await sendProfileClockName({ employee, profile, nameChanged: true, syncDirect: () => assert.fail() });
    assert.equal(result.status, 'SKIPPED'); assert.equal(commands.length, 0);
  }
});
