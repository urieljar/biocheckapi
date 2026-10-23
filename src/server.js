import 'dotenv/config';

import app from './app.js';
import sequelize from './config/database.js';
import './models/index.js';
import { ensureProfileCatalogSchema } from './database/profile-catalog.schema.js';

import { startZktecoSyncJobs, stopZktecoSyncJobs } from './jobs/zkteco-sync.job.js';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await sequelize.authenticate();

    console.log(
      'Conexión con PostgreSQL establecida correctamente'
    );

    await sequelize.sync();
    await ensureProfileCatalogSchema();

    console.log('Modelos sincronizados correctamente');

    startZktecoSyncJobs();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(
        `Servidor ejecutándose en http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error('Error al iniciar el servidor');
    console.error(error.message);
    process.exit(1);
  }
};

const shutdown = async () => {
  console.log('Cerrando servidor...');

  stopZktecoSyncJobs();
  await sequelize.close();

  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer();
