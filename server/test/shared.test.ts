import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld, generateChunk, WORLD } from '../../shared/worldgen.js';
import { rayHitNearest } from '../../shared/math.js';

test('worldgen é determinístico e respeita o hub livre', () => {
  const a = generateWorld(1337);
  const b = generateWorld(1337);
  assert.deepEqual([...a.values()], [...b.values()]);
  assert.ok(a.size > 50, `mundo muito vazio: ${a.size}`);
  for (const o of a.values()) {
    const d = Math.hypot(o.x, o.z);
    if (o.kind === 'tree' || o.kind === 'rock') assert.ok(d >= WORLD.HUB_CLEAR_RADIUS, `${o.kind} dentro do hub`);
    assert.ok(d >= 2, 'objeto em cima do spawn');
  }
  assert.notDeepEqual(generateChunk(1, 0, 0), generateChunk(2, 0, 0));
});

test('rayHitNearest acha o alvo mais próximo na linha do tiro', () => {
  const targets = [
    { id: 'longe', position: { x: 8, z: 0.2 } },
    { id: 'perto', position: { x: 3, z: -0.3 } },
    { id: 'fora', position: { x: 4, z: 2 } },
    { id: 'atras', position: { x: -2, z: 0 } },
  ];
  const r = rayHitNearest({ x: 0, z: 0 }, 1, 0, targets, 14, 0.6);
  assert.equal(r.target?.id, 'perto');
  assert.equal(r.t, 3);
  assert.equal(rayHitNearest({ x: 0, z: 0 }, 0, 1, targets, 14, 0.6).target, null);
});
