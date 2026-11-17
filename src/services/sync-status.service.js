const jobs = {
  employees: { enabled: false, running: false, lastStartedAt: null, lastFinishedAt: null, lastSuccessAt: null, lastError: null, lastResult: null },
  attendances: { enabled: false, running: false, lastStartedAt: null, lastFinishedAt: null, lastSuccessAt: null, lastError: null, lastResult: null }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

export const setSyncJobEnabled = (name, enabled) => {
  if (!jobs[name]) return;
  jobs[name].enabled = Boolean(enabled);
};

export const startSyncJob = (name) => {
  if (!jobs[name]) return;
  jobs[name].running = true;
  jobs[name].lastStartedAt = new Date().toISOString();
  jobs[name].lastError = null;
};

export const finishSyncJob = (name, result) => {
  if (!jobs[name]) return;
  const now = new Date().toISOString();
  jobs[name].running = false;
  jobs[name].lastFinishedAt = now;
  jobs[name].lastSuccessAt = now;
  jobs[name].lastResult = result && typeof result === 'object' ? result : null;
};

export const failSyncJob = (name, error) => {
  if (!jobs[name]) return;
  jobs[name].running = false;
  jobs[name].lastFinishedAt = new Date().toISOString();
  jobs[name].lastError = error?.message || String(error);
};

export const getSyncJobsStatus = () => clone(jobs);
