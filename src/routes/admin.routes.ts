import { Router } from 'express';
import { Department } from '../models/Department';
import { User } from '../models/User';
import { Invite } from '../models/Invite';
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

adminRouter.patch('/departments/:id', async (req, res, next) => {
  try {
    const { name, monthlyBudget } = req.body;
    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (monthlyBudget !== undefined) update.monthlyBudget = monthlyBudget;
    const department = await Department.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!department) throw new HttpError(404, 'Department not found');
    res.json(department);
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

// Deletes the User doc so no new login is possible. Known gap: JWT auth is
// stateless (no revocation list), so a token already issued to this user keeps
// working until it expires (up to 7 days) — see README "known gaps".
adminRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const ctx = getTenantContext()!;
    if (req.params.id === ctx.userId) {
      throw new HttpError(400, "You can't remove your own account");
    }
    const result = await User.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) throw new HttpError(404, 'User not found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/invites', async (_req, res, next) => {
  try {
    const invites = await Invite.find().sort({ createdAt: -1 });
    res.json(invites);
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

adminRouter.delete('/invites/:id', async (req, res, next) => {
  try {
    const invite = await Invite.findById(req.params.id);
    if (!invite) throw new HttpError(404, 'Invite not found');
    if (invite.status !== 'pending') {
      throw new HttpError(400, 'Only pending invites can be revoked');
    }
    await Invite.deleteOne({ _id: req.params.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/tenant', async (_req, res, next) => {
  try {
    const ctx = getTenantContext()!;
    const tenant = await Tenant.findById(ctx.tenantId);
    if (!tenant) throw new HttpError(404, 'Tenant not found');
    res.json({ monthlyBudget: tenant.monthlyBudget, webSearchEnabled: tenant.webSearchEnabled });
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
