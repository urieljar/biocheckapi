import 'dotenv/config';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// Solo el piloto ejecutado en Windows usa el puerto publicado de PostgreSQL.
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = process.env.DEMO_DB_PORT || '5433';
const { createIntegrationApp } = await import('../integration/app.js');
const { default: sequelize } = await import('../config/database.js');
await sequelize.authenticate();
const key = randomBytes(32).toString('hex');
const keyHash = createHash('sha256').update(key).digest('hex');
const app = createIntegrationApp({ keyHash });
const server = app.listen(3001, '127.0.0.1');
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const baseUrl = 'http://127.0.0.1:3001/api/integrations/v1';
const headers = { Authorization: `Bearer ${key}` };
await mkdir('.local', { recursive: true });
await writeFile('.local/integration-demo.credentials.json', JSON.stringify({ baseUrl, apiKey: key }, null, 2));
const employeesResponse = await fetch(`${baseUrl}/employees?limit=100`, { headers });
const employees = await employeesResponse.json();
if (!employeesResponse.ok) throw new Error(`Catálogo falló: ${employeesResponse.status}`);
const employee = employees.data.find((item) => item.name.toUpperCase().includes('ABRIL')) || employees.data[0];
let calculation = null;
if (employee) {
  const response = await fetch(`${baseUrl}/attendance-calculations/employees/${employee.id}?from=2026-10-01&to=2026-10-29`, { headers });
  calculation = { status: response.status, body: await response.json() };
  if (!response.ok) throw new Error(`Cálculo falló: ${response.status}`);
}
const missingKeyStatus = (await fetch(`${baseUrl}/employees`)).status;
const adminStatus = (await fetch('http://127.0.0.1:3001/api/users', { headers })).status;
const writeStatus = (await fetch(`${baseUrl}/employees`, { method: 'POST', headers })).status;
const result = { checkedAt: new Date().toISOString(), database: 'PostgreSQL real local', employeesStatus: employeesResponse.status,
  totalEmployees: employees.pagination.total, calculation, missingKeyStatus, adminStatus, writeStatus };
await writeFile('.local/integration-demo.result.json', JSON.stringify(result, null, 2));
await writeFile('.local/integration-demo.postman_collection.json', JSON.stringify({
  info: { name: 'BioCheck - Piloto Cálculo de Asistencias', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}', type: 'string' }] },
  variable: [{ key: 'baseUrl', value: baseUrl }, { key: 'apiKey', value: key }, { key: 'employeeId', value: employee?.id || '' }],
  item: [
    { name: '1 - Consultar empleados', request: { method: 'GET', url: '{{baseUrl}}/employees?limit=20' } },
    { name: '2 - Calcular asistencia', request: { method: 'GET', url: '{{baseUrl}}/attendance-calculations/employees/{{employeeId}}?from=2026-10-01&to=2026-10-29' } }
  ]
}, null, 2));
console.info(JSON.stringify({ ready: baseUrl, totalEmployees: result.totalEmployees, calculationStatus: calculation?.status,
  summary: calculation?.body.data?.summary, missingKeyStatus, adminStatus, writeStatus, evidence: '.local/integration-demo.result.json' }));
const close = () => server.close(async () => { await sequelize.close(); process.exit(0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
