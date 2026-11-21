export const up = async ({ sequelize, transaction }) => {
  await sequelize.query(`ALTER TABLE "device_commands"
    ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS "nextAttemptAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "lastError" TEXT`, { transaction });

  await sequelize.query(`UPDATE "device_commands" SET "status" = 'CONFIRMED' WHERE "status" = 'SUCCESS'`, { transaction });

  await sequelize.query(`ALTER TABLE "devices"
    ADD COLUMN IF NOT EXISTS "admsStatus" VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN IF NOT EXISTS "lastAdmsAt" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "admsLastError" TEXT`, { transaction });

  await sequelize.query(`CREATE TABLE IF NOT EXISTS "device_adms_events" (
    "id" BIGSERIAL PRIMARY KEY,
    "deviceId" UUID,
    "serialNumber" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(30) NOT NULL,
    "commandId" BIGINT,
    "returnCode" INTEGER,
    "requestBody" TEXT,
    "sourceIp" VARCHAR(255),
    "userAgent" VARCHAR(255),
    "accepted" BOOLEAN NOT NULL DEFAULT TRUE,
    "error" TEXT,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`, { transaction });

  await sequelize.query('CREATE INDEX IF NOT EXISTS device_adms_events_serial_received_idx ON "device_adms_events" ("serialNumber", "receivedAt")', { transaction });
  await sequelize.query('CREATE INDEX IF NOT EXISTS device_adms_events_type_received_idx ON "device_adms_events" ("eventType", "receivedAt")', { transaction });
};
