import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Op } from 'sequelize';
import sequelize from '../src/config/database.js';
import { User } from '../src/models/index.js';
import { authenticate } from '../src/middlewares/auth.middleware.js';
import userRoutes from '../src/routes/user.routes.js';
import authRoutes from '../src/routes/auth.routes.js';
import { validatePassword } from '../src/services/user-validation.service.js';

// HTTP real con persistencia simulada: no abre conexiones a PostgreSQL ni al reloj.
const IDS = {
  ROOT: '11111111-1111-4111-8111-111111111111',
  ADMIN: '22222222-2222-4222-8222-222222222222',
  SUPERVISOR: '33333333-3333-4333-8333-333333333333',
  CONSULTA: '44444444-4444-4444-8444-444444444444'
};
let records;
let baseUrl;
let server;
let initialHash;
const secret = 'system-users-test-secret';
const originalSecret = process.env.JWT_SECRET;
const originals = {};

const replace = (object, key, implementation) => {
  originals[key] = { object, value: object[key] };
  object[key] = implementation;
};

const makeUser = (fields) => ({
  passwordHash: initialHash,
  active: true,
  role: 'CONSULTA',
  ...fields,
  async update(values) {
    // Reproduce la restricción UNIQUE de PostgreSQL sobre email.
    if (values.email !== undefined && records.some((user) => user !== this && user.email === values.email)) {
      const error = new Error('duplicate');
      error.name = 'SequelizeUniqueConstraintError';
      throw error;
    }
    Object.assign(this, values);
    return this;
  }
});

const reset = () => {
  records = [
    makeUser({ id: IDS.ROOT, name: 'Root', email: 'root@example.com', role: 'ROOT' }),
    makeUser({ id: IDS.ADMIN, name: 'Admin', email: 'admin@example.com', role: 'ADMIN' }),
    makeUser({ id: IDS.SUPERVISOR, name: 'Supervisor', email: 'supervisor@example.com', role: 'SUPERVISOR' }),
    makeUser({ id: IDS.CONSULTA, name: 'Consulta', email: 'consulta@example.com', role: 'CONSULTA' })
  ];
};

const matches = (user, where = {}) => {
  if (where.active !== undefined && user.active !== where.active) return false;

  const role = where.role;
  if (role === undefined) return true;
  if (typeof role === 'string') return user.role === role;
  if (role[Op.ne] !== undefined) return user.role !== role[Op.ne];
  if (role[Op.in] !== undefined) return role[Op.in].includes(user.role);
  return false;
};

