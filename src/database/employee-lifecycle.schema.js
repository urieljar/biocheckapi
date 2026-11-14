import sequelize from '../config/database.js';
import EmploymentPeriod from '../models/employment-period.model.js';

export const ensureEmployeeLifecycleSchema = async () => {
  await sequelize.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "deletedBy" UUID`);
  await EmploymentPeriod.sync();
  await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS employment_periods_one_open
    ON employment_periods ("employeeId") WHERE "validTo" IS NULL`);
};
