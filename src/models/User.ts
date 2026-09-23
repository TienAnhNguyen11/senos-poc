import { Schema, model, Types } from 'mongoose';
import { tenantPlugin } from './tenantPlugin';

const userSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    email: { type: String, required: true, unique: true }, // unique global — simplifies login lookup
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user'], required: true },
    departmentId: { type: Schema.Types.ObjectId, default: null }, // required if role=user, null for admin
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
userSchema.plugin(tenantPlugin);

export interface UserDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  departmentId: Types.ObjectId | null;
}

export const User = model<UserDoc>('User', userSchema);
