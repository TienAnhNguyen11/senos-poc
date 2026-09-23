import { Types } from 'mongoose';
import { Tenant } from '../models/Tenant';
import { Department } from '../models/Department';
import { UsageCounter } from '../models/UsageCounter';
import { env } from '../config/env';
import { HttpError } from '../errors/HttpError';

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Admission-control: total budget across ALL tenants must never exceed platform capacity. */
export async function setTenantBudget(tenantId: string, newBudget: number): Promise<void> {
  const [agg] = await Tenant.aggregate([
    { $match: { _id: { $ne: new Types.ObjectId(tenantId) } } },
    { $group: { _id: null, sum: { $sum: '$monthlyBudget' } } },
  ]);
  const total = (agg?.sum ?? 0) + newBudget;
  if (total > env.PLATFORM_MONTHLY_CAPACITY) {
    throw new HttpError(409, 'Exceeds platform capacity — contact SenOS for a custom plan');
  }
  await Tenant.updateOne({ _id: tenantId }, { monthlyBudget: newBudget });
}

export interface BudgetCheckResult {
  blocked: boolean;
  warn: boolean;
}

/** Atomic pool check: findOneAndUpdate's filter condition makes this a single
 * atomic increment-and-check, so two concurrent requests near the cap can't both
 * slip through (see take-home-assumptions.md, "Centralised key / cost & trust"). */
export async function checkAndIncrementBudget(
  tenantId: string,
  departmentId: string
): Promise<BudgetCheckResult> {
  const dept = await Department.findById(departmentId);
  if (!dept) throw new HttpError(404, 'Department not found');

  const period = currentPeriod();

  // Ensure the counter row exists first, separately from the gated increment below.
  // Combining "upsert" with a `count: {$lt: cap}` filter in one findOneAndUpdate (as
  // in the tech-spec pseudocode) breaks once the counter is already at/over cap: no
  // document matches the filter, so Mongo tries to INSERT a new one — which collides
  // with the existing (tenantId, departmentId, period) unique index and throws
  // E11000 instead of returning "blocked". Caught by tests/unit/budgetService.test.ts.
  try {
    await UsageCounter.updateOne(
      { tenantId, departmentId, period },
      { $setOnInsert: { count: 0 } },
      { upsert: true }
    );
  } catch (err: any) {
    if (err?.code !== 11000) throw err; // lost a concurrent first-insert race — fine, row exists now
  }

  const counter = await UsageCounter.findOneAndUpdate(
    { tenantId, departmentId, period, count: { $lt: dept.monthlyBudget } },
    { $inc: { count: 1 } },
    { returnDocument: 'after' }
  );

  if (!counter) return { blocked: true, warn: false };
  return { blocked: false, warn: counter.count >= dept.monthlyBudget * 0.8 };
}

export async function departmentUsage(departmentId: string, monthlyBudget: number) {
  const counter = await UsageCounter.findOne({ departmentId, period: currentPeriod() });
  return { count: counter?.count ?? 0, monthlyBudget };
}
