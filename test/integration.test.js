import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createIntegrationApp } from '../src/integration/app.js';
import { Employee, EmployeeSchedule, Attendance, CalendarException } from '../src/models/index.js';

const key = 'test-integration-only-key';
const keyHash = createHash('sha256').update(key).digest('hex');
const id = '11111111-1111-4111-8111-111111111111';
let server, url;
const originals = [];
const replace = (object, field, value) => { originals.push([object, field, object[field]]); object[field] = value; };
const request = (path, options = {}) => fetch(`${url}${path}`, { ...options, headers: { Authorization: `Bearer ${key}`, ...options.headers } });
const base = '/api/integrations/v1';
before(async () => {
  replace(Employee, 'findAndCountAll', async (options) => {
    assert.deepEqual(options.attributes, ['id', 'deviceUserId', 'name', 'active', 'deviceSyncStatus', 'deviceSyncedAt']);
    return { count: 1, rows: [{ id, deviceUserId: '108070017', name: 'ABRIL', active: true, devicePin: 'SECRET', profile: { lastName: 'PÉREZ', department: { id: 'dep-1', name: 'Operación' }, position: { id: 'pos-1', name: 'Anfitrión' } } }] };
  });
  replace(Employee, 'findByPk', async (employeeId) => employeeId === id ? { id, deviceUserId: '108070017', name: 'ABRIL' } : null);
  replace(EmployeeSchedule, 'findAll', async () => []);
  replace(Attendance, 'findAll', async () => []);
  replace(CalendarException, 'findAll', async () => [{ date: '2026-10-01', scope: 'GLOBAL', type: 'HOLIDAY', isWorkDay: false, notes: 'PRIVATE' }]);
  server = createIntegrationApp({ keyHash }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const [object, field, value] of originals) object[field] = value;
  await new Promise((resolve) => server.close(resolve));
});
test('falla cerrado sin configuración', () => assert.throws(() => createIntegrationApp({ keyHash: '' })));
test('rechaza credencial ausente, incorrecta y JWT interno', async () => {
  for (const authorization of ['', 'Bearer invalid', 'Bearer eyJhbGciOiJIUzI1NiJ9.invalid.signature']) {
    assert.equal((await request(`${base}/employees`, { headers: { Authorization: authorization } })).status, 401);
  }
});
test('catálogo mínimo sin PIN', async () => {
  const response = await request(`${base}/employees`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const employee = (await response.json()).data[0];
  assert.equal(employee.employeeNumber, '108070017');
  assert.equal(employee.lastName, 'PÉREZ');
  assert.equal(employee.department.name, 'Operación');
  assert.equal(employee.position.name, 'Anfitrión');
  assert.equal('devicePin' in employee, false);
});
test('expediente externo devuelve datos laborales autorizados y excluye secretos', async () => {
  replace(Employee, 'findByPk', async (employeeId) => employeeId === id ? {
    id, deviceUserId: '108070017', name: 'ABRIL', active: true, deviceSyncStatus: 'SYNCED',
    profile: { firstName: 'ABRIL', lastName: 'PÉREZ', employeeNumber: 'EMP-17', employmentType: 'PLANTA', hireDate: '2026-10-01', employmentStatus: 'ACTIVE', phone: '555', email: 'abril@example.com', devicePin: 'SECRET', socialSecurityNumber: 'NSS' }
  } : null);
  const response = await request(`${base}/employees/${id}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.employeeNumber, 'EMP-17');
  assert.equal(body.data.contact.email, 'abril@example.com');
  assert.equal('devicePin' in body.data, false);
  assert.equal(JSON.stringify(body).includes('SECRET'), false);
  assert.equal(JSON.stringify(body).includes('NSS'), false);
});
test('usa el cálculo existente y excluye notas privadas de incidencias', async () => {
  const response = await request(`${base}/attendance-calculations/employees/${id}?from=2026-10-01&to=2026-10-02`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.days.length, 2);
  assert.equal(body.data.days[0].status, 'EXCUSED');
  assert.equal(body.data.summary.rest, 1);
  assert.equal(JSON.stringify(body).includes('PRIVATE'), false);
  assert.equal('exception' in body.data.days[0], false);
});
test('consulta checadas recientes con cursor y no expone datos sensibles', async () => {
  replace(Attendance, 'findAll', async () => [{ id: 12, deviceId: 'device', deviceUserId: '108070017', recordTime: '2026-10-15T15:00:00.000Z', deviceIp: '192.168.1.201', source: 'DEVICE', employee: { id, deviceUserId: '108070017', name: 'ABRIL', profile: { firstName: 'ABRIL', lastName: 'PÉREZ', socialSecurityNumber: 'NSS' } }, device: { id: 'device', name: 'MB160', ip: '192.168.1.201' } }]);
  const response = await request(`${base}/attendance-events?sinceId=10&limit=20`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data[0].id, '12');
  assert.equal(body.data[0].employee.name, 'ABRIL PÉREZ');
  assert.equal(body.data[0].employee.firstName, 'ABRIL');
  assert.equal(body.data[0].employee.lastName, 'PÉREZ');
  assert.equal('source' in body.data[0], false);
  assert.equal('verificationMethod' in body.data[0], false);
  assert.equal(body.cursor.sinceId, '12');
  assert.equal(JSON.stringify(body).includes('NSS'), false);
});
test('valida UUID, fechas reales, tipos, rango y paginación', async () => {
  const route = `${base}/attendance-calculations/employees/${id}`;
  for (const path of [
    `${base}/employees?limit=101`, `${base}/employees?page=1.5`,
    `${base}/attendance-calculations/employees/invalid?date=2026-10-01`,
    `${route}?date=2026-02-30`, `${route}?from=2026-10-02&to=2026-10-01`,
    `${route}?from=2026-10-01&to=2026-11-01`, `${route}?date=x&date=y`, route
  ]) assert.equal((await request(path)).status, 400, path);
  assert.equal((await request(`${route}?from=2026-10-01&to=2026-10-31`)).status, 200);
});
test('empleado inexistente devuelve 404', async () => {
  assert.equal((await request(`${base}/attendance-calculations/employees/22222222-2222-4222-8222-222222222222?date=2026-10-01`)).status, 404);
});
test('no publica administración, reportes ajenos al piloto ni métodos de escritura', async () => {
  for (const path of ['/api/users', '/api/devices', '/api/employees', '/iclock/getrequest', `${base}/reports/events`]) {
    assert.equal((await request(path)).status, 404);
  }
  assert.equal((await request(`${base}/employees`, { method: 'POST' })).status, 404);
});
test('limita consultas del consumidor', async () => {
  let response;
  for (let n = 0; n < 61; n++) response = await request(`${base}/employees`);
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('retry-after')) > 0);
});
