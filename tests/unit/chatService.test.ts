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
});
