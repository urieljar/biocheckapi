import { Op } from 'sequelize';
import { AuditLog, User } from '../models/index.js';

const REDACTED = '[REDACTED]';
const SECRET_KEYS = /password|token|secret|authorization|cookie|pin|credential|api[-_]?key/i;

export const sanitizeAuditValue = (value, depth = 0) => {
  if (depth > 4) return '[TRUNCATED]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...[TRUNCATED]` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key, SECRET_KEYS.test(key) ? REDACTED : sanitizeAuditValue(item, depth + 1)
    ]));
  }
  return String(value);
};

export const recordAudit = async (entry) => {
  try {
    return await AuditLog.create({
      actorId: entry.actorId || null,
      action: String(entry.action || 'API_REQUEST').slice(0, 120),
      category: String(entry.category || 'API').slice(0, 60),
      resourceType: entry.resourceType ? String(entry.resourceType).slice(0, 80) : null,
      resourceId: entry.resourceId ? String(entry.resourceId).slice(0, 120) : null,
      method: String(entry.method || 'UNKNOWN').slice(0, 10),
      path: String(entry.path || '').slice(0, 500),
      statusCode: Number(entry.statusCode) || 500,
      success: Boolean(entry.success),
      ipAddress: entry.ipAddress ? String(entry.ipAddress).slice(0, 128) : null,
      userAgent: entry.userAgent ? String(entry.userAgent).slice(0, 500) : null,
      beforeData: entry.beforeData == null ? null : sanitizeAuditValue(entry.beforeData),
      afterData: entry.afterData == null ? null : sanitizeAuditValue(entry.afterData),
      requestData: entry.requestData == null ? null : sanitizeAuditValue(entry.requestData),
      metadata: entry.metadata == null ? null : sanitizeAuditValue(entry.metadata),
      errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 500) : null
    });
  } catch (error) {
    // La auditoría nunca debe tumbar la operación principal.
    console.error('No se pudo guardar auditoría:', error.message);
    return null;
  }
};

export const auditRequest = (req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const failed = res.statusCode >= 400;
    if (!mutating && !failed) return;
    const firstForwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const resourceId = req.params?.id || null;
    void recordAudit({
      actorId: req.user?.id,
      action: `${req.method} ${req.route?.path || req.path}`,
      category: failed ? 'ERROR' : 'API',
      resourceType: req.path.split('/')[2] || null,
      resourceId,
      method: req.method,
      path: req.originalUrl || req.path,
      statusCode: res.statusCode,
      success: !failed,
      ipAddress: firstForwarded || req.socket?.remoteAddress,
      userAgent: req.get('user-agent'),
      requestData: req.body && typeof req.body === 'object' ? req.body : null,
      beforeData: req.auditBefore || null,
      afterData: req.auditAfter || (req.body && typeof req.body === 'object' ? req.body : null),
      metadata: { durationMs: Date.now() - startedAt }
    });
  });
  next();
};

const positive = (value, fallback, max) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw Object.assign(new Error('page y limit inválidos'), { statusCode: 400 });
  return number;
};

export const listAuditLogs = async (req, res) => {
  try {
    const page = positive(req.query.page, 1, 1000000);
    const limit = positive(req.query.limit, 50, 100);
    const where = {};
    for (const key of ['action', 'category', 'resourceType', 'resourceId', 'actorId', 'ipAddress']) {
      if (req.query[key] !== undefined) where[key] = String(req.query[key]).slice(0, 120);
    }
    if (req.query.success !== undefined) {
      if (!['true', 'false'].includes(req.query.success)) throw Object.assign(new Error('success debe ser true o false'), { statusCode: 400 });
      where.success = req.query.success === 'true';
    }
    if (req.query.from || req.query.to) {
      where.createdAt = {};
      if (req.query.from) where.createdAt[Op.gte] = new Date(req.query.from);
      if (req.query.to) where.createdAt[Op.lt] = new Date(req.query.to);
      if (Object.values(where.createdAt).some((date) => Number.isNaN(date.getTime()))) throw Object.assign(new Error('from/to inválidos'), { statusCode: 400 });
    }
    const { rows, count } = await AuditLog.findAndCountAll({ where, include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email', 'role'] }], limit, offset: (page - 1) * limit, order: [['createdAt', 'DESC'], ['id', 'DESC']] });
    return res.json({ ok: true, data: rows, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible consultar la auditoría' });
  }
};

const auditQuery = (query) => {
  const where = {};
  for (const key of ['action', 'category', 'resourceType', 'resourceId', 'actorId', 'ipAddress']) {
    if (query[key] !== undefined && String(query[key]).trim()) where[key] = String(query[key]).slice(0, 120);
  }
  if (query.success !== undefined) {
    if (!['true', 'false'].includes(query.success)) throw Object.assign(new Error('success debe ser true o false'), { statusCode: 400 });
    where.success = query.success === 'true';
  }
  if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt[Op.gte] = new Date(query.from);
    if (query.to) where.createdAt[Op.lt] = new Date(query.to);
    if (Object.values(where.createdAt).some((date) => Number.isNaN(date.getTime()))) throw Object.assign(new Error('from/to inválidos'), { statusCode: 400 });
  }
  return where;
};

export const exportAuditLogs = async (req, res) => {
  try {
    const rows = await AuditLog.findAll({ where: auditQuery(req.query), include: [{ model: User, as: 'actor', attributes: ['id', 'name', 'email', 'role'] }], order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 10000 });
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = ['Fecha', 'Usuario', 'Acción', 'Categoría', 'Recurso', 'ID recurso', 'Resultado', 'Código', 'IP', 'Ruta', 'Anterior', 'Nuevo', 'Error'];
    const lines = rows.map((row) => [row.createdAt?.toISOString(), row.actor?.name || row.actor?.email || row.actorId, row.action, row.category, row.resourceType, row.resourceId, row.success ? 'Correcto' : 'Falló', row.statusCode, row.ipAddress, row.path, JSON.stringify(row.beforeData ?? null), JSON.stringify(row.afterData ?? null), row.errorMessage].map(escape).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="auditoria.csv"');
    return res.send(`\uFEFF${header.map(escape).join(',')}\n${lines.join('\n')}`);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ ok: false, message: error.statusCode ? error.message : 'No fue posible exportar la auditoría' });
  }
};
