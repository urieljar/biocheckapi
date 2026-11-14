import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEmployedOn, overlapsEmployment } from '../src/services/employment-period.service.js';

test('la baja incluye el último día y el reingreso no genera faltas en el intervalo', () => {
  const employee = { employmentPeriods: [
    { validFrom: '2026-01-01', validTo: '2026-05-15' },
    { validFrom: '2026-07-01', validTo: null }
  ] };
  assert.equal(isEmployedOn(employee, '2026-05-15'), true);
  assert.equal(isEmployedOn(employee, '2026-05-16'), false);
  assert.equal(isEmployedOn(employee, '2026-06-15'), false);
  assert.equal(isEmployedOn(employee, '2026-07-01'), true);
  assert.equal(overlapsEmployment(employee, '2026-06-01', '2026-06-30'), false);
  assert.equal(overlapsEmployment(employee, '2026-05-01', '2026-06-30'), true);
});
test('expedientes anteriores usan sus fechas, no la fecha de alta técnica', () => {
  const employee = { profile: { hireDate: '2026-03-01', terminationDate: '2026-10-10' } };
  assert.equal(isEmployedOn(employee, '2026-02-28'), false);
  assert.equal(isEmployedOn(employee, '2026-10-10'), true);
  assert.equal(isEmployedOn(employee, '2026-10-11'), false);
  assert.equal(overlapsEmployment(employee, '2026-11-01', '2026-11-30'), false);
  assert.equal(isEmployedOn({}, '2020-01-01'), true);
});
