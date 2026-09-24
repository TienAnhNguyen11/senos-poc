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

// Replaying the full conversation on every turn (required — the Messages API is
// stateless) means cost and latency both grow with conversation length. Two
// independent mitigations: cap how much history we resend at all, and mark the
// tail of what we do resend as a prompt-cache breakpoint so unchanged history
// is billed once (cache read) instead of at full input-token price on every
// subsequent turn — same mechanism real chat products (and Claude Code itself)
// use for exactly this problem.
const MAX_HISTORY_MESSAGES = 20;

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
  const recentHistory = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(MAX_HISTORY_MESSAGES);
  const history = recentHistory.reverse(); // back to chronological order

  const historyParams: Anthropic.MessageParam[] = history.map((m, i) =>
    i === history.length - 1
      ? { role: m.role, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
      : { role: m.role, content: m.content }
  );

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    messages: [...historyParams, { role: 'user' as const, content }],
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
