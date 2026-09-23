import { env } from './config/env';
import { connectDb } from './db/connection';
import { app } from './app';
import { seedIfEmpty } from './seed';
import { ensurePlatformAllocationInitialized } from './services/budgetService';

async function main() {
  await connectDb();
  await seedIfEmpty();
  await ensurePlatformAllocationInitialized();
  app.listen(env.PORT, () => {
    console.log(`listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
