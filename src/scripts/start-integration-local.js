import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Reinicia el piloto local conservando las credenciales generadas.
const readCredentialHash = async (fileNames) => {
  for (const fileName of fileNames) {
    try {
      const credentialsPath = new URL(`../../.local/${fileName}`, import.meta.url);
      const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
      if (typeof credentials.apiKey === 'string' && /^[a-f0-9]{64}$/i.test(credentials.apiKey)) {
        return createHash('sha256').update(credentials.apiKey).digest('hex');
      }
    } catch {
      // Probar el siguiente archivo.
    }
  }
  return null;
};

if (!process.env.INTEGRATION_API_KEY_SHA256) {
  process.env.INTEGRATION_API_KEY_SHA256 = await readCredentialHash([
    'integration-demo.credentials.json',
    'integration-read.credentials.json',
    'integration-v3.credentials.json'
  ]);
}
if (!process.env.INTEGRATION_WRITE_API_KEY_SHA256) {
  process.env.INTEGRATION_WRITE_API_KEY_SHA256 = await readCredentialHash([
    'integration-write.credentials.json',
    'integration-demo.credentials.json',
    'integration-v3.credentials.json'
  ]);
}
if (!process.env.INTEGRATION_V3_API_KEY_SHA256) {
  process.env.INTEGRATION_V3_API_KEY_SHA256 = await readCredentialHash([
    'integration-v3.credentials.json',
    'integration-demo.credentials.json'
  ]);
}
if (!process.env.INTEGRATION_API_KEY_SHA256 || !process.env.INTEGRATION_WRITE_API_KEY_SHA256 || !process.env.INTEGRATION_V3_API_KEY_SHA256) {
  throw new Error('No se encontraron credenciales de integración. Configura los hashes INTEGRATION_*_API_KEY_SHA256 o genera los archivos .local/integration-*.credentials.json');
}
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = process.env.DEMO_DB_PORT || '5433';
process.env.INTEGRATION_HOST = '127.0.0.1';
process.env.INTEGRATION_PORT = '3001';
await import('../integration/server.js');
