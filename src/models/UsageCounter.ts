import { Schema, model, Types } from 'mongoose';
import { tenantPlugin } from './tenantPlugin';

const usageCounterSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, required: true },
  departmentId: { type: Schema.Types.ObjectId, required: true },
  period: { type: String, required: true }, // "2026-09"
  count: { type: Number, default: 0 },
});
usageCounterSchema.index({ tenantId: 1, departmentId: 1, period: 1 }, { unique: true });
usageCounterSchema.plugin(tenantPlugin);

export interface UsageCounterDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  departmentId: Types.ObjectId;
  period: string;
  count: number;
}

export const UsageCounter = model<UsageCounterDoc>('UsageCounter', usageCounterSchema);
