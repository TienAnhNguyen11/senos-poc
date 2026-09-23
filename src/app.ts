import express, { Request, Response, NextFunction } from 'express';
import { authRouter } from './routes/auth.routes';
import { adminRouter } from './routes/admin.routes';
import { chatRouter } from './routes/chat.routes';
import { usageRouter } from './routes/usage.routes';
import { authMiddleware } from './middleware/auth';
import { requireAdmin } from './middleware/requireAdmin';
import { HttpError } from './errors/HttpError';

export const app = express();

app.use(express.json());
app.use(express.static('public'));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/admin', authMiddleware, requireAdmin, adminRouter);
app.use('/api/chat', authMiddleware, chatRouter);
app.use('/api/usage', authMiddleware, usageRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
