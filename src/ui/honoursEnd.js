// The end screen's quiet achievements line (#end-honours, under the record line): "Achievement earned: Seen through ·
// Monocle", only when the match just shown earned one (src/honours.js; checked on the end screen only, never during
// a match). Hidden otherwise. The item's name is the one for your body ('Lantern fob' / 'Lantern charm'); an item
// whose art is not in the game yet says so ("Monocle (coming soon)", as the Honours page does), so nobody looks for it in the
// wardrobe today. The line is a button: it opens the Hotel Honours page (src/ui/honours.js; main.js wires it).
import { honoursLine } from '../data/achievements.js';
import { itemById, labelOf, isPending } from '../data/wardrobe.js';

const SOON = ' (coming soon)';
const itemLabelOf = (it, body) => (!it ? '' : labelOf(it, body) + (isPending(it, body) ? SOON : ''));

export function showEndHonours(doc, earned = [], { body = 'm' } = {}) {
  const el = doc.getElementById('end-honours');
  if (!el) return;
  const text = honoursLine((earned || []).map(a => ({ label: a.label, itemLabel: itemLabelOf(itemById(a.item), body) })));
  el.textContent = text;
  el.hidden = !text;
}
