import { Schema, model, Types } from 'mongoose';
import { tenantPlugin } from './tenantPlugin';

const inviteSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    email: { type: String, required: true },
    departmentId: { type: Schema.Types.ObjectId, required: true },
    token: { type: String, required: true, unique: true },
    status: { type: String, enum: ['pending', 'accepted'], default: 'pending' },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
inviteSchema.plugin(tenantPlugin);

export interface InviteDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  email: string;
  departmentId: Types.ObjectId;
  token: string;
  status: 'pending' | 'accepted';
  expiresAt: Date;
}

export const Invite = model<InviteDoc>('Invite', inviteSchema);
