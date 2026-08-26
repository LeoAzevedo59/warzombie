import { z } from 'zod';
import { HOTBAR_SLOTS, ITEMS, type ItemId } from '../../../shared/items.js';
import { NAME_MAX, NAME_MIN, NAME_REGEX, ROOM_NAME_MAX, ROOM_NAME_MIN, type ClientMessage } from '../../../shared/protocol.js';

/** Validação em runtime do que chega pelo socket — nunca confiar no client. */
const finite = z.number().finite();
const visibility = z.enum(['PUBLIC', 'PRIVATE']);

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
  anim: z.enum(['Idle', 'Walk', 'Run', 'Gun_Shoot', 'Death']),
  crouching: z.boolean(),
});

const pingSchema = z.object({ type: z.literal('ping'), t: finite });

const roomListSchema = z.object({ type: z.literal('room_list') });
const roomCreateSchema = z.object({
  type: z.literal('room_create'),
  name: z.string().min(ROOM_NAME_MIN).max(ROOM_NAME_MAX).regex(NAME_REGEX),
  visibility,
});
const roomJoinSchema = z.object({
  type: z.literal('room_join'),
  roomId: z.string().uuid(),
  code: z.string().regex(/^\d{4}$/).optional(),
});
const roomLeaveSchema = z.object({ type: z.literal('room_leave') });
const roomSetVisibilitySchema = z.object({ type: z.literal('room_set_visibility'), visibility });
const roomStartSchema = z.object({ type: z.literal('room_start') });

const objectId = z.number().int().nonnegative();
const pickupSchema = z.object({ type: z.literal('pickup'), objectId });
const hitNodeSchema = z.object({ type: z.literal('hit_node'), objectId });
const selectSlotSchema = z.object({ type: z.literal('select_slot'), index: z.number().int().min(0).max(HOTBAR_SLOTS - 1) });
const sellSchema = z.object({ type: z.literal('sell') });
const buySchema = z.object({ type: z.literal('buy'), itemId: z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]) });
const fireSchema = z.object({ type: z.literal('fire'), dx: finite, dz: finite });
const reloadSchema = z.object({ type: z.literal('reload') });

export const clientMessageSchema = z.discriminatedUnion('type', [
  joinSchema,
  moveSchema,
  pingSchema,
  pickupSchema,
  hitNodeSchema,
  selectSlotSchema,
  sellSchema,
  buySchema,
  fireSchema,
  reloadSchema,
  roomListSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomLeaveSchema,
  roomSetVisibilitySchema,
  roomStartSchema,
]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
  const r = clientMessageSchema.safeParse(raw);
  return r.success ? (r.data as ClientMessage) : null;
}
