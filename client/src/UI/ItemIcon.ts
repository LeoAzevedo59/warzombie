import { ItemDatabase } from '@/Items/ItemDatabase';
import type { ItemId } from '@/Items/Item';

/** Ícones (game-icons.net, CC-BY 3.0) em `public/icons/<id>.svg`, pintados com a cor via CSS mask. */
export type IconId = ItemId | 'minimap' | 'tower';

/** HTML de um ícone colorido. `size` em px. */
export function iconHtml(id: IconId, color: string, size = 22, extraClass = ''): string {
  return `<span class="item-icon ${extraClass}" style="--icon:url('/icons/${id}.svg');--c:${color};width:${size}px;height:${size}px"></span>`;
}

export function itemIconHtml(itemId: ItemId, size = 22, extraClass = ''): string {
  const def = ItemDatabase.get(itemId);
  // cores claras leem melhor que as escuras da paleta original em fundo escuro
  return iconHtml(itemId, ICON_COLORS[itemId] ?? def.color, size, extraClass);
}

const ICON_COLORS: Partial<Record<ItemId, string>> = {
  glock: '#c9d1d9',
  knife: '#dfe6ec',
  wall_wood: '#c98a4b',
  wall_stone: '#aab2ba',
  wall_iron: '#8fb3d9',
  stone: '#b7bec6',
  bigstone: '#a7afb7',
  stick: '#c48a52',
  wood: '#b9773f',
};
