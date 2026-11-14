import sequelize from '../config/database.js';

export const ensureProfileEmploymentSchema = async () => {
  await sequelize.query(`ALTER TABLE "employee_profiles"
    ADD COLUMN IF NOT EXISTS "employmentStatus" VARCHAR(255),
    ADD COLUMN IF NOT EXISTS "terminationDate" DATE,
    ADD COLUMN IF NOT EXISTS "terminationReason" VARCHAR(255)`);
};

// Keeps local installations compatible with employee_profiles created before
// the profile catalogs were normalized.
export const ensureProfileCatalogSchema = async () => {
  await ensureProfileEmploymentSchema();
  await sequelize.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await sequelize.query(`
    ALTER TABLE "employee_profiles"
      ADD COLUMN IF NOT EXISTS "departmentId" UUID,
      ADD COLUMN IF NOT EXISTS "areaId" UUID,
      ADD COLUMN IF NOT EXISTS "positionId" UUID,
      ADD COLUMN IF NOT EXISTS "department" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "area" VARCHAR(255),
      ADD COLUMN IF NOT EXISTS "position" VARCHAR(255)
  `);

  await sequelize.query(`
    ALTER TABLE "departments"
      ADD COLUMN IF NOT EXISTS "code" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "parentId" UUID
  `);

  await sequelize.query(`
    ALTER TABLE "positions"
      ADD COLUMN IF NOT EXISTS "code" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "parentId" UUID
  `);

  await sequelize.query(`
    ALTER TABLE "areas"
      ADD COLUMN IF NOT EXISTS "code" VARCHAR(50),
      ADD COLUMN IF NOT EXISTS "parentId" UUID
  `);

  await sequelize.query(`
    WITH numbered AS (
      SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::TEXT AS code
      FROM "areas"
      WHERE "code" IS NULL OR TRIM("code") = ''
    )
    UPDATE "areas" a
    SET "code" = numbered.code
    FROM numbered
    WHERE a."id" = numbered."id"
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS areas_code_unique
    ON "areas" ("code")
  `);

  await sequelize.query(`
    WITH numbered AS (
      SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::TEXT AS code
      FROM "positions"
      WHERE "code" IS NULL OR TRIM("code") = ''
    )
    UPDATE "positions" p
    SET "code" = numbered.code
    FROM numbered
    WHERE p."id" = numbered."id"
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS positions_code_unique
    ON "positions" ("code")
  `);

  await sequelize.query(`
    WITH numbered AS (
      SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::TEXT AS code
      FROM "departments"
      WHERE "code" IS NULL OR TRIM("code") = ''
    )
    UPDATE "departments" d
    SET "code" = numbered.code
    FROM numbered
    WHERE d."id" = numbered."id"
  `);

  await sequelize.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS departments_code_unique
    ON "departments" ("code")
  `);

  await sequelize.query(`
    INSERT INTO "departments" ("id", "name", "active", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), TRIM("department"), TRUE, NOW(), NOW()
    FROM "employee_profiles" p
    WHERE "department" IS NOT NULL AND TRIM("department") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "departments" d
        WHERE LOWER(d."name") = LOWER(TRIM(p."department"))
      )
    GROUP BY TRIM("department")
  `);

  await sequelize.query(`
    INSERT INTO "areas" ("id", "name", "active", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), TRIM("area"), TRUE, NOW(), NOW()
    FROM "employee_profiles" p
    WHERE "area" IS NOT NULL AND TRIM("area") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "areas" a
        WHERE LOWER(a."name") = LOWER(TRIM(p."area"))
      )
    GROUP BY TRIM("area")
  `);

  await sequelize.query(`
    INSERT INTO "positions" ("id", "name", "active", "createdAt", "updatedAt")
    SELECT gen_random_uuid(), TRIM("position"), TRUE, NOW(), NOW()
    FROM "employee_profiles" p
    WHERE "position" IS NOT NULL AND TRIM("position") <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "positions" j
        WHERE LOWER(j."name") = LOWER(TRIM(p."position"))
      )
    GROUP BY TRIM("position")
  `);

  await sequelize.query(`
    UPDATE "employee_profiles" p
    SET "departmentId" = d."id"
    FROM "departments" d
    WHERE p."departmentId" IS NULL
      AND p."department" IS NOT NULL
      AND LOWER(d."name") = LOWER(TRIM(p."department"))
  `);

  await sequelize.query(`
    UPDATE "employee_profiles" p
    SET "areaId" = a."id"
    FROM "areas" a
    WHERE p."areaId" IS NULL
      AND p."area" IS NOT NULL
      AND LOWER(a."name") = LOWER(TRIM(p."area"))
  `);

  await sequelize.query(`
    UPDATE "employee_profiles" p
    SET "positionId" = j."id"
    FROM "positions" j
    WHERE p."positionId" IS NULL
      AND p."position" IS NOT NULL
      AND LOWER(j."name") = LOWER(TRIM(p."position"))
  `);
};
