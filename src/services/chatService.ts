import Anthropic from '@anthropic-ai/sdk';
import { Tenant } from '../models/Tenant';
import { User } from '../models/User';
import { Conversation } from '../models/Conversation';
import { Message } from '../models/Message';
import { checkAndIncrementBudget } from './budgetService';
import { getTenantContext } from '../context/tenantContext';
import { env } from '../config/env';
import { HttpError } from '../errors/HttpError';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

async function getOrCreateConversation(userId: string) {
  const existing = await Conversation.findOne({ userId });
  if (existing) return existing;
  return Conversation.create({ userId });
}

export interface SendMessageResult {
  reply: string;
  usedWebSearch: boolean;
  warn: boolean;
}

export async function streamMessage(
  content: string,
  onDelta: (text: string) => void
): Promise<SendMessageResult> {
  const ctx = getTenantContext()!;
  const user = await User.findById(ctx.userId);
  if (!user) throw new HttpError(401, 'Unauthorized');

  // Admin is not budget-limited in this PoC (see take-home-assumptions.md, "Things
  // that go wrong" — deliberate gap, admin could self-abuse, not handled here).
  // This check runs BEFORE the stream starts, so a blocked request never touches
  // Claude and never writes a byte of the streaming response.
  let warn = false;
  if (ctx.role === 'user') {
    if (!user.departmentId) throw new HttpError(400, 'User has no department assigned');
    const budget = await checkAndIncrementBudget(ctx.tenantId, String(user.departmentId));
    if (budget.blocked) throw new HttpError(429, "Department has used up this month's budget");
    warn = budget.warn;
  }

  const tenant = await Tenant.findById(ctx.tenantId);
  const conversation = await getOrCreateConversation(ctx.userId);
  const history = await Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 });

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    messages: [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content },
    ],
    tools: tenant?.webSearchEnabled ? [{ type: 'web_search_20260318', name: 'web_search' }] : undefined,
  });

  stream.on('text', onDelta);

  const finalMessage = await stream.finalMessage();

  const reply = finalMessage.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  const usedWebSearch = (finalMessage.usage.server_tool_use?.web_search_requests ?? 0) > 0;

  await Message.insertMany([
    {
      tenantId: ctx.tenantId,
      conversationId: conversation._id,
      userId: user._id,
      departmentId: user.departmentId,
      role: 'user' as const,
      content,
      usedWebSearch: false,
    },
    {
      tenantId: ctx.tenantId,
      conversationId: conversation._id,
      userId: user._id,
      departmentId: user.departmentId,
      role: 'assistant' as const,
      content: reply,
      usedWebSearch,
    },
  ]);

  return { reply, usedWebSearch, warn };
}

export async function getHistory() {
  const ctx = getTenantContext()!;
  const conversation = await getOrCreateConversation(ctx.userId);
  return Message.find({ conversationId: conversation._id }).sort({ createdAt: 1 });
}
