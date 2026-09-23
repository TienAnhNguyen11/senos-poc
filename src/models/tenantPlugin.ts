import { Schema } from 'mongoose';
import { getTenantContext, SYSTEM_BYPASS } from '../context/tenantContext';

/**
 * Injects and enforces tenantId on every tenant-scoped model. Fail-closed:
 * any query/save run without an AsyncLocalStorage context throws, instead of
 * silently returning cross-tenant data. See take-home-tech-spec.md section 7.
 */
export function tenantPlugin(schema: Schema) {
  schema.pre(/^find/, function (this: any) {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('No tenant context — fail closed');
    if (ctx.tenantId === SYSTEM_BYPASS) return;
    this.where({ tenantId: ctx.tenantId });
  });

  // pre('validate'), not pre('save'): schema validation (tenantId required) runs
  // before the 'save' hook chain, so injecting there would be too late.
  schema.pre('validate', function (this: any) {
    const ctx = getTenantContext();
    if (!ctx) throw new Error('No tenant context — fail closed');
    if (ctx.tenantId === SYSTEM_BYPASS) return;
    if (!this.tenantId) this.tenantId = ctx.tenantId;
  });
}
