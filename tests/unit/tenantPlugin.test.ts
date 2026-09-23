import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Department } from '../../src/models/Department';
import { als } from '../../src/context/tenantContext';

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('tenantPlugin', () => {
  it('fails closed: query without tenant context throws instead of returning data', async () => {
    await expect(Department.find()).rejects.toThrow(/tenant context/i);
  });

  it('fails closed: save without tenant context throws', async () => {
    await expect(new Department({ name: 'X', monthlyBudget: 100 }).save()).rejects.toThrow(
      /tenant context/i
    );
  });

  it('scopes reads to the tenant in context and does not leak across tenants', async () => {
    const tenantA = new mongoose.Types.ObjectId().toString();
    const tenantB = new mongoose.Types.ObjectId().toString();

    await als.run({ tenantId: tenantA, userId: 'u1', role: 'admin' }, async () => {
      await Department.create({ name: 'A-dept', monthlyBudget: 100 });
    });

    await als.run({ tenantId: tenantB, userId: 'u2', role: 'admin' }, async () => {
      const results = await Department.find();
      expect(results).toHaveLength(0);
    });

    await als.run({ tenantId: tenantA, userId: 'u1', role: 'admin' }, async () => {
      const results = await Department.find();
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('A-dept');
    });
  });
});
