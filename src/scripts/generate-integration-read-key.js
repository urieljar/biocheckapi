import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const key = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(key).digest('hex');
await mkdir('.local', { recursive: true });
await writeFile('.local/integration-read.credentials.json', JSON.stringify({ apiKey: key, scope: 'read' }, null, 2));
console.log(`INTEGRATION_API_KEY_SHA256=${hash}`);
console.log('Credencial guardada en .local/integration-read.credentials.json');
