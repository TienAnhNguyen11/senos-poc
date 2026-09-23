import bcrypt from 'bcrypt';
import { Tenant } from './models/Tenant';
import { Department } from './models/Department';
import { User } from './models/User';
import { als } from './context/tenantContext';

interface SeedTenant {
  name: string;
  monthlyBudget: 5000 | 10000 | 20000;
  adminEmail: string;
  departments: { name: string; monthlyBudget: number }[];
  users: { email: string; departmentIndex: number }[];
}

const DEMO_PASSWORD = 'demo1234';

const SEED_TENANTS: SeedTenant[] = [
  {
    name: 'Acme Corp',
    monthlyBudget: 5000,
    adminEmail: 'admin@acme.demo',
    departments: [{ name: 'Engineering', monthlyBudget: 8 }],
    users: [{ email: 'user@acme.demo', departmentIndex: 0 }],
  },
  {
    name: 'Beta Inc',
    monthlyBudget: 10000,
    adminEmail: 'admin@beta.demo',
    departments: [{ name: 'Sales', monthlyBudget: 8 }],
    users: [{ email: 'user@beta.demo', departmentIndex: 0 }],
  },
];

export async function seedIfEmpty(): Promise<void> {
  if ((await Tenant.countDocuments()) > 0) {
    console.log('Seed skipped: data already present');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  for (const seedTenant of SEED_TENANTS) {
    const tenant = await Tenant.create({
      name: seedTenant.name,
      monthlyBudget: seedTenant.monthlyBudget,
      webSearchEnabled: true,
    });
    const tenantId = String(tenant._id);

    await als.run({ tenantId, userId: 'seed', role: 'admin' }, async () => {
      const departments = await Department.insertMany(
        seedTenant.departments.map((d) => ({ ...d, tenantId }))
      );

      await User.create({
        tenantId,
        email: seedTenant.adminEmail,
        passwordHash,
        role: 'admin',
        departmentId: null,
      });

      for (const u of seedTenant.users) {
        await User.create({
          tenantId,
          email: u.email,
          passwordHash,
          role: 'user',
          departmentId: departments[u.departmentIndex]._id,
        });
      }
    });

    console.log(`Seeded tenant "${seedTenant.name}" — admin: ${seedTenant.adminEmail} / ${DEMO_PASSWORD}`);
  }
}
