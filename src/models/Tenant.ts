import { Schema, model } from 'mongoose';

// No tenantPlugin — this IS the tenant root, it has no tenantId to filter by.
const tenantSchema = new Schema(
  {
    name: { type: String, required: true },
    monthlyBudget: { type: Number, enum: [5000, 10000, 20000], required: true },
    webSearchEnabled: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Tenant = model('Tenant', tenantSchema);
