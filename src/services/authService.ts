import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { User } from '../models/User';
import { runAsSystem } from '../context/tenantContext';
import { HttpError } from '../errors/HttpError';

export async function login(email: string, password: string): Promise<string> {
  // Email is unique globally by design (see take-home-tech-spec.md section 4) so we
  // must look the user up before we know their tenant — the one legitimate
  // cross-tenant read outside of seeding.
  const user = await runAsSystem(() => User.findOne({ email }));
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  return jwt.sign(
    { tenantId: String(user.tenantId), userId: String(user._id), role: user.role },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}
