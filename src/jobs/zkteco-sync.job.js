import cron from 'node-cron';

import {
  synchronizeEmployees
} from '../services/employee-sync.service.js';

import {
  synchronizeAttendances
} from '../services/attendance-sync.service.js';
import {
  failSyncJob,
  finishSyncJob,
  setSyncJobEnabled,
  startSyncJob
} from '../services/sync-status.service.js';

let syncRunning = false;
let jobsStarted = false;
const scheduledTasks = [];

const executeSync = async (name, syncFunction) => {
  const statusName = name.includes('empleados') ? 'employees' : 'attendances';
  if (syncRunning) {
    console.log(
      `[CRON] ${name} omitida: existe otra sincronización en proceso`
    );
    return;
  }

  syncRunning = true;
  startSyncJob(statusName);

  try {
    console.log(`[CRON] Iniciando ${name}`);

    const result = await syncFunction();
    finishSyncJob(statusName, result);

    console.log(`[CRON] ${name} completada`, result);
  } catch (error) {
    failSyncJob(statusName, error);
    console.error(
      `[CRON] Error durante ${name}:`,
      error.message
    );
  } finally {
    syncRunning = false;
  }
};

export const startZktecoSyncJobs = () => {
  if (jobsStarted) {
    return;
  }

  if (process.env.SYNC_JOBS_ENABLED !== 'true') {
    setSyncJobEnabled('employees', false);
    setSyncJobEnabled('attendances', false);
    console.log('[CRON] Sincronización automática deshabilitada');
    return;
  }

  setSyncJobEnabled('employees', true);
  setSyncJobEnabled('attendances', true);

  const timeZone =
    process.env.CRON_TIME_ZONE || 'America/Mazatlan';

  const attendanceSchedule =
    process.env.CRON_ATTENDANCES || '*/5 * * * *';

  const employeeSchedule =
    process.env.CRON_EMPLOYEES || '2 * * * *';

  if (!cron.validate(attendanceSchedule)) {
    throw new Error(
      'CRON_ATTENDANCES contiene una expresión inválida'
    );
  }

  if (!cron.validate(employeeSchedule)) {
    throw new Error(
      'CRON_EMPLOYEES contiene una expresión inválida'
    );
  }

  const attendanceTask = cron.schedule(
    attendanceSchedule,
    () => {
      executeSync(
        'sincronización de checadas',
        synchronizeAttendances
      );
    },
    {
      timezone: timeZone
    }
  );

  const employeeTask = cron.schedule(
    employeeSchedule,
    () => {
      executeSync(
        'sincronización de empleados',
        synchronizeEmployees
      );
    },
    {
      timezone: timeZone
    }
  );

  scheduledTasks.push(attendanceTask, employeeTask);
  jobsStarted = true;

  console.log(
    `[CRON] Checadas programadas: ${attendanceSchedule}`
  );

  console.log(
    `[CRON] Empleados programados: ${employeeSchedule}`
  );
};

export const stopZktecoSyncJobs = () => {
  for (const task of scheduledTasks) {
    task.stop();
  }

  scheduledTasks.length = 0;
  jobsStarted = false;

  console.log('[CRON] Tareas automáticas detenidas');
};
