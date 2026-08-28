import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem, buy, canFit, emptyHotbar, sellAll } from '../src/game/Economy.js';
import { ITEMS } from '../../shared/items.js';

test('addItem empilha até stackMax e devolve o que não coube', () => {
  const h = emptyHotbar();
  assert.equal(addItem(h, 'stick', 25), 0);
  assert.deepEqual(h[0], { itemId: 'stick', count: 20 });
  assert.deepEqual(h[1], { itemId: 'stick', count: 5 });
  // ferramentas não empilham
  assert.equal(addItem(h, 'axe', 1), 0);
  assert.equal(addItem(h, 'axe', 1), 0);
  assert.equal(addItem(h, 'axe', 1), 0);
  assert.equal(addItem(h, 'axe', 1), 1); // 5 slots cheios
});

test('sellAll vende só recursos e mantém ferramentas', () => {
  const h = emptyHotbar();
  addItem(h, 'stick', 10);
  addItem(h, 'wood', 3);
  addItem(h, 'axe', 1);
  const { total } = sellAll(h);
  assert.equal(total, 10 * 1 + 3 * 5);
  assert.deepEqual(h.filter(Boolean), [{ itemId: 'axe', count: 1 }]);
});

test('buy valida dinheiro, slot e item à venda', () => {
  const h = emptyHotbar();
  assert.deepEqual(buy(h, 10, 'glock'), { ok: false, code: 'not_enough_money' });
  assert.deepEqual(buy(h, 100, 'stick'), { ok: false, code: 'invalid_message' });
  assert.deepEqual(buy(h, 100, 'glock'), { ok: true, price: ITEMS.glock.buy! });
  for (let i = 0; i < 4; i++) addItem(h, 'axe', 1);
  assert.equal(canFit(h, [{ itemId: 'pickaxe', count: 1 }]), false);
  assert.deepEqual(buy(h, 100, 'pickaxe'), { ok: false, code: 'hotbar_full' });
});
