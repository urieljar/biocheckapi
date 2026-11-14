import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

import app from '../src/app.js';
import sequelize from '../src/config/database.js';
import { Employee, User } from '../src/models/index.js';

// Verifica la matriz de capacidades sin base de datos ni reloj:
// el middleware responde antes de tocar persistencia, y las rutas
// permitidas se comprueban por "no bloqueada" (nunca 401/403).
const IDS = {
  ROOT: '11111111-1111-4111-8111-111111111111',
  ADMIN: '22222222-2222-4222-8222-222222222222',
  SUPERVISOR: '33333333-3333-4333-8333-333333333333',
  CONSULTA: '44444444-4444-4444-8444-444444444444'
};
const ALL_ROLES = ['ROOT', 'ADMIN', 'SUPERVISOR', 'CONSULTA'];
const secret = 'module-permissions-test-secret';
const originalSecret = process.env.JWT_SECRET;
const originalError = console.error;
const originals = {};
let server;
let baseUrl;

const replace = (object, key, implementation) => {
  originals[key] = { object, value: object[key] };
  object[key] = implementation;
};

const accounts = Object.fromEntries(ALL_ROLES.map((role) => [IDS[role], {
  id: IDS[role],
  name: role,
  email: `${role.toLowerCase()}@example.com`,
  role,
  active: true
}]));

const fakeEmployeeId = '55555555-5555-4555-8555-555555555555';
const fakeEmployee = {
  id: fakeEmployeeId,
  deviceId: '66666666-6666-4666-8666-666666666666',
  deviceUserId: '10',
  name: 'Empleado de prueba',
  active: true,
  deviceRole: 0,
  cardNumber: null,
  devicePin: '9876',
  async update(values) { Object.assign(this, values); return this; }
};