const request = async (method, path, body, actor = 'ROOT') => {
  const headers = {};
  if (actor) headers.authorization = `Bearer ${jwt.sign({ sub: IDS[actor] }, secret)}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

before(async () => {
  process.env.JWT_SECRET = secret;
  initialHash = await bcrypt.hash('OriginalPassword123', 4);
  reset();

  let lockTail = Promise.resolve();
  replace(sequelize, 'transaction', async (callback) => {
    const transaction = { LOCK: { UPDATE: 'UPDATE' }, release: null };
    try { return await callback(transaction); } finally { transaction.release?.(); }
  });
  replace(sequelize, 'query', async (_sql, { transaction }) => {
    const previous = lockTail;
    lockTail = new Promise((resolve) => { transaction.release = resolve; });
    await previous;
    return [];
  });

  const findById = (id) => records.find((user) => user.id === id) || null;
  replace(User, 'findByPk', async (id) => findById(id));
  replace(User, 'unscoped', () => ({
    findByPk: async (id) => findById(id),
    findOne: async ({ where }) => records.find((user) => user.email === where.email) || null
  }));
  replace(User, 'create', async (values) => {
    if (records.some((user) => user.email === values.email)) {
      const error = new Error('duplicate');
      error.name = 'SequelizeUniqueConstraintError';
      throw error;
    }
    const id = `9999${String(records.length + 1).padStart(4, '0')}-9999-4999-8999-999999999999`;
    const user = makeUser({ id, ...values });
    records.push(user);
    return user;
  });
  replace(User, 'count', async ({ where } = {}) => records.filter((user) => matches(user, where)).length);
  replace(User, 'findAndCountAll', async (options) => {
    assert.ok(options.attributes.includes('email'));
    assert.ok(!options.attributes.includes('passwordHash'));
    assert.equal(options.limit, 20);
    const rows = records.filter((user) => matches(user, options.where));
    return { rows, count: rows.length };
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/users', authenticate, userRoutes);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const [key, { object, value }] of Object.entries(originals)) object[key] = value;
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  await new Promise((resolve) => server.close(resolve));
});

test('las rutas de usuarios exigen token y capacidad user.manage', async () => {
  reset();
  assert.equal((await request('GET', '/api/users', undefined, null)).status, 401);

  for (const actor of ['SUPERVISOR', 'CONSULTA']) {
    for (const [method, path, body] of [
      ['GET', '/api/users'], ['POST', '/api/users', {}],
      ['GET', `/api/users/${IDS.ROOT}`], ['PATCH', `/api/users/${IDS.ROOT}`, { role: 'ADMIN' }],
      ['PATCH', `/api/users/${IDS.ROOT}/status`, { active: false }],
      ['PATCH', `/api/users/${IDS.ROOT}/password`, { password: 'NewPassword123' }]
    ]) assert.equal((await request(method, path, body, actor)).status, 403, `${actor} ${method} ${path}`);
  }

  assert.equal((await request('GET', '/api/users', undefined, 'ADMIN')).status, 200);
});

test('crear usuario normaliza correo, asigna CONSULTA por defecto y oculta el hash', async () => {
  reset();
  const result = await request('POST', '/api/users', { name: ' Nuevo ', email: ' NEW@Example.com ', password: 'Password12345' });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.email, 'new@example.com');
  assert.equal(result.body.data.name, 'Nuevo');
  assert.equal(result.body.data.role, 'CONSULTA');
  assert.equal(result.body.data.passwordHash, undefined);
  assert.equal(await bcrypt.compare('Password12345', records.at(-1).passwordHash), true);
});

test('las cuentas antiguas con rol USER se crean como SUPERVISOR', async () => {
  reset();
  const result = await request('POST', '/api/users', {
    name: 'Legacy', email: 'legacy@example.com', password: 'Password12345', role: 'USER'
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.role, 'SUPERVISOR');
});

test('rechaza correo duplicado, campos sensibles, tipos y roles inválidos', async () => {
  reset();
  const base = { name: 'Nuevo', email: 'new@example.com', password: 'Password12345' };
  for (const values of [
    { password: 'short' }, { email: 'invalid' }, { name: 123 }, { role: 'SUPERADMIN' },
    { active: false }, { passwordHash: 'raw' }, { role: null }
  ]) assert.equal((await request('POST', '/api/users', { ...base, ...values })).status, 400);
  assert.equal((await request('POST', '/api/users', { ...base, email: 'ADMIN@example.com' })).status, 409);
  assert.throws(() => validatePassword('á'.repeat(37)));
});

test('lista y detalle nunca devuelven contraseñas y validan paginación e id', async () => {
  reset();
  const list = await request('GET', '/api/users');
  assert.equal(list.status, 200);
  assert.equal(list.body.pagination.total, 4);
  assert.ok(list.body.data.every((user) => !Object.hasOwn(user, 'passwordHash')));
  const detail = await request('GET', `/api/users/${IDS.ROOT}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.passwordHash, undefined);
  for (const query of ['limit=101', 'page=0', 'limit=1.5', 'role=OWNER', 'active=1']) {
    assert.equal((await request('GET', `/api/users?${query}`)).status, 400, query);
  }
  assert.equal((await request('GET', '/api/users/invalid')).status, 400);
  assert.equal((await request('GET', '/api/users/99999999-9999-4999-8999-999999999999')).status, 404);
});

test('ADMIN no ve ni consulta la cuenta ROOT', async () => {
  reset();
  const list = await request('GET', '/api/users', undefined, 'ADMIN');
  assert.equal(list.status, 200);
  assert.equal(list.body.pagination.total, 3);
  assert.ok(list.body.data.every((user) => user.role !== 'ROOT'));
  assert.equal((await request('GET', `/api/users/${IDS.ROOT}`, undefined, 'ADMIN')).status, 404);
  assert.equal((await request('GET', '/api/users?role=ROOT', undefined, 'ADMIN')).status, 403);
});

