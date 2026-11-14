import sequelize from '../config/database.js';

export const ensureWorkScheduleSchema = async () => {
  await sequelize.query(`
    ALTER TABLE "work_schedules"
      ADD COLUMN IF NOT EXISTS "type" VARCHAR(20),
      ADD COLUMN IF NOT EXISTS "workMinutes" INTEGER
  `);

  await sequelize.query(`
    ALTER TABLE "schedule_days"
      ADD COLUMN IF NOT EXISTS "dayType" VARCHAR(20),
      ADD COLUMN IF NOT EXISTS "workMinutes" INTEGER
  `);

  await sequelize.query(`
    UPDATE "work_schedules"
    SET "type" = 'NORMAL'
    WHERE "type" IS NULL OR TRIM("type") = ''
  `);

  await sequelize.query(`
    UPDATE "schedule_days"
    SET "dayType" = CASE
      WHEN "isWorkDay" = FALSE THEN 'REST'
      ELSE 'NORMAL'
    END
    WHERE "dayType" IS NULL OR TRIM("dayType") = ''
  `);
};
