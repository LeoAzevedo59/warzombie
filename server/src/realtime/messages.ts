import { z } from 'zod';
import { NAME_MAX, NAME_MIN, NAME_REGEX, type ClientMessage } from '../../../shared/protocol.js';

/** Validação em runtime do que chega pelo socket — nunca confiar no client. */
const finite = z.number().finite();

const joinSchema = z.object({
  type: z.literal('join'),
  version: z.number().int(),
  name: z.string().min(NAME_MIN).max(NAME_MAX).regex(NAME_REGEX),
});

const moveSchema = z.object({
  type: z.literal('move'),
  x: finite,
  z: finite,
  yaw: finite,
  anim: z.enum(['Idle', 'Walk', 'Run', 'Gun_Shoot']),
  crouching: z.boolean(),
});

const statsSchema = z.object({
  type: z.literal('stats'),
  hp: z.number().int().min(0).max(1000),
  kills: z.number().int().min(0),
});

const pingSchema = z.object({ type: z.literal('ping'), t: finite });

export const clientMessageSchema = z.discriminatedUnion('type', [joinSchema, moveSchema, statsSchema, pingSchema]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const r = clientMessageSchema.safeParse(raw);
  return r.success ? (r.data as ClientMessage) : null;
}
