import { z } from 'zod';
import { HOTBAR_SLOTS, ITEMS, type ItemId } from '../../../shared/items.js';
import { NET_ANIMS, CHARACTERS, NAME_MAX, NAME_MIN, NAME_REGEX, ROOM_NAME_MAX, ROOM_NAME_MIN, type ClientMessage } from '../../../shared/protocol.js';

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
  anim: z.enum(NET_ANIMS),
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
const roomReadySchema = z.object({ type: z.literal('room_ready'), ready: z.boolean() });
const setCharacterSchema = z.object({ type: z.literal('set_character'), character: z.enum(CHARACTERS) });

const objectId = z.number().int().nonnegative();
const pickupSchema = z.object({ type: z.literal('pickup'), objectId });
const hitNodeSchema = z.object({ type: z.literal('hit_node'), objectId });
const hitWallSchema = z.object({ type: z.literal('hit_wall'), id: z.number().int().nonnegative() });
const dropItemSchema = z.object({ type: z.literal('drop_item') });
const pickupDropSchema = z.object({ type: z.literal('pickup_drop'), id: z.number().int().nonnegative() });
const selectSlotSchema = z.object({ type: z.literal('select_slot'), index: z.number().int().min(0).max(HOTBAR_SLOTS - 1) });
const sellSchema = z.object({ type: z.literal('sell') });
const buySchema = z.object({ type: z.literal('buy'), itemId: z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]) });
const fireSchema = z.object({ type: z.literal('fire'), dx: finite, dz: finite });
const reloadSchema = z.object({ type: z.literal('reload') });
const meleeSchema = z.object({ type: z.literal('melee'), dx: finite, dz: finite });
const activateBatterySchema = z.object({ type: z.literal('activate_battery') });
const useItemSchema = z.object({ type: z.literal('use_item') });
const buyReviveSchema = z.object({ type: z.literal('buy_revive'), targetId: z.string().uuid() });
const upgradeSchema = z.object({ type: z.literal('upgrade'), kind: z.enum(['damage', 'ammo', 'recoil', 'stamina', 'laser', 'weight']) });
const towerUpgradeSchema = z.object({ type: z.literal('tower_upgrade') });
const towerRepairSchema = z.object({ type: z.literal('tower_repair') });
const buyFeatureSchema = z.object({ type: z.literal('buy_feature'), feature: z.enum(['minimap']) });
const placeWallSchema = z.object({ type: z.literal('place_wall'), x: finite, z: finite, yaw: finite });
const itemIdSchema = z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]]);
const devSchema = z.discriminatedUnion('action', [
  z.object({ type: z.literal('dev'), action: z.literal('money'), amount: z.number().int().min(-100000).max(100000) }),
  z.object({ type: z.literal('dev'), action: z.literal('give'), itemId: itemIdSchema }),
  z.object({ type: z.literal('dev'), action: z.literal('infinite_items'), on: z.boolean() }),
  z.object({ type: z.literal('dev'), action: z.literal('upgrade'), kind: z.enum(['damage', 'ammo', 'recoil', 'stamina', 'laser', 'weight']) }),
  z.object({ type: z.literal('dev'), action: z.literal('tower_upgrade') }),
  z.object({ type: z.literal('dev'), action: z.literal('damage_mult'), value: z.number().min(1).max(1000) }),
  z.object({ type: z.literal('dev'), action: z.literal('heal') }),
  z.object({ type: z.literal('dev'), action: z.literal('kill_zombies') }),
  z.object({ type: z.literal('dev'), action: z.literal('next_wave') }),
  z.object({ type: z.literal('dev'), action: z.literal('spawn_boss') }),
]);

const baseSchema = z.discriminatedUnion('type', [
  joinSchema,
  moveSchema,
  pingSchema,
  pickupSchema,
  dropItemSchema,
  pickupDropSchema,
  hitNodeSchema,
  hitWallSchema,
  selectSlotSchema,
  sellSchema,
  buySchema,
  fireSchema,
  reloadSchema,
  meleeSchema,
  activateBatterySchema,
  useItemSchema,
  buyReviveSchema,
  upgradeSchema,
  placeWallSchema,
  buyFeatureSchema,
  towerUpgradeSchema,
  towerRepairSchema,
  roomListSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomLeaveSchema,
  roomSetVisibilitySchema,
  roomStartSchema,
  roomReadySchema,
  setCharacterSchema,
]);

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'dev') {
    const d = devSchema.safeParse(raw);
    return d.success ? (d.data as ClientMessage) : null;
  }
  const r = baseSchema.safeParse(raw);
  return r.success ? (r.data as ClientMessage) : null;
}
