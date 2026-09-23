import { Schema, model, Types } from 'mongoose';
import { tenantPlugin } from './tenantPlugin';

const conversationSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
conversationSchema.plugin(tenantPlugin);

export interface ConversationDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
}

export const Conversation = model<ConversationDoc>('Conversation', conversationSchema);
