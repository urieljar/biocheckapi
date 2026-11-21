import test from 'node:test';
import assert from 'node:assert/strict';

import { validateExternalClockUser, externalClockUser, externalDevice, verifyExternalClockUser } from '../src/integration/app.js';

test('v3 valida el contrato mínimo de usuario externo para el reloj', () => {
  assert.deepEqual(validateExternalClockUser({
    deviceUserId: '108070050', deviceUid: 60, name: 'JUAN PEREZ',
    deviceRole: 0, devicePin: null, cardNumber: null
  }), {
    deviceUserId: '108070050', deviceUid: 60, name: 'JUAN PEREZ',
    deviceRole: 0, devicePin: null, cardNumber: null
  });
});

test('v3 rechaza UID inválido y valores que podrían alterar un comando ADMS', () => {
  assert.throws(() => validateExternalClockUser({ deviceUserId: '1', deviceUid: 0, name: 'A' }), /deviceUid/);
  assert.throws(() => validateExternalClockUser({ deviceUserId: '1\nDATA DELETE USERINFO', deviceUid: 1, name: 'A' }), /caracteres no permitidos/);
});

test('v3 consulta usuarios del reloj sin exponer su PIN', () => {
  const result = externalClockUser({ userId: '108070050', uid: 60, name: 'JUAN PEREZ', role: 0, password: '1234', cardno: 99 });
  assert.deepEqual(result, { deviceUserId: '108070050', deviceUid: 60, name: 'JUAN PEREZ', deviceRole: 0, cardNumber: '99' });
  assert.equal('password' in result, false);
});

test('v3 puede incluir el PIN únicamente en la consulta privilegiada', () => {
  const result = externalClockUser({ userId: '108070050', uid: 60, name: 'JUAN PEREZ', role: 0, password: '1234', cardno: 0 }, { includePin: true });
  assert.equal(result.devicePin, '1234');
});

test('v3 publica el deviceId necesario para consumir las rutas del reloj', () => {
  assert.equal(externalDevice({ id: 'device-1', name: 'MB160', ip: '192.168.1.201', port: 4370, serialNumber: 'SN1', active: true }).deviceId, 'device-1');
});

test('v3 verifica presencia y ausencia directamente sobre usuarios del reloj', () => {
  const users = [{ userId: '108070050', uid: 60, name: 'JUAN PEREZ' }];
  assert.equal(verifyExternalClockUser(users, '108070050', 'EXISTS').verified, true);
  assert.equal(verifyExternalClockUser(users, '108070050', 'ABSENT').verified, false);
  assert.equal(verifyExternalClockUser(users, '999', 'ABSENT').verified, true);
});
