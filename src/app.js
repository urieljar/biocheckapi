import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import admsRoutes from './routes/adms.routes.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import { authenticate } from './middlewares/auth.middleware.js';
import { protectDevicePin } from './middlewares/device-pin.middleware.js';

import employeeRoutes from './routes/employee.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';

import deviceRoutes from './routes/device.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import employeeScheduleRoutes from './routes/employee-schedule.routes.js';
import calendarExceptionRoutes from './routes/calendar-exception.routes.js';
import attendanceCalculationRoutes from './routes/attendance-calculation.routes.js';
import catalogRoutes from './routes/catalog.routes.js';
import rootRoutes from './routes/root.routes.js';
import auditRoutes from './routes/audit.routes.js';
import { auditRequest } from './services/audit.service.js';
import reportRoutes from './routes/report.routes.js';
import payrollClosureRoutes from './routes/payroll-closure.routes.js';
import healthRoutes from './routes/health.routes.js';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware.js';
import { requestId, logger } from './services/logger.service.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use((req, res, next) => {
  req.id = req.get('x-request-id') || requestId();
  res.setHeader('X-Request-Id', req.id);
  const started = Date.now();
  res.on('finish', () => logger.info('http_request', { requestId: req.id, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs: Date.now() - started, ip: req.ip }));
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: 'text/plain' }));
app.use(auditRequest);

app.use('/api/health', healthRoutes);

app.use('/api', protectDevicePin);
app.use('/api/auth', authRoutes);
app.use('/api/users', authenticate, userRoutes);
app.use('/iclock', admsRoutes);
app.use('/api/devices', authenticate, deviceRoutes);
app.use('/api/employees',authenticate, employeeRoutes);
app.use('/api/attendances', authenticate, attendanceRoutes);

app.use('/api/schedules', authenticate, scheduleRoutes);
app.use('/api/employee-schedules', authenticate, employeeScheduleRoutes);
app.use('/api/calendar-exceptions', authenticate, calendarExceptionRoutes);
app.use('/api/attendance-calculations', authenticate, attendanceCalculationRoutes);
app.use('/api/catalogs', authenticate, catalogRoutes);
app.use('/api/root', authenticate, rootRoutes);
app.use('/api/audit-logs', authenticate, auditRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/payroll-closures', authenticate, payrollClosureRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;

// import express from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import morgan from 'morgan';

// const app = express();

// app.use(helmet());
// app.use(cors());
// app.use(morgan('dev'));
// app.use(express.json());

// app.get('/api/health', (req, res) => {
//   res.json({
//     ok: true,
//     message: 'API de asistencia funcionando'
//   });
// });

// export default app;
