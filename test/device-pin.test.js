import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectDevicePin, redactCommandPin } from '../src/middlewares/device-pin.middleware.js';
import Employee from '../src/models/employee.model.js';

const sample = () => ({
  data: Employee.build({ name: 'Prueba', deviceUserId: '123', devicePin: '9876' }),
  nested: [{ device_pin: '9876', devicePin: '9876', name: 'Prueba' }],
  command: 'DATA UPDATE USERINFO PIN=123\tPasswd=9876\tCard=45'
});
const serialize = (role, body, active = true) => {
  let result;
  const res = { json(value) { result = JSON.parse(JSON.stringify(value)); return this; } };
  const req = { user: role ? { role, active } : undefined };
  protectDevicePin(req, res, () => {});
  res.json(body);
  return result;
};

test('ROOT y ADMIN reciben PIN incluido en modelos y comandos', () => {
  for (const role of ['ROOT', 'ADMIN']) {
    const result = serialize(role, sample());
    assert.equal(result.data.devicePin, '9876');
    assert.equal(result.nested[0].device_pin, '9876');
    assert.ok(result.command.includes('Passwd=9876'));
  }
});

test('SUPERVISOR, CONSULTA y USER no reciben el PIN ni dentro del comando ADMS', () => {
  for (const role of ['SUPERVISOR', 'CONSULTA', 'USER', 'UNKNOWN', undefined]) {
    const body = sample();
    const result = serialize(role, body);
    assert.equal(result.data.devicePin, undefined);
    assert.equal(result.nested[0].devicePin, undefined);
    assert.equal(result.nested[0].device_pin, undefined);
    assert.equal(result.data.deviceUserId, '123');
    assert.equal(result.command, 'DATA UPDATE USERINFO PIN=123\tPasswd=[OCULTO]\tCard=45');
    assert.equal(body.data.devicePin, '9876', 'El servicio conserva el PIN original');
  }
});

test('cuenta desactivada no recibe PIN aunque su rol sea ROOT', () => {
  assert.equal(serialize('ROOT', sample(), false).data.devicePin, undefined);
});

test('redacción de logs oculta el PIN sin alterar el comando original', () => {
  const command = 'DATA UPDATE USERINFO PIN=123\tPasswd=9876\tName=Prueba';
  assert.equal(redactCommandPin(command), 'DATA UPDATE USERINFO PIN=123\tPasswd=[OCULTO]\tName=Prueba');
  assert.ok(command.includes('9876'));
});
