import { AsyncLocalStorage } from 'async_hooks';

export interface TenantContext {
  tenantId: string;
  userId: string;
  role: 'admin' | 'user';
}

export const als = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return als.getStore();
}

// Sentinel tenantId marking a deliberate cross-tenant bypass — the ONLY exceptions
// to fail-closed isolation: login-by-email (email is unique globally, so we must
// look up the user before we know their tenant) and the seed script (creates
// multiple tenants). Never used for regular request handling.
export const SYSTEM_BYPASS = '__system__';

// `fn` must be awaited INSIDE the callback we pass to als.run. Mongoose queries
// (e.g. `Model.findOne()`) are lazy thenables that only actually execute (and run
// their pre-hooks) when `.then()`/`.exec()` is called — if we returned the bare
// query and let the caller `await` it, that `.then()` call happens after als.run's
// synchronous callback has already returned, outside the AsyncLocalStorage context,
// and the tenantPlugin hook sees no context at all. Awaiting here keeps it inside.
export async function runAsSystem<T>(fn: () => T | Promise<T>): Promise<T> {
  return als.run({ tenantId: SYSTEM_BYPASS, userId: SYSTEM_BYPASS, role: 'admin' }, async () => fn());
}
