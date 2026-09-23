import { Tenant } from '../models/Tenant';
import { Department } from '../models/Department';
import { UsageCounter } from '../models/UsageCounter';
import { PlatformAllocation } from '../models/PlatformAllocation';
import { env } from '../config/env';
import { HttpError } from '../errors/HttpError';

export function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Ensures the PlatformAllocation singleton exists, backfilled from current tenant
 * budgets. Called once at startup (see server.ts) — matters for redeploys of an
 * already-seeded DB, where tenants exist but this counter doc doesn't yet. */
export async function ensurePlatformAllocationInitialized(): Promise<void> {
  const existing = await PlatformAllocation.findById('platform');
  if (existing) return;
  const [agg] = await Tenant.aggregate([
    { $group: { _id: null, sum: { $sum: '$monthlyBudget' } } },
  ]);
  await PlatformAllocation.updateOne(
    { _id: 'platform' },
    { $setOnInsert: { totalAllocated: agg?.sum ?? 0 } },
    { upsert: true }
  );
}

/** Admission-control: total budget across ALL tenants must never exceed platform
 * capacity. Check-and-increment runs atomically on the single PlatformAllocation
 * document — summing Tenant.monthlyBudget via aggregate and updating separately (the
 * original version) is a TOCTOU race: two admins raising two different tenants'
 * budgets near the cap at the same time can both read "still under cap" and both
 * pass, pushing the real total over. Mongo's atomicity is per-document, not across
 * an aggregate, so the check-and-increment has to happen on one document — same
 * reasoning as checkAndIncrementBudget below. Found via self-review (mock defend),
 * not during initial implementation — see take-home-tech-spec.md section 8a. */
export async function setTenantBudget(tenantId: string, newBudget: number): Promise<void> {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant) throw new HttpError(404, 'Tenant not found');
  const delta = newBudget - tenant.monthlyBudget;

  if (delta > 0) {
    const ok = await PlatformAllocation.findOneAndUpdate(
      { _id: 'platform', totalAllocated: { $lte: env.PLATFORM_MONTHLY_CAPACITY - delta } },
      { $inc: { totalAllocated: delta } }
    );
    if (!ok) throw new HttpError(409, 'Exceeds platform capacity — contact SenOS for a custom plan');
  } else if (delta < 0) {
    await PlatformAllocation.updateOne({ _id: 'platform' }, { $inc: { totalAllocated: delta } });
  }

  // Known gap (acceptable for a PoC): these are two separate writes, not wrapped in
  // a Mongo transaction. A crash between them leaves PlatformAllocation.totalAllocated
  // and the sum of Tenant.monthlyBudget out of sync. A real product would either use
  // a transaction or treat Tenant.monthlyBudget as a cache and PlatformAllocation as
  // the source of truth.
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
