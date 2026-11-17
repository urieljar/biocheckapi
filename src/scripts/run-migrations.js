import 'dotenv/config';
import sequelize from '../config/database.js';
import { runMigrations } from '../database/migration-runner.js';

try {
  await sequelize.authenticate();
  await runMigrations();
  console.log('Migraciones aplicadas correctamente');
} finally {
  await sequelize.close();
}
