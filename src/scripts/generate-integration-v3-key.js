import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const key = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(key).digest('hex');
await mkdir('.local', { recursive: true });
await writeFile('.local/integration-v3.credentials.json', JSON.stringify({
  baseUrl: 'http://127.0.0.1:3001/api/integrations/v3',
  apiKey: key,
  scope: 'clock-users:read-write'
}, null, 2), { mode: 0o600 });
console.log(`INTEGRATION_V3_API_KEY_SHA256=${hash}`);
console.log('Credencial v3 guardada en .local/integration-v3.credentials.json');
