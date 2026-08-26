import type { NextFunction, Request, Response } from 'express';
import { createLogger } from '../lib/logger.js';

const log = createLogger('http');

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  log.error('erro não tratado', err);
  res.status(500).json({ error: 'internal_error' });
}
