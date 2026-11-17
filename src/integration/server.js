import 'dotenv/config';
import { createIntegrationApp } from './app.js';
import sequelize from '../config/database.js';
import { logger } from '../services/logger.service.js';

// Este proceso solo consulta: no sincroniza tablas ni inicia tareas del reloj.
const app = createIntegrationApp();
await sequelize.authenticate();
const server = app.listen(Number(process.env.INTEGRATION_PORT || 3001), process.env.INTEGRATION_HOST || '127.0.0.1', () => {
  logger.info('integration_started', { port: server.address().port });
});
const close = () => server.close(async () => { await sequelize.close(); process.exit(0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
