import { HOTBAR_SLOTS, ITEMS, type ItemId, type ItemStack } from '../../../shared/items.js';

/** Regras puras de hotbar/economia (sem I/O) — fáceis de testar. */

export type Hotbar = Array<ItemStack | null>;

export function emptyHotbar(): Hotbar {
  return Array.from({ length: HOTBAR_SLOTS }, () => null);
}

/** Adiciona `count` do item; retorna quantos NÃO couberam. Muta `hotbar`. */
export function addItem(hotbar: Hotbar, itemId: ItemId, count: number): number {
  const max = ITEMS[itemId].stackMax;
  let left = count;
  for (const s of hotbar) {
    if (left === 0) break;
    if (s && s.itemId === itemId && s.count < max) {
      const take = Math.min(left, max - s.count);
      s.count += take;
      left -= take;
    }
  }
  for (let i = 0; i < hotbar.length && left > 0; i++) {
    if (hotbar[i] === null) {
      const take = Math.min(left, max);
      hotbar[i] = { itemId, count: take };
      left -= take;
    }
  }
  return left;
}

/** Todos os stacks cabem? (simula numa cópia) */
export function canFit(hotbar: Hotbar, stacks: ItemStack[]): boolean {
  const copy: Hotbar = hotbar.map((s) => (s ? { ...s } : null));
  return stacks.every((st) => addItem(copy, st.itemId, st.count) === 0);
}

export function hasItem(hotbar: Hotbar, itemId: ItemId): boolean {
  return hotbar.some((s) => s?.itemId === itemId);
}

/** Remove todos os recursos vendáveis; retorna o valor total. Muta `hotbar`. */
export function sellAll(hotbar: Hotbar): { total: number; sold: ItemStack[] } {
  let total = 0;
  const sold: ItemStack[] = [];
  for (let i = 0; i < hotbar.length; i++) {
    const s = hotbar[i];
    const price = s ? ITEMS[s.itemId].sell : undefined;
    if (!s || !price) continue;
    total += price * s.count;
    sold.push({ ...s });
    hotbar[i] = null;
  }
  return { total, sold };
}

export type BuyResult = { ok: true; price: number } | { ok: false; code: 'not_enough_money' | 'hotbar_full' | 'invalid_message' };

/** Compra um item se houver dinheiro e slot. Muta `hotbar`. */
export function buy(hotbar: Hotbar, money: number, itemId: ItemId): BuyResult {
  const def = ITEMS[itemId];
  if (!def?.buy) return { ok: false, code: 'invalid_message' };
  if (money < def.buy) return { ok: false, code: 'not_enough_money' };
  if (!canFit(hotbar, [{ itemId, count: 1 }])) return { ok: false, code: 'hotbar_full' };
  addItem(hotbar, itemId, 1);
  return { ok: true, price: def.buy };
}
