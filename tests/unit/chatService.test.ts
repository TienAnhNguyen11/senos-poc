import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// vi.mock is hoisted above imports by vitest — chatService constructs its Anthropic
// client at module load time, so the real SDK must never load in this test file.
// Referencing `mockStream` here is safe because vitest specifically allows
// variables prefixed with `mock` inside a vi.mock factory (hoisting-safe).
const mockStream = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { stream: mockStream };
  },
}));

import { Tenant } from '../../src/models/Tenant';
import { Department } from '../../src/models/Department';
import { User } from '../../src/models/User';
import { Conversation } from '../../src/models/Conversation';
import { Message } from '../../src/models/Message';
import { UsageCounter } from '../../src/models/UsageCounter';
import { als } from '../../src/context/tenantContext';
import { streamMessage } from '../../src/services/chatService';

function fakeAnthropicStream(replyText = 'mock reply', webSearchRequests = 0) {
  return {
    on: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: replyText }],
      usage: {
        server_tool_use: webSearchRequests > 0 ? { web_search_requests: webSearchRequests, web_fetch_requests: 0 } : null,
      },
    }),
  };
}

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Tenant, Department, User, Conversation, Message, UsageCounter].map((m) =>
      (m as unknown as { collection: { deleteMany: (f: object) => Promise<unknown> } }).collection.deleteMany({})
    )
  );
  mockStream.mockReset();
  mockStream.mockReturnValue(fakeAnthropicStream());
});

async function setupTenant(deptCap: number) {
  const tenant = await Tenant.create({ name: 'Acme', monthlyBudget: 5000, webSearchEnabled: false });
  const tenantId = String(tenant._id);
  return als.run({ tenantId, userId: 'setup', role: 'admin' }, async () => {
    const dept = await Department.create({ tenantId, name: 'Eng', monthlyBudget: deptCap });
    const user = await User.create({
      tenantId,
      email: 'user@acme.demo',
      passwordHash: 'x',
      role: 'user',
      departmentId: dept._id,
    });
    const admin = await User.create({
      tenantId,
      email: 'admin@acme.demo',
      passwordHash: 'x',
      role: 'admin',
      departmentId: null,
    });
    return { tenantId, deptId: String(dept._id), userId: String(user._id), adminId: String(admin._id) };
  });
}

