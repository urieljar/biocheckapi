import sequelize from '../config/database.js';

export const ensureAuditSchema = async () => {
  await sequelize.query('ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "beforeData" JSONB');
  await sequelize.query('ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "afterData" JSONB');
  await sequelize.query('CREATE INDEX IF NOT EXISTS "audit_logs_resource_created_idx" ON "audit_logs" ("resourceType", "resourceId", "createdAt")');
};
