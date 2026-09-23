import { Router } from 'express';
import { Department } from '../models/Department';
import { User } from '../models/User';
import { Message } from '../models/Message';
import { Tenant } from '../models/Tenant';
import { getTenantContext } from '../context/tenantContext';
import { setTenantBudget, departmentUsage } from '../services/budgetService';
import { createInvite } from '../services/inviteService';
import { HttpError } from '../errors/HttpError';

export const adminRouter = Router();

adminRouter.get('/departments', async (_req, res, next) => {
  try {
    const departments = await Department.find();
    const withUsage = await Promise.all(
      departments.map(async (d) => ({
        _id: d._id,
        name: d.name,
        monthlyBudget: d.monthlyBudget,
        usage: await departmentUsage(String(d._id), d.monthlyBudget),
      }))
    );
    res.json(withUsage);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/departments', async (req, res, next) => {
  try {
    const { name, monthlyBudget } = req.body;
    const department = await Department.create({ name, monthlyBudget });
    res.status(201).json(department);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/users', async (_req, res, next) => {
  try {
    const users = await User.find({}, { passwordHash: 0 });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/invites', async (req, res, next) => {
  try {
    const { email, departmentId } = req.body;
    const invite = await createInvite(email, departmentId);
    const link = `${req.protocol}://${req.get('host')}/chat.html?invite=${invite.token}`;
    res.status(201).json({ invite, link });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/tenant/budget', async (req, res, next) => {
  try {
    const { monthlyBudget } = req.body;
    if (![5000, 10000, 20000].includes(monthlyBudget)) {
      throw new HttpError(400, 'monthlyBudget must be one of 5000, 10000, 20000');
    }
    const ctx = getTenantContext()!;
    await setTenantBudget(ctx.tenantId, monthlyBudget);
    res.json({ monthlyBudget });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/tenant/web-search', async (req, res, next) => {
  try {
    const { enabled } = req.body;
    const ctx = getTenantContext()!;
    await Tenant.updateOne({ _id: ctx.tenantId }, { webSearchEnabled: Boolean(enabled) });
    res.json({ webSearchEnabled: Boolean(enabled) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/usage', async (_req, res, next) => {
  try {
    const [byUser, byDepartment] = await Promise.all([
      Message.aggregate([
        { $match: { role: 'user' } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
      ]),
      Department.find(),
    ]);
    const departments = await Promise.all(
      byDepartment.map(async (d) => ({
        departmentId: d._id,
        name: d.name,
        ...(await departmentUsage(String(d._id), d.monthlyBudget)),
      }))
    );
    res.json({ byUser, byDepartment: departments });
  } catch (err) {
    next(err);
  }
});
