import { Schema, model, Types } from 'mongoose';
import { tenantPlugin } from './tenantPlugin';

const departmentSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    name: { type: String, required: true },
    monthlyBudget: { type: Number, required: true }, // free-form, sum must be <= Tenant.monthlyBudget
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
departmentSchema.plugin(tenantPlugin);

export interface DepartmentDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  name: string;
  monthlyBudget: number;
}

export const Department = model<DepartmentDoc>('Department', departmentSchema);
