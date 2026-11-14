import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { Employee, EmployeeProfile, EmploymentPeriod, User, Department, Area, Position } from '../src/models/index.js';
import { validateEmploymentProfile } from '../src/services/profile-validation.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const originalSecret = process.env.JWT_SECRET;
const originals = [];
const replace = (object, key, value) => { originals.push([object, key, object[key]]); object[key] = value; };
let server, base, profile;
const call = (method, body, role = 'ADMIN') => fetch(`${base}/api/employees/${id}/profile`, {
  method, headers: { Authorization: `Bearer ${jwt.sign({ sub: role }, 'profile-test')}`, 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
before(async () => {
  process.env.JWT_SECRET = 'profile-test';
  replace(User, 'findByPk', async (role) => ({ id, role, active: true }));
  replace(Employee, 'findByPk', async () => ({ id, active: true, name: 'Reloj original', profile }));
  replace(EmployeeProfile, 'findOne', async () => profile);
  replace(EmploymentPeriod, 'count', async () => 0);
  replace(EmployeeProfile, 'create', async (data) => {
    profile = {
      ...data,
      get() { return Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function')); },
      async update(changes) { Object.assign(this, changes); return this; }
    };
    return profile;
  });
  for (const model of [Department, Area, Position]) replace(model, 'findByPk', async () => ({ id }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const [object, key, value] of originals) object[key] = value;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  await new Promise((resolve) => server.close(resolve));
});
test('valida bajas, fechas reales y cambios parciales contra valores existentes', () => {
  for (const changes of [
    { employmentStatus: 'OTHER' }, { hireDate: '2026-02-30' }, { terminationDate: '2026-13-01' },
    { employmentStatus: 'TERMINATED' }, { employmentStatus: 'ACTIVE', terminationReason: 'Renuncia' },
    { employmentStatus: 'TERMINATED', hireDate: '2026-11-10', terminationDate: '2026-11-01', terminationReason: 'Renuncia' }
  ]) assert.ok(validateEmploymentProfile(changes));
  assert.equal(validateEmploymentProfile({ employmentStatus: null, hireDate: null }), null);
  assert.equal(validateEmploymentProfile({ terminationReason: 'Fin de contrato' }, { employmentStatus: 'TERMINATED', terminationDate: '2026-11-01' }), null);
});
test('crea expediente ampliado y omite campos del reloj o funciones excluidas', async () => {
  profile = null;
  const response = await call('POST', { firstName: 'Ana María', lastName: 'López Pérez', employeeNumber: 'EMP-1',
    hireDate: '2026-10-01', employmentStatus: 'ACTIVE', officePhone: '123', address: 'Calle 1', postalCode: '82000', passportNumber: 'A1',
    devicePin: 'SECRET', active: false, photo: 'x', vacationDays: 20 });
  assert.equal(response.status, 201);
  const data = (await response.json()).data;
  assert.equal(data.firstName, 'Ana María');
  assert.equal(data.officePhone, '123');
  assert.equal(data.passportNumber, 'A1');
  assert.equal(data.employmentStatus, 'ACTIVE');
  for (const field of ['active', 'devicePin', 'photo', 'vacationDays']) assert.equal(field in data, false);
});
test('guarda y consulta baja, rechaza rangos invalidos en PATCH y permite corregirla', async () => {
  let response = await call('PATCH', { employmentStatus: 'TERMINATED', terminationDate: '2026-10-31', terminationReason: 'Renuncia' });
  assert.equal(response.status, 200);
  response = await call('GET');
  assert.equal((await response.json()).data.terminationReason, 'Renuncia');
  response = await call('PATCH', { hireDate: '2026-11-01' });
  assert.equal(response.status, 400);
  assert.equal(profile.hireDate, '2026-10-01');
  response = await call('PATCH', { employmentStatus: 'ACTIVE' });
  assert.equal(response.status, 400);
  response = await call('PATCH', { employmentStatus: 'ACTIVE', terminationDate: null, terminationReason: null });
  assert.equal(response.status, 200);
});
test('CONSULTA no puede modificar el expediente', async () => {
  assert.equal((await call('PATCH', { firstName: 'Cambio' }, 'CONSULTA')).status, 403);
});
