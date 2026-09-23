import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { HydratedDocument } from 'mongoose';
import { env } from '../config/env';
import { Invite, InviteDoc } from '../models/Invite';
import { User } from '../models/User';
import { als, getTenantContext, runAsSystem } from '../context/tenantContext';
import { HttpError } from '../errors/HttpError';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvite(email: string, departmentId: string) {
  const ctx = getTenantContext()!; // route requires admin auth, context always present here
  return Invite.create({
    tenantId: ctx.tenantId,
    email,
    departmentId,
    token: crypto.randomBytes(32).toString('hex'),
    status: 'pending',
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
}

async function findValidInvite(token: string): Promise<HydratedDocument<InviteDoc>> {
  const invite = await runAsSystem(() => Invite.findOne({ token, status: 'pending' }));
  if (!invite || invite.expiresAt < new Date()) {
    throw new HttpError(404, 'Invite not found or expired');
  }
  return invite;
}

export async function getInviteEmail(token: string): Promise<string> {
  const invite = await findValidInvite(token);
  return invite.email;
}

export async function acceptInvite(token: string, password: string): Promise<string> {
  const invite = await findValidInvite(token);
  const passwordHash = await bcrypt.hash(password, 10);
  const tenantId = String(invite.tenantId);

  const user = await als.run({ tenantId, userId: 'invite-flow', role: 'user' }, async () =>
    User.create({
      tenantId,
      email: invite.email,
      passwordHash,
      role: 'user',
      departmentId: invite.departmentId,
    })
  );

  invite.status = 'accepted';
  await runAsSystem(() => invite.save());

  return jwt.sign({ tenantId, userId: String(user._id), role: 'user' }, env.JWT_SECRET, {
    expiresIn: '7d',
  });
}
