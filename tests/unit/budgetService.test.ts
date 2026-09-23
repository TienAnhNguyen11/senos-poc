import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Tenant } from '../../src/models/Tenant';
import { Department } from '../../src/models/Department';
import { UsageCounter } from '../../src/models/UsageCounter';
import { PlatformAllocation } from '../../src/models/PlatformAllocation';
import { als } from '../../src/context/tenantContext';
import { setTenantBudget, checkAndIncrementBudget } from '../../src/services/budgetService';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Tenant.deleteMany({});
  await Department.collection.deleteMany({});
  await UsageCounter.collection.deleteMany({});
  await PlatformAllocation.collection.deleteMany({});
});

// PLATFORM_MONTHLY_CAPACITY (100000, from .env) is read once into config/env.ts at
// import time by design (fail-fast on missing config). Admission-control now
// check-increments a single PlatformAllocation document instead of summing
// Tenant.monthlyBudget via aggregate — the aggregate version was a TOCTOU race
// (two concurrent budget raises could both read "under cap" and both pass); see
// take-home-tech-spec.md section 8a. Tests seed PlatformAllocation directly so
// each case's starting "total already committed to other tenants" is explicit.
describe('setTenantBudget — admission control', () => {
  it('rejects when the new total would exceed platform capacity, leaving the counter untouched', async () => {
    const target = await Tenant.create({ name: 'Target', monthlyBudget: 5000 });
    await PlatformAllocation.create({ _id: 'platform', totalAllocated: 95000 }); // committed to other tenants

    // delta = 20000 - 5000 = 15000; 95000 + 15000 = 110000 > 100000 cap
    await expect(setTenantBudget(String(target._id), 20000)).rejects.toThrow(/platform capacity/i);

    const unchangedTenant = await Tenant.findById(target._id);
    expect(unchangedTenant!.monthlyBudget).toBe(5000);
    const unchangedAllocation = await PlatformAllocation.findById('platform');
    expect(unchangedAllocation!.totalAllocated).toBe(95000); // the atomic check must not have partially applied
  });

  it('accepts and atomically increments the counter when within capacity', async () => {
    const target = await Tenant.create({ name: 'Target', monthlyBudget: 5000 });
    await PlatformAllocation.create({ _id: 'platform', totalAllocated: 60000 });

    // delta = 20000 - 5000 = 15000; 60000 + 15000 = 75000 <= 100000 cap
    await setTenantBudget(String(target._id), 20000);

    const updatedTenant = await Tenant.findById(target._id);
    expect(updatedTenant!.monthlyBudget).toBe(20000);
    const updatedAllocation = await PlatformAllocation.findById('platform');
    expect(updatedAllocation!.totalAllocated).toBe(75000);
  });

  it('always allows lowering a budget, decrementing the counter with no capacity check', async () => {
    const target = await Tenant.create({ name: 'Target', monthlyBudget: 20000 });
    await PlatformAllocation.create({ _id: 'platform', totalAllocated: 100000 }); // already at cap

    await setTenantBudget(String(target._id), 5000);

    const updatedTenant = await Tenant.findById(target._id);
    expect(updatedTenant!.monthlyBudget).toBe(5000);
    const updatedAllocation = await PlatformAllocation.findById('platform');
    expect(updatedAllocation!.totalAllocated).toBe(85000); // 100000 - 15000
  });
});

describe('checkAndIncrementBudget — atomic pool check', () => {
  const CAP = 5;

  async function withTenantDept<T>(fn: (tenantId: string, deptId: string) => Promise<T>) {
    const tenantId = new mongoose.Types.ObjectId().toString();
    return als.run({ tenantId, userId: 'u1', role: 'admin' }, async () => {
      const dept = await Department.create({ name: 'Eng', monthlyBudget: CAP });
      return fn(tenantId, String(dept._id));
    });
  }

  it('warns at 80% and blocks the (N+1)th request after N == cap', async () => {
    await withTenantDept(async (tenantId, deptId) => {
      const results = [];
      for (let i = 0; i < CAP; i++) {
        results.push(await checkAndIncrementBudget(tenantId, deptId));
      }
      // 5th of 5 (>= 80% of 5 = 4) should warn, none blocked yet
      expect(results.every((r) => !r.blocked)).toBe(true);
      expect(results[results.length - 1].warn).toBe(true);

      const blockedResult = await checkAndIncrementBudget(tenantId, deptId);
      expect(blockedResult.blocked).toBe(true);
    });
  });
});
