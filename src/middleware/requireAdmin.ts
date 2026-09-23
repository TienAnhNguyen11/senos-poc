import { Request, Response, NextFunction } from 'express';
import { getTenantContext } from '../context/tenantContext';

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (getTenantContext()?.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
