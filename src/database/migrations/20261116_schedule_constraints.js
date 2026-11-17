export const up = async ({ sequelize, transaction }) => {
  await sequelize.query(`ALTER TABLE "work_schedules"
    ADD CONSTRAINT "work_schedules_type_check" CHECK ("type" IN ('NORMAL', 'FLEXIBLE', 'MIXED')) NOT VALID`, { transaction });
  await sequelize.query(`ALTER TABLE "work_schedules"
    ADD CONSTRAINT "work_schedules_tolerance_check" CHECK ("toleranceMinutes" BETWEEN 0 AND 180) NOT VALID`, { transaction });
  await sequelize.query(`ALTER TABLE "work_schedules"
    ADD CONSTRAINT "work_schedules_work_minutes_check" CHECK ("workMinutes" IS NULL OR "workMinutes" BETWEEN 1 AND 1440) NOT VALID`, { transaction });
  await sequelize.query(`ALTER TABLE "schedule_days"
    ADD CONSTRAINT "schedule_days_day_of_week_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6) NOT VALID`, { transaction });
  await sequelize.query(`ALTER TABLE "schedule_days"
    ADD CONSTRAINT "schedule_days_type_check" CHECK ("dayType" IN ('NORMAL', 'FLEXIBLE', 'REST')) NOT VALID`, { transaction });
  await sequelize.query(`ALTER TABLE "schedule_days"
    ADD CONSTRAINT "schedule_days_work_minutes_check" CHECK ("workMinutes" IS NULL OR "workMinutes" BETWEEN 1 AND 1440) NOT VALID`, { transaction });
};
