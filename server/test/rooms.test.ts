import { test } from 'node:test';
import assert from 'node:assert/strict';

// o service importa o Prisma (que exige DATABASE_URL ao carregar); as validações testadas aqui rodam antes de qualquer query
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:1/test';
const { RoomService, RoomServiceError } = await import('../src/services/RoomService.js');
type RoomView = import('../src/services/RoomService.js').RoomView;
type RoomServiceError = InstanceType<typeof RoomServiceError>;

const svc = new RoomService();
const view = (over: Partial<RoomView> = {}): RoomView => ({
  id: 'r1',
  ownerId: 'A',
  visibility: 'PUBLIC',
  code: null,
  status: 'LOBBY',
  memberIds: ['A', 'B'],
  readyIds: [],
  rosterIds: [],
  ...over,
});

test('dono só inicia quando todos marcaram PRONTO', async () => {
  await assert.rejects(svc.start('A', view()), (e: RoomServiceError) => e.code === 'not_all_ready');
  await assert.rejects(svc.start('A', view({ readyIds: ['A'] })), (e: RoomServiceError) => e.code === 'not_all_ready' && e.message.includes('faltam 1'));
  await assert.rejects(svc.start('B', view({ readyIds: ['A', 'B'] })), (e: RoomServiceError) => e.code === 'not_owner');
});

test('partida iniciada: só quem estava na sala pode voltar', async () => {
  const playing = view({ status: 'PLAYING', memberIds: ['A'], rosterIds: ['A', 'B'] });
  await assert.rejects(svc.join('C', playing, undefined, null), (e: RoomServiceError) => e.code === 'room_locked');
  await assert.rejects(svc.join('C', view({ memberIds: ['A'] }), undefined, view()), (e: RoomServiceError) => e.code === 'already_in_room');
});
