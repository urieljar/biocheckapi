import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAuditValue } from '../src/services/audit.service.js';

test('la auditoría redacta secretos y conserva contexto operativo', () => {
  const result = sanitizeAuditValue({
    password: 'no guardar',
    authorization: 'Bearer secreto',
    devicePin: '1234',
    employeeId: 'abc',
    changes: { status: 'TERMINATED' }
  });
  assert.equal(result.password, '[REDACTED]');
  assert.equal(result.authorization, '[REDACTED]');
  assert.equal(result.devicePin, '[REDACTED]');
  assert.equal(result.employeeId, 'abc');
  assert.deepEqual(result.changes, { status: 'TERMINATED' });
});
