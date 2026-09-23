import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { als, TenantContext } from '../context/tenantContext';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as TenantContext;
    als.run({ tenantId: payload.tenantId, userId: payload.userId, role: payload.role }, next);
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