describe('streamMessage — budget gate runs before Claude is ever called', () => {
  it('blocks a user over budget and never calls Claude', async () => {
    const { tenantId, userId } = await setupTenant(0); // cap 0 -> immediately blocked
    await als.run({ tenantId, userId, role: 'user' }, async () => {
      await expect(streamMessage('hi', () => {})).rejects.toThrow(/budget/i);
    });
    expect(mockStream).not.toHaveBeenCalled();
  });

  it('lets a user under budget through and calls Claude exactly once', async () => {
    const { tenantId, userId } = await setupTenant(10);
    await als.run({ tenantId, userId, role: 'user' }, async () => {
      const result = await streamMessage('hi', () => {});
      expect(result.reply).toBe('mock reply');
    });
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it('never budget-checks an admin, even when the department is fully out of budget', async () => {
    const { tenantId, adminId } = await setupTenant(0);
    await als.run({ tenantId, userId: adminId, role: 'admin' }, async () => {
      const result = await streamMessage('hi', () => {});
      expect(result.reply).toBe('mock reply');
    });
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it('rejects a user with no department assigned, without calling Claude', async () => {
    const tenant = await Tenant.create({ name: 'Acme2', monthlyBudget: 5000 });
    const tenantId = String(tenant._id);
    const userId = await als.run({ tenantId, userId: 'setup', role: 'admin' }, async () => {
      const u = await User.create({
        tenantId,
        email: 'nodept@acme.demo',
        passwordHash: 'x',
        role: 'user',
        departmentId: null,
      });
      return String(u._id);
    });
    await als.run({ tenantId, userId, role: 'user' }, async () => {
      await expect(streamMessage('hi', () => {})).rejects.toThrow(/department/i);
    });
    expect(mockStream).not.toHaveBeenCalled();
  });
});

describe('streamMessage — history sent to Claude', () => {
  it('caps history to the most recent MAX_HISTORY_MESSAGES and marks the tail cacheable', async () => {
    const { tenantId, deptId, userId } = await setupTenant(1000);
    const conversation = await als.run({ tenantId, userId, role: 'user' }, () => Conversation.create({ userId }));

    // Seed 25 prior messages (> the 20-message cap), with explicit increasing
    // createdAt so ordering is deterministic regardless of how fast the loop runs.
    const base = Date.now() - 100000;
    await als.run({ tenantId, userId, role: 'user' }, async () => {
      for (let i = 0; i < 25; i++) {
        await Message.create({
          conversationId: conversation._id,
          userId,
          departmentId: deptId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `msg-${i}`,
          usedWebSearch: false,
          createdAt: new Date(base + i * 1000),
        });
      }
    });

    await als.run({ tenantId, userId, role: 'user' }, () => streamMessage('new message', () => {}));

    expect(mockStream).toHaveBeenCalledTimes(1);
    const [params] = mockStream.mock.calls[0];

    // Last 20 of 25 seeded (msg-5..msg-24) + the new user message = 21 entries.
    expect(params.messages).toHaveLength(21);
    expect(params.messages[0].content).toBe('msg-5');
    expect(params.messages[18].content).toBe('msg-23');

    // The last historical message (msg-24, index 19) carries the cache breakpoint.
    const cachedEntry = params.messages[19];
    expect(Array.isArray(cachedEntry.content)).toBe(true);
    expect(cachedEntry.content[0]).toMatchObject({ text: 'msg-24', cache_control: { type: 'ephemeral' } });

    // The brand-new message is appended last, as a plain string, uncached.
    expect(params.messages[20]).toEqual({ role: 'user', content: 'new message' });
  });

  // Regression: insertMany stamps the user message and the assistant reply with the
  // SAME createdAt, and MongoDB won't order ties stably — so sorting on createdAt
  // alone returned replies before their own questions, leaving two user messages
  // adjacent. The API merges adjacent same-role messages, so Claude received the
  // previous question and the new one as a single turn and answered both.
  // Note the test above seeds messages 1s apart, which accidentally sidesteps the
  // tie entirely — that is exactly why it never caught this.
  it('keeps each turn in question-then-answer order when timestamps collide', async () => {
    const { tenantId, deptId, userId } = await setupTenant(1000);
    const conversation = await als.run({ tenantId, userId, role: 'user' }, () => Conversation.create({ userId }));

    // Two completed turns, each written the way insertMany writes them: both
    // messages of a turn sharing one timestamp.
    const turns = [
      { at: new Date('2026-09-24T10:00:00.000Z'), q: 'can penguins fly?', a: 'No, they cannot.' },
      { at: new Date('2026-09-24T10:00:05.000Z'), q: 'can they swim?', a: 'Yes, they can.' },
    ];
    for (const turn of turns) {
      await als.run({ tenantId, userId, role: 'user' }, async () =>
        Message.insertMany([
        {
          tenantId,
          conversationId: conversation._id,
          userId,
          departmentId: deptId,
          role: 'user' as const,
          content: turn.q,
          usedWebSearch: false,
          createdAt: turn.at,
        },
        {
          tenantId,
          conversationId: conversation._id,
          userId,
          departmentId: deptId,
          role: 'assistant' as const,
          content: turn.a,
          usedWebSearch: false,
          createdAt: turn.at,
        },
        ])
      );
    }

    await als.run({ tenantId, userId, role: 'user' }, () =>
      streamMessage('do they run faster than a cheetah?', () => {})
    );

    const [params] = mockStream.mock.calls[0];
    const textOf = (m: { content: string | Array<{ text: string }> }) =>
      typeof m.content === 'string' ? m.content : m.content[0].text;

    expect(params.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant',
      'user',
    ]);
    expect(params.messages.map(textOf)).toEqual([
      'can penguins fly?',
      'No, they cannot.',
      'can they swim?',
      'Yes, they can.',
      'do they run faster than a cheetah?',
    ]);
  });

  it('persists both the user message and the assistant reply after a successful send', async () => {
    const { tenantId, userId } = await setupTenant(1000);
    mockStream.mockReturnValue(fakeAnthropicStream('the answer', 1));

    await als.run({ tenantId, userId, role: 'user' }, () => streamMessage('the question', () => {}));

    const saved = await als.run({ tenantId, userId, role: 'user' }, async () =>
      Message.find().sort({ createdAt: 1 })
    );
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ role: 'user', content: 'the question', usedWebSearch: false });
    expect(saved[1]).toMatchObject({ role: 'assistant', content: 'the answer', usedWebSearch: true });
  });

  // The question is persisted before the provider call, so a failure can't throw it
  // away — the budget for it was already spent, and silently losing it made the
  // department's usage counter and the per-user message count disagree for good.
  it('keeps the user message when the provider call fails', async () => {
    const { tenantId, userId } = await setupTenant(1000);
    mockStream.mockReturnValue({
      on: vi.fn(),
      finalMessage: vi.fn().mockRejectedValue(new Error('provider exploded')),
    });

    await als.run({ tenantId, userId, role: 'user' }, async () => {
      await expect(streamMessage('a question that gets no answer', () => {})).rejects.toThrow(
        /provider exploded/
      );
    });

    const saved = await als.run({ tenantId, userId, role: 'user' }, async () => Message.find());
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ role: 'user', content: 'a question that gets no answer' });
  });
});
