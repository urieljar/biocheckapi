import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import app from '../src/app.js';
import sequelize from '../src/config/database.js';
import { Attendance, User, Device, Department, Position } from '../src/models/index.js';
import { buildEventQuery, eventReportRow, csvCell } from '../src/services/event-report.service.js';

const uuid = '11111111-1111-4111-8111-111111111111';
const row = (id) => ({ id, deviceUserId: '108070031', recordTime: '2026-10-29T16:05:06Z', source: 'DEVICE',
  employee: { name: 'Nombre del reloj', profile: { firstName: 'Ricardo', lastName: 'Prueba', department: { name: 'Sistemas' }, position: { name: 'Técnico' } } },
  device: { name: 'Reloj principal', ip: '192.168.1.201' }
});
const originals = [];
const replace = (object, key, replacement) => { originals.push([object, key, object[key]]); object[key] = replacement; };
let server;
let url;
let queries = [];
const previousSecret = process.env.JWT_SECRET;
const secret = 'event-report-tests';
const get = (path, role = 'CONSULTA') => fetch(`${url}/api/attendances${path}`, { headers: role ? { Authorization: `Bearer ${jwt.sign({ sub: role }, secret)}` } : {} });

before(async () => {
  process.env.JWT_SECRET = secret;
  replace(User, 'findByPk', async (role) => ({ id: uuid, role, active: true }));
  replace(Attendance, 'findAndCountAll', async (options) => {
    queries.push(options);
    return { rows: [row(2), { ...row(1), employee: null, device: null }], count: 2 };
  });
  replace(Attendance, 'findAll', async (options) => {
    queries.push(options);
    return Array.from({ length: Math.min(options.limit, 1001 - options.offset) }, (_, index) => row(options.offset + index));
  });
  replace(sequelize, 'transaction', async (options, callback) => {
    assert.equal(options.isolationLevel, 'REPEATABLE READ');
    assert.equal(options.readOnly, true);
    return callback({ id: 'snapshot' });
  });
  for (const model of [Device, Department, Position]) replace(model, 'findAll', async () => [{ id: uuid, name: 'Opción' }]);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const [object, key, original] of originals) object[key] = original;
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  await new Promise((resolve) => server.close(resolve));
});

test('los filtros validan fechas reales, rangos, UUID y enteros', () => {
  for (const query of [{ from: '2026-02-30' }, { from: '2026-10-30', to: '2026-10-01' }, { page: '1.5' }, { limit: '101' }, { deviceId: 'x' }, { search: ['x'] }]) {
    assert.throws(() => buildEventQuery(query), { statusCode: 400 });
  }
  const result = buildEventQuery({ from: '2026-10-29', to: '2026-10-29', departmentId: uuid, positionId: uuid, deviceId: uuid, search: 'A_%' });
  assert.equal(result.options.where.recordTime[Op.gte].toISOString(), '2026-10-29T07:00:00.000Z');
  assert.equal(result.options.where.recordTime[Op.lte].toISOString(), '2026-10-30T06:59:59.999Z');
  assert.equal(result.options.where['$employee.profile.departmentId$'], uuid);
  assert.equal(result.options.where['$employee.profile.positionId$'], uuid);
  assert.equal(result.options.where.deviceId, uuid);
  assert.equal(result.options.where[Op.or][0].deviceUserId[Op.iLike], '%A\\_\\%%');
  assert.equal(result.options.include[0].required, false, 'Conserva checadas sin empleado vinculado');
});

test('presenta datos locales sin inventar entrada o salida ni datos faltantes', () => {
  const item = eventReportRow(row(1));
  assert.equal(item.employeeName, 'Ricardo Prueba');
  assert.equal(item.departmentName, 'Sistemas');
  assert.equal(item.localDate, '2026-10-29');
  assert.equal(item.localTime, '09:05:06');
  assert.equal(item.eventType, 'UNCLASSIFIED');
  assert.equal(eventReportRow({ ...row(1), employee: null }).employeeName, 'Sin empleado vinculado');
});

test('reporte autenticado devuelve columnas, paginación y orden estable para los cuatro roles', async () => {
  for (const role of ['ROOT', 'ADMIN', 'SUPERVISOR', 'CONSULTA']) {
    const response = await get(`/events?departmentId=${uuid}&page=2&limit=20`, role);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data[0].positionName, 'Técnico');
    assert.equal(body.data[1].departmentName, 'Sin información');
    assert.equal(body.pagination.total, 2);
    const query = queries.at(-1);
    assert.equal(query.offset, 20);
    assert.deepEqual(query.order, [['recordTime', 'DESC'], ['id', 'DESC']]);
    assert.equal(query.include[0].attributes.includes('devicePin'), false);
  }
});

test('reporte, filtros y exportación rechazan peticiones anónimas', async () => {
  for (const path of ['/events', '/filters', '/export.csv']) assert.equal((await get(path, null)).status, 401);
  assert.equal((await get('/events?from=invalid')).status, 400);
});

test('catálogos del reporte disponibles sin permiso de escritura', async () => {
  const response = await get('/filters');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.devices[0].id, uuid);
  assert.equal(body.data.positions[0].id, uuid);
});

test('CSV incluye 1001 registros en dos lotes con mismos filtros, sin límite de página', async () => {
  queries = [];
  const response = await get(`/export.csv?departmentId=${uuid}&limit=20&page=9`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  const content = await response.text();
  assert.equal(content.trim().split('\r\n').length, 1002);
  assert.ok(content.includes('"108070031","Ricardo Prueba","Sistemas","Técnico"'));
  assert.equal(queries.length, 2);
  assert.deepEqual(queries.map((query) => query.offset), [0, 1000]);
  assert.ok(queries.every((query) => query.where['$employee.profile.departmentId$'] === uuid));
  assert.ok(queries.every((query) => query.transaction.id === 'snapshot'));
});

test('CSV escapa comillas y neutraliza fórmulas', () => {
  assert.equal(csvCell('Nombre "Prueba"'), '"Nombre ""Prueba"""');
  for (const value of ['=1+1', '+CMD', '@SUM(A1)', '-1', '\t=1', '  =1']) assert.ok(csvCell(value).startsWith('"\''));
});
