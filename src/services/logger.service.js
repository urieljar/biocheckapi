import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const logDirectory = path.resolve(process.env.LOG_DIR || 'logs');
const logFile = path.join(logDirectory, process.env.LOG_FILE || 'api.log');

const redact = (value) => {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/authorization|token|password|secret|pin|device_pin|commkey/i.test(key)) return [key, '[REDACTED]'];
    return [key, redact(item)];
  }));
};

const write = (level, message, context = {}) => {
  const entry = { timestamp: new Date().toISOString(), level, service: 'biocheck-api', message, ...redact(context) };
  const line = JSON.stringify(entry);
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    fs.appendFileSync(logFile, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[LOGGER] No se pudo escribir el archivo de log:', error.message);
  }
  const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  output(line);
};

export const logger = {
  child: (base = {}) => ({
    info: (message, context = {}) => write('info', message, { ...base, ...context }),
    warn: (message, context = {}) => write('warn', message, { ...base, ...context }),
    error: (message, context = {}) => write('error', message, { ...base, ...context }),
    debug: (message, context = {}) => write('debug', message, { ...base, ...context })
  }),
  info: (message, context) => write('info', message, context),
  warn: (message, context) => write('warn', message, context),
  error: (message, context) => write('error', message, context),
  debug: (message, context) => write('debug', message, context)
};

export const requestId = () => randomUUID();
export const logFilePath = logFile;