test('edita datos y separa estado y contraseña de la edición general', async () => {
  reset();
  const result = await request('PATCH', `/api/users/${IDS.SUPERVISOR}`, { name: 'Editado', role: 'CONSULTA' });
  assert.equal(result.status, 200);
  assert.equal(records[2].role, 'CONSULTA');
  assert.equal(result.body.data.passwordHash, undefined);
  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}`, {})).status, 400);
  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}`, { active: false })).status, 400);
  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}/status`, { active: 'false' })).status, 400);
});

test('ADMIN gestiona SUPERVISOR y CONSULTA pero nunca cuentas privilegiadas', async () => {
  reset();
  const created = await request('POST', '/api/users', {
    name: 'Nuevo', email: 'nuevo@example.com', password: 'Password12345', role: 'SUPERVISOR'
  }, 'ADMIN');
  assert.equal(created.status, 201);

  for (const role of ['ADMIN', 'ROOT']) {
    assert.equal((await request('POST', '/api/users', {
      name: 'X', email: `x-${role.toLowerCase()}@example.com`, password: 'Password12345', role
    }, 'ADMIN')).status, 403, `ADMIN no debería crear ${role}`);
  }

  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}`, { name: 'Ok' }, 'ADMIN')).status, 200);
  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}`, { role: 'ADMIN' }, 'ADMIN')).status, 403);
  assert.equal((await request('PATCH', `/api/users/${IDS.ADMIN}`, { name: 'No' }, 'ADMIN')).status, 403);
  assert.equal((await request('PATCH', `/api/users/${IDS.ROOT}/status`, { active: false }, 'ADMIN')).status, 403);
  assert.equal((await request('PATCH', `/api/users/${IDS.ADMIN}/password`, { password: 'OtraClave12345' }, 'ADMIN')).status, 403);
});

test('ROOT sí administra cuentas ADMIN', async () => {
  reset();
  assert.equal((await request('PATCH', `/api/users/${IDS.ADMIN}`, { name: 'Admin renombrado' }, 'ROOT')).status, 200);
  assert.equal((await request('PATCH', `/api/users/${IDS.ADMIN}/password`, { password: 'OtraClave12345' }, 'ROOT')).status, 200);
  assert.equal(await bcrypt.compare('OtraClave12345', records[1].passwordHash), true);
});

test('protege al último ROOT de la desactivación y de la degradación', async () => {
  reset();
  assert.equal((await request('PATCH', `/api/users/${IDS.ROOT}/status`, { active: false })).status, 409);
  assert.equal((await request('PATCH', `/api/users/${IDS.ROOT}`, { role: 'ADMIN' })).status, 409);
  assert.equal(records[0].active, true);
  assert.equal(records[0].role, 'ROOT');
});

test('serializa dos bajas simultáneas y conserva un ROOT activo', async () => {
  reset();
  records[1].role = 'ROOT';
  const results = await Promise.all([
    request('PATCH', `/api/users/${IDS.ROOT}/status`, { active: false }, 'ROOT'),
    request('PATCH', `/api/users/${IDS.ADMIN}/status`, { active: false }, 'ADMIN')
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(records.filter((user) => user.active && user.role === 'ROOT').length, 1);
});

test('desactivación bloquea tokens existentes; reactivación permite acceso', async () => {
  reset();
  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}/status`, { active: false })).status, 200);
  assert.equal((await request('GET', '/api/auth/me', undefined, 'SUPERVISOR')).status, 401);
  assert.equal((await request('PATCH', `/api/users/${IDS.SUPERVISOR}/status`, { active: true })).status, 200);
  const me = await request('GET', '/api/auth/me', undefined, 'SUPERVISOR');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.passwordHash, undefined);
});

