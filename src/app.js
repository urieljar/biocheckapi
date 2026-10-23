import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import admsRoutes from './routes/adms.routes.js';
import authRoutes from './routes/auth.routes.js';
import { authenticate } from './middlewares/auth.middleware.js';

import employeeRoutes from './routes/employee.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';

import deviceRoutes from './routes/device.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import catalogRoutes from './routes/catalog.routes.js';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.text({ type: 'text/plain' }));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    message: 'API de asistencia funcionando'
  });
});

app.use('/api/auth', authRoutes);
app.use('/iclock', admsRoutes);
app.use('/api/devices', authenticate, deviceRoutes);
app.use('/api/employees',authenticate, employeeRoutes);
app.use('/api/attendances', authenticate, attendanceRoutes);

app.use('/api/schedules', authenticate, scheduleRoutes);
app.use('/api/catalogs', authenticate, catalogRoutes);

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
