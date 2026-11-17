import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Reinicia el piloto local conservando la clave de la colección Postman vigente.
// No ejecutar demo-integration.js: genera otra clave en cada arranque.
if (!process.env.INTEGRATION_API_KEY_SHA256) {
  const credentialsPath = new URL('../../.local/integration-demo.credentials.json', import.meta.url);
  const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
  if (typeof credentials.apiKey !== 'string' || !/^[a-f0-9]{64}$/i.test(credentials.apiKey)) {
    throw new Error('Configura INTEGRATION_API_KEY_SHA256 o crea .local/integration-demo.credentials.json');
  }
  process.env.INTEGRATION_API_KEY_SHA256 = createHash('sha256').update(credentials.apiKey).digest('hex');
}
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = process.env.DEMO_DB_PORT || '5433';
process.env.INTEGRATION_HOST = '127.0.0.1';
process.env.INTEGRATION_PORT = '3001';
await import('../integration/server.js');