test('cambiar contraseña propia exige la actual y permite login con la nueva', async () => {
  reset();
  assert.equal((await request('PATCH', '/api/auth/password', { currentPassword: 'wrong', newPassword: 'NewPassword123' }, 'SUPERVISOR')).status, 400);
  assert.equal((await request('PATCH', '/api/auth/password', { currentPassword: 'OriginalPassword123', newPassword: 'OriginalPassword123' }, 'SUPERVISOR')).status, 400);
  assert.equal((await request('PATCH', '/api/auth/password', { currentPassword: 'OriginalPassword123', newPassword: 'NewPassword123' }, 'SUPERVISOR')).status, 200);
  assert.equal((await request('POST', '/api/auth/login', { email: 'supervisor@example.com', password: 'OriginalPassword123' }, null)).status, 401);
  assert.equal((await request('POST', '/api/auth/login', { email: 'supervisor@example.com', password: 'NewPassword123' }, null)).status, 200);
});

test('restablecer contraseña ajena no expone hash ni contraseña', async () => {
  reset();
  const result = await request('PATCH', `/api/users/${IDS.CONSULTA}/password`, { password: 'ResetPassword123' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data, undefined);
  assert.equal(await bcrypt.compare('ResetPassword123', records[3].passwordHash), true);
});

test('un SUPERVISOR edita su propio nombre y correo con /api/auth/me', async () => {
  reset();
  const result = await request('PATCH', '/api/auth/me', { name: '  Nombre Nuevo ', email: ' NUEVO@Example.com ' }, 'SUPERVISOR');
  assert.equal(result.status, 200);
  assert.equal(result.body.data.name, 'Nombre Nuevo');
  assert.equal(result.body.data.email, 'nuevo@example.com');
  assert.equal(result.body.data.role, 'SUPERVISOR');
  assert.equal(result.body.data.passwordHash, undefined);
  assert.equal(records[2].name, 'Nombre Nuevo');
  assert.equal(records[2].email, 'nuevo@example.com');
  const me = await request('GET', '/api/auth/me', undefined, 'SUPERVISOR');
  assert.equal(me.body.data.email, 'nuevo@example.com');
});

test('el perfil propio rechaza escalada de privilegios y campos ajenos', async () => {
  reset();
  for (const values of [
    { role: 'ROOT' }, { role: 'ADMIN' }, { role: 'USER' }, { active: false }, { passwordHash: 'inyectado' },
    { name: 'X', role: 'ROOT' }, { name: 'X', active: false }, {}
  ]) assert.equal((await request('PATCH', '/api/auth/me', values, 'CONSULTA')).status, 400);
  assert.equal(records[3].role, 'CONSULTA');
  assert.equal(records[3].active, true);
  assert.equal(records[3].name, 'Consulta');
  assert.equal(records[3].email, 'consulta@example.com');
});

test('el perfil propio valida correo duplicado, formato, nombre vacío y token', async () => {
  reset();
  assert.equal((await request('PATCH', '/api/auth/me', { email: 'root@example.com' }, 'CONSULTA')).status, 409);
  assert.equal((await request('PATCH', '/api/auth/me', { email: 'no-es-correo' }, 'CONSULTA')).status, 400);
  assert.equal((await request('PATCH', '/api/auth/me', { name: '' }, 'CONSULTA')).status, 400);
  assert.equal((await request('PATCH', '/api/auth/me', { name: 'Sin token' }, null)).status, 401);
  assert.equal(records[3].email, 'consulta@example.com');
  assert.equal(records[3].name, 'Consulta');
});

test('cambiar la contraseña propia exige currentPassword y el largo mínimo', async () => {
  reset();
  assert.equal((await request('PATCH', '/api/auth/password', { newPassword: 'OtraClave12345' }, 'CONSULTA')).status, 400);
  assert.equal((await request('PATCH', '/api/auth/password', { currentPassword: 'OriginalPassword123', newPassword: 'corta' }, 'CONSULTA')).status, 400);
  assert.equal((await request('PATCH', '/api/auth/password', { currentPassword: 'OriginalPassword123', newPassword: 'OtraClave12345' }, 'CONSULTA')).status, 200);
  assert.equal(await bcrypt.compare('OtraClave12345', records[3].passwordHash), true);
});