const call = async (method, path, body, role, extraHeaders = {}) => {
  const headers = { ...extraHeaders };
  if (role) headers.authorization = `Bearer ${jwt.sign({ sub: IDS[role] }, secret)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const blocked = (result) => [401, 403].includes(result.status);

// [capacidad, método, ruta, cuerpo, roles que pueden]
const MATRIX = [
  ['employee.write', 'POST', '/api/employees', {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.write', 'PATCH', `/api/employees/${fakeEmployeeId}/device-settings`, { name: 'Nuevo' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.write', 'PATCH', `/api/employees/${fakeEmployeeId}/profile`, {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.write', 'POST', `/api/employees/${fakeEmployeeId}/profile`, {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.write', 'POST', `/api/employees/${fakeEmployeeId}/queue-adms-sync`, {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.status', 'PATCH', `/api/employees/${fakeEmployeeId}/device-settings`, { active: false }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['attendance.sync', 'POST', '/api/devices/sync-attendances', undefined, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['attendance.write', 'POST', '/api/attendances/manual', { employeeId: fakeEmployeeId, punchTime: '2026-01-01 10:00:00' }, ['ROOT']],
  ['attendance.write', 'DELETE', `/api/attendances/manual/${fakeEmployeeId}`, undefined, ['ROOT']],
  ['schedule.write', 'POST', '/api/schedules', {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['schedule.write', 'PATCH', `/api/schedules/${fakeEmployeeId}`, {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['schedule.write', 'DELETE', `/api/schedules/${fakeEmployeeId}`, undefined, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['schedule.write', 'POST', `/api/schedules/${fakeEmployeeId}/assign`, { employeeIds: [fakeEmployeeId], validFrom: '2026-01-01' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['schedule.write', 'PATCH', `/api/employee-schedules/${fakeEmployeeId}`, { active: false }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['schedule.write', 'DELETE', `/api/employee-schedules/${fakeEmployeeId}`, undefined, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['catalog.write', 'POST', '/api/catalogs/departments', { code: 'X', name: 'X' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['catalog.write', 'PATCH', `/api/catalogs/departments/${fakeEmployeeId}`, { name: 'X' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['catalog.write', 'DELETE', `/api/catalogs/departments/${fakeEmployeeId}`, undefined, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['exception.write', 'POST', '/api/calendar-exceptions', { name: 'X', date: '2026-01-01', type: 'HOLIDAY' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['exception.write', 'PATCH', `/api/calendar-exceptions/${fakeEmployeeId}`, { name: 'X' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['exception.write', 'DELETE', `/api/calendar-exceptions/${fakeEmployeeId}`, undefined, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['user.manage', 'GET', '/api/users', undefined, ['ROOT', 'ADMIN']],
  ['device.import', 'POST', '/api/devices/sync-users', undefined, ['ROOT', 'ADMIN']],
  ['employee.write', 'POST', '/api/devices/verify-employees', {}, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.status', 'POST', `/api/employees/${fakeEmployeeId}/termination`, { date: '2026-01-01', reason: 'Renuncia voluntaria' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.status', 'POST', `/api/employees/${fakeEmployeeId}/rehire`, { date: '2026-02-01' }, ['ROOT', 'ADMIN', 'SUPERVISOR']],
  ['employee.delete', 'DELETE', `/api/employees/${fakeEmployeeId}`, { confirmation: '10' }, ['ROOT', 'ADMIN']],
  ['employee.delete', 'POST', `/api/employees/${fakeEmployeeId}/restore`, {}, ['ROOT', 'ADMIN']],
  ['system.rootControl', 'GET', '/api/root/permissions', undefined, ['ROOT']],
  ['system.rootControl', 'GET', '/api/root/settings', undefined, ['ROOT']]
];

before(async () => {
  process.env.JWT_SECRET = secret;
  console.error = () => {};
  // Sin PostgreSQL: toda consulta falla de inmediato en vez de esperar el pool.
  replace(sequelize, 'query', async () => {
    throw new Error('Sin base de datos en las pruebas de permisos');
  });
  replace(sequelize, 'transaction', async (callback) => callback({
    LOCK: { UPDATE: 'UPDATE' },
    commit: async () => {},
    rollback: async () => {}
  }));
  replace(User, 'findByPk', async (id) => accounts[id] || null);
  replace(Employee, 'findByPk', async () => ({ ...fakeEmployee }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  console.error = originalError;
  for (const [key, { object, value }] of Object.entries(originals)) object[key] = value;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  await new Promise((resolve) => server.close(resolve));
});

test('solo ROOT y ADMIN reciben el PIN en consultas y ediciones de empleado', async () => {
  for (const role of ALL_ROLES) {
    const result = await call('GET', `/api/employees/${fakeEmployeeId}`, undefined, role);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.devicePin, ['ROOT', 'ADMIN'].includes(role) ? '9876' : undefined);
    if (role !== 'CONSULTA') {
      const updated = await call('PATCH', `/api/employees/${fakeEmployeeId}/device-settings`, { name: 'Nuevo' }, role);
      assert.equal(updated.status, 200);
      assert.equal(updated.body.data.devicePin, ['ROOT', 'ADMIN'].includes(role) ? '9876' : undefined);
    }
  }
});

test('CONSULTA solo puede leer: toda escritura devuelve 403', async () => {
  for (const [, method, path, body] of MATRIX) {
    const result = await call(method, path, body, 'CONSULTA');
    assert.equal(result.status, 403, `CONSULTA ${method} ${path} debería ser 403 y fue ${result.status}`);
    assert.equal(result.body.ok, false);
  }
});

test('SUPERVISOR opera pero no gestiona cuentas ni importa del reloj', async () => {
  for (const [capability, method, path, body, allowedRoles] of MATRIX) {
    const result = await call(method, path, body, 'SUPERVISOR');
    if (allowedRoles.includes('SUPERVISOR')) {
      assert.ok(!blocked(result), `SUPERVISOR ${method} ${path} (${capability}) no debería bloquearse (${result.status})`);
    } else {
      assert.equal(result.status, 403, `SUPERVISOR ${method} ${path} (${capability}) debería ser 403 y fue ${result.status}`);
    }
  }
});

test('ADMIN configura todo salvo las cuentas privilegiadas y el reloj', async () => {
  for (const [capability, method, path, body, allowedRoles] of MATRIX) {
    // sync-users abre un socket al checador cuando está permitido; se evita en pruebas.
    if (path === '/api/devices/sync-users' && allowedRoles.includes('ADMIN')) continue;
    const result = await call(method, path, body, 'ADMIN');
    if (allowedRoles.includes('ADMIN')) {
      assert.ok(!blocked(result), `ADMIN ${method} ${path} (${capability}) no debería bloquearse (${result.status})`);
    } else {
      assert.equal(result.status, 403, `ADMIN ${method} ${path} (${capability}) debería ser 403 y fue ${result.status}`);
    }
  }
});

test('ROOT no queda bloqueado por la matriz', async () => {
  for (const [, method, path, body, allowedRoles] of MATRIX) {
    if (!allowedRoles.includes('ROOT')) continue;
    // sync-users abre un socket al checador; se cubre en la prueba de usuarios.
    if (path === '/api/devices/sync-users') continue;
    const result = await call(method, path, body, 'ROOT');
    assert.ok(!blocked(result), `ROOT ${method} ${path} no debería bloquearse (${result.status})`);
  }
});

test('las consultas siguen abiertas a los cuatro roles', async () => {
  const reads = [
    '/api/employees',
    '/api/attendances',
    '/api/schedules',
    `/api/schedules/${fakeEmployeeId}`,
    '/api/employee-schedules',
    '/api/catalogs/departments',
    '/api/calendar-exceptions',
    `/api/attendance-calculations/employees/${fakeEmployeeId}?date=2026-01-01`,
    `/api/employees/${fakeEmployeeId}`
  ];

  for (const role of ALL_ROLES) {
    for (const path of reads) {
      const result = await call('GET', path, undefined, role);
      assert.ok(!blocked(result), `${role} GET ${path} debería estar permitido y devolvió ${result.status}`);
    }
  }
});

test('anónimo recibe 401 en cualquier módulo', async () => {
  for (const path of ['/api/employees', '/api/schedules', '/api/catalogs/departments', '/api/calendar-exceptions', '/api/users']) {
    assert.equal((await call('GET', path, undefined, null)).status, 401);
  }
  assert.equal((await call('POST', '/api/schedules', {}, null)).status, 401);
});
