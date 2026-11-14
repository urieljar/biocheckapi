import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeePresenceVerifier } from '../src/services/employee-presence.service.js';

const dependencies = {
  clockIp: () => '192.0.2.10',
  findDevice: async (ip) => { assert.equal(ip, '192.0.2.10'); return { id: 'device-1', name: 'Reloj principal' }; },
  findEmployees: async (deviceId) => {
    assert.equal(deviceId, 'device-1');
    return [
      { id: 'employee-1', deviceUserId: '100', name: 'Encontrado', active: true, devicePin: 'SECRET' },
      { id: 'employee-2', deviceUserId: '0100', name: 'Ausente', active: false, devicePin: 'SECRET' }
    ];
  },
  readUsers: async () => [{ userId: 100, password: 'SECRET' }, { userId: '200' }],
  now: () => new Date('2026-11-13T12:00:00Z')
};

test('compara por número del reloj sin confundir UID ni ceros iniciales ni exponer secretos', async () => {
  const result = await createEmployeePresenceVerifier(dependencies)();
  assert.equal(result.found, 1);
  assert.equal(result.missing, 1);
  assert.equal(result.total, 2);
  assert.equal(result.clockUsers, 2);
  assert.equal(result.checkedAt, '2026-11-13T12:00:00.000Z');
  assert.deepEqual(result.employees.map((employee) => employee.present), [true, false]);
  assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal('active' in result.employees[1], false);
});
test('un fallo de conexión no clasifica a los empleados como ausentes', async () => {
  const verify = createEmployeePresenceVerifier({ ...dependencies, readUsers: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(verify, /ECONNREFUSED/);
});
test('listas vacías, inválidas o con identificadores repetidos se rechazan', async () => {
  for (const users of [[], null, {}, [null], [{ uid: 100 }], [{ userId: '' }], [{ userId: {} }], [{ userId: NaN }], [{ userId: 100 }, { userId: '100' }]]) {
    await assert.rejects(createEmployeePresenceVerifier({ ...dependencies, readUsers: async () => users }), { statusCode: 502 });
  }
});
test('sin configuración o dispositivo registrado no consulta el reloj', async () => {
  const readUsers = async () => { assert.fail('No debe consultar el reloj'); };
  await assert.rejects(createEmployeePresenceVerifier({ ...dependencies, clockIp: () => '', readUsers }), { statusCode: 400 });
  await assert.rejects(createEmployeePresenceVerifier({ ...dependencies, findDevice: async () => null, readUsers }), { statusCode: 404 });
});
test('no asume que dos empleados con números parecidos sean la misma persona', async () => {
  const result = await createEmployeePresenceVerifier({ ...dependencies, readUsers: async () => [{ userId: '10' }] })();
  assert.equal(result.found, 0);
  assert.equal(result.missing, 2);
});
