import { Router } from 'express';
import { Message } from '../models/Message';
import { getTenantContext } from '../context/tenantContext';
import { currentPeriod } from '../services/budgetService';

export const usageRouter = Router();

usageRouter.get('/me', async (_req, res, next) => {
  try {
    const ctx = getTenantContext()!;
    const period = currentPeriod();
    const [year, month] = period.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);

    const count = await Message.countDocuments({
      userId: ctx.userId,
      role: 'user',
      createdAt: { $gte: start, $lt: end },
    });

    res.json({ period, count });
  } catch (err) {
    next(err);
  }
});
