import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeleteUserPayload } from '../src/services/device-user-write.service.js';
import { buildDeleteUserInfoCommand } from '../src/services/adms-command.service.js';

test('CMD_DELETE_USER serializa el UID interno como uint16 LE', () => {
  const payload = buildDeleteUserPayload({ deviceUserId: '1', deviceUid: 1 });
  assert.equal(payload.length, 2);
  assert.equal(payload.readUInt16LE(0), 1);
  assert.notEqual(payload.readUInt16LE(0), 49);
});

test('CMD_DELETE_USER rechaza empleados sin UID interno válido', () => {
  assert.throws(
    () => buildDeleteUserPayload({ deviceUserId: '1', deviceUid: null }),
    /UID interno válido/
  );
});

test('ADMS elimina en la tabla USERINFO usando el PIN del empleado', () => {
  assert.equal(
    buildDeleteUserInfoCommand({ deviceUserId: '108070040' }),
    'DATA DELETE USERINFO PIN=108070040'
  );
});
