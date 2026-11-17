import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sequelize from '../config/database.js';

const migrationsDirectory = fileURLToPath(new URL('./migrations', import.meta.url));

export const runMigrations = async () => {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS "schema_migrations" (
    "name" VARCHAR(255) PRIMARY KEY,
    "runAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const [appliedRows] = await sequelize.query('SELECT "name" FROM "schema_migrations" ORDER BY "name"');
  const applied = new Set(appliedRows.map((row) => row.name));
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith('.js')).sort();
  for (const file of files) {
    const name = basename(file);
    if (applied.has(name)) continue;
    const migration = await import(pathToFileURL(join(migrationsDirectory, file)).href);
    if (typeof migration.up !== 'function') throw new Error(`Migración inválida: ${name}`);
    await sequelize.transaction(async (transaction) => {
      await migration.up({ sequelize, transaction });
      await sequelize.query('INSERT INTO "schema_migrations" ("name") VALUES (:name)', { replacements: { name }, transaction });
    });
    console.log(`[MIGRATION] aplicada ${name}`);
  }
};
