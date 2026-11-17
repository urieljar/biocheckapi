import { logger } from '../services/logger.service.js';

export const notFoundHandler = (req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'Ruta no encontrada', requestId: req.id });
};

export const errorHandler = (error, req, res, _next) => {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : Number.isInteger(error.status) ? error.status : 500;
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  const publicMessage = safeStatus >= 500 ? 'Error interno del servidor' : (error.message || 'Solicitud inválida');
  logger.error('request_failed', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status: safeStatus,
    error: error.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
  });
  if (res.headersSent) return;
  if (req.path.startsWith('/iclock')) return res.type('text/plain').status(safeStatus).send('ERROR');
  return res.status(safeStatus).json({ ok: false, error: safeStatus >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR', message: publicMessage, requestId: req.id });
};
