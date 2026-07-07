import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { mastersRouter } from './routes/masters.js';
import { bookingsRouter } from './routes/bookings.js';
import { salesRouter } from './routes/sales.js';
import { dispatchRouter } from './routes/dispatch.js';
import { paymentsRouter } from './routes/payments.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { errorHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'psk-backend' }));

  app.use('/api/auth', authRouter);
  app.use('/api/masters', mastersRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/dispatch', dispatchRouter);
  app.use('/api/payments', paymentsRouter);
  app.use('/api/dashboards', dashboardsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}
