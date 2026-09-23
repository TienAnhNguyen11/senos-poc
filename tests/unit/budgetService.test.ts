import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Tenant } from '../../src/models/Tenant';
import { Department } from '../../src/models/Department';
import { UsageCounter } from '../../src/models/UsageCounter';
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
});

// PLATFORM_MONTHLY_CAPACITY (100000, from .env) is read once into config/env.ts at
// import time by design (fail-fast on missing config) — so tests exercise it with
// realistic multi-tenant totals rather than mutating process.env after the fact.
describe('setTenantBudget — admission control', () => {
  it('rejects when the new total across all tenants exceeds platform capacity', async () => {
    for (let i = 0; i < 5; i++) {
      await Tenant.create({ name: `T${i}`, monthlyBudget: 20000 }); // 5 x 20000 = 100000, already at cap
    }
    const target = await Tenant.create({ name: 'Target', monthlyBudget: 5000 });

    // others = 100000, + 10000 new = 110000 > 100000 cap
    await expect(setTenantBudget(String(target._id), 10000)).rejects.toThrow(/platform capacity/i);

    const unchanged = await Tenant.findById(target._id);
    expect(unchanged!.monthlyBudget).toBe(5000);
  });

  it('accepts when the new total stays within platform capacity', async () => {
    for (let i = 0; i < 4; i++) {
      await Tenant.create({ name: `T${i}`, monthlyBudget: 20000 }); // 4 x 20000 = 80000
    }
    const target = await Tenant.create({ name: 'Target', monthlyBudget: 5000 });

    // others = 80000, + 10000 new = 90000 <= 100000 cap
    await setTenantBudget(String(target._id), 10000);

    const updated = await Tenant.findById(target._id);
    expect(updated!.monthlyBudget).toBe(10000);
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
