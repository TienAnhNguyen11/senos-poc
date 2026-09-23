import { Schema, model } from 'mongoose';

// No tenantPlugin — this is a platform-wide singleton, not tenant-scoped.
// Single document (_id: 'platform') so admission-control (setTenantBudget) can
// check-and-increment atomically on ONE document instead of summing across many
// (Mongo's atomicity is per-document, not across an aggregate — see
// take-home-tech-spec.md section 8a for the race condition this replaces).
const platformAllocationSchema = new Schema({
  _id: { type: String, default: 'platform' },
  totalAllocated: { type: Number, default: 0 }, // sum of every active tenant's monthlyBudget
});

export interface PlatformAllocationDoc {
  _id: string;
  totalAllocated: number;
}

export const PlatformAllocation = model<PlatformAllocationDoc>(
  'PlatformAllocation',
  platformAllocationSchema
);
