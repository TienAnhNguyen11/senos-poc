import { Schema, model, Types } from 'mongoose';
import { tenantPlugin } from './tenantPlugin';

const messageSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    departmentId: { type: Schema.Types.ObjectId, default: null }, // denormalized for admin rollup-by-dept
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    usedWebSearch: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
messageSchema.plugin(tenantPlugin);

export interface MessageDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  departmentId: Types.ObjectId | null;
  role: 'user' | 'assistant';
  content: string;
  usedWebSearch: boolean;
  createdAt: Date;
}

export const Message = model<MessageDoc>('Message', messageSchema);
