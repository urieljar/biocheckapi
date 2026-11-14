import sequelize from '../config/database.js';

export const ensureReportSchema = async () => {
  await sequelize.query(`
    ALTER TABLE attendances
      ADD COLUMN IF NOT EXISTS "reviewedAt" timestamptz,
      ADD COLUMN IF NOT EXISTS "reviewedBy" uuid,
      ADD COLUMN IF NOT EXISTS "reviewReason" varchar(255)
  `);
};
