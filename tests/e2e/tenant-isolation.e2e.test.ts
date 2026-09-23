import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from '../../src/app';
import { Tenant } from '../../src/models/Tenant';
import { Department } from '../../src/models/Department';
import { User } from '../../src/models/User';
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

beforeEach(async () => {
  await Promise.all(
    [Tenant, Department, User].map((m) => (m as any).collection.deleteMany({}))
  );
});

async function makeTenantWithAdmin(name: string) {
  const tenant = await Tenant.create({ name, monthlyBudget: 5000 });
  const tenantId = String(tenant._id);
  const passwordHash = await bcrypt.hash('pw123456', 10);
  await als.run({ tenantId, userId: 'seed', role: 'admin' }, async () =>
    User.create({ tenantId, email: `admin@${name}.demo`, passwordHash, role: 'admin', departmentId: null })
  );
  return tenantId;
}

async function loginAs(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: 'pw123456' });
  return res.body.token as string;
}

describe('tenant isolation (e2e)', () => {
  it('tenant A admin cannot see tenant B users via /admin/users', async () => {
    await makeTenantWithAdmin('acme');
    await makeTenantWithAdmin('beta');

    const tokenA = await loginAs('admin@acme.demo');

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const emails = res.body.map((u: any) => u.email);
    expect(emails).toContain('admin@acme.demo');
    expect(emails).not.toContain('admin@beta.demo');
  });

  it('a regular user gets 403 from an admin-only route', async () => {
    const tenantId = await makeTenantWithAdmin('gamma');
    const passwordHash = await bcrypt.hash('pw123456', 10);
    const dept = await als.run({ tenantId, userId: 'seed', role: 'admin' }, async () =>
      Department.create({ tenantId, name: 'Eng', monthlyBudget: 100 })
    );
    await als.run({ tenantId, userId: 'seed', role: 'admin' }, async () =>
      User.create({ tenantId, email: 'user@gamma.demo', passwordHash, role: 'user', departmentId: dept._id })
    );

    const token = await loginAs('user@gamma.demo');

    const res = await request(app)
      .get('/api/admin/departments')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
