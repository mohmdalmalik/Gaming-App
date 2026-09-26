// Drawn card icons: simple, recognisable vector illustrations for each card type, used in the
// card's illustration area until a painted illustration is registered in CARD_ART. Each is an SVG
// string on a 96×96 canvas drawn with currentColor (the tile's CSS picks the ink colour), so they
// read the same on the ivory card faces in the hand, the encounter modal and the discard prompt.
const wrap = body => `<svg class="icon" viewBox="0 0 96 96" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const CARD_ICONS = {
  // Oil lantern: handle, cap, glass body with a flame.
  lantern: wrap(`<path d="M34 30h28"/><path d="M40 30l-6-8h28l-6 8"/><path d="M36 30v34a12 12 0 0 0 24 0V30"/><path d="M48 44c-4 5-4 9 0 12 4-3 4-7 0-12z" fill="currentColor" stroke="none"/><path d="M42 70h12"/><path d="M48 22c-8-4-8-10 0-10s8 6 0 10"/>`),
  // Knife: blade + guard + handle.
  knife: wrap(`<path d="M18 74l32-32" /><path d="M50 42l26-26c4 6 3 14-3 20L54 56z" fill="currentColor" stroke="none"/><path d="M44 48l-6-6" /><path d="M14 78l8-8"/>`),
  // Revolver: barrel, cylinder, grip, trigger.
  revolver: wrap(`<path d="M22 38h50v10H46l-4 6H30z"/><circle cx="40" cy="43" r="6"/><path d="M30 54l-6 20h12l6-16"/><path d="M44 54c2 4 0 8-4 8"/>`),
  // Flashlight: body, head, beam.
  flashlight: wrap(`<path d="M20 54l22-22 20 20-22 22a6 6 0 0 1-8 0l-12-12a6 6 0 0 1 0-8z"/><path d="M42 32l8-8 20 20-8 8"/><path d="M60 16l6-6M70 30l8-4M62 22l10-10" opacity="0.8"/>`),
  // Bandage: a roll with a cross.
  bandage: wrap(`<rect x="18" y="34" width="60" height="28" rx="8"/><path d="M48 40v16M40 48h16"/><path d="M26 34v28M70 34v28" opacity="0.6"/>`),
  // Possession: an eye with a slit pupil (the evil card).
  possession: wrap(`<path d="M14 48c10-16 22-24 34-24s24 8 34 24c-10 16-22 24-34 24S24 64 14 48z"/><circle cx="48" cy="48" r="12"/><path d="M48 38v20" stroke-width="6"/><path d="M22 26l6 6M74 26l-6 6" opacity="0.7"/>`),
  // Master key: an ornate bow and a wide bit.
  masterKey: wrap(`<circle cx="30" cy="40" r="14"/><circle cx="30" cy="40" r="5"/><path d="M42 44l36 0"/><path d="M66 44v10M76 44v14"/><path d="M22 22l4 6M38 22l-4 6" opacity="0.7"/>`),
  // Lock pick: two picks crossed.
  lockPick: wrap(`<path d="M22 74l44-44"/><path d="M66 30c4-4 8-4 10 0s0 8-4 10"/><path d="M74 74L30 30"/><path d="M30 30c-4-4-8-4-10 0s0 8 4 10"/><path d="M40 60l-6 6M56 60l6 6" opacity="0.7"/>`),
  // Barricade: two planks nailed across.
  barricade: wrap(`<path d="M18 34l60 20-4 10-60-20z" fill="currentColor" fill-opacity="0.15"/><path d="M18 62l60-20 4 10-60 20z" fill="currentColor" fill-opacity="0.15"/><circle cx="26" cy="40" r="2" fill="currentColor"/><circle cx="70" cy="56" r="2" fill="currentColor"/><circle cx="26" cy="66" r="2" fill="currentColor"/><circle cx="70" cy="46" r="2" fill="currentColor"/>`),
  // Hand mirror: an oval glass in a rim, a glint across it, and a handle below.
  handMirror: wrap(`<ellipse cx="48" cy="36" rx="20" ry="24"/><ellipse cx="48" cy="36" rx="14" ry="18" opacity="0.5"/><path d="M40 26c2-4 6-6 10-6" opacity="0.8"/><path d="M48 60v6"/><path d="M44 66h8l-1 18a3 3 0 0 1-6 0z" fill="currentColor" fill-opacity="0.15"/>`),
  // Espresso: a small cup on a saucer, with steam rising.
  espresso: wrap(`<path d="M30 50h32v8a14 14 0 0 1-14 14h-4a14 14 0 0 1-14-14z" fill="currentColor" fill-opacity="0.15"/><path d="M62 54h4a6 6 0 0 1 0 12h-6"/><path d="M18 78h60"/><path d="M26 78c4 4 40 4 44 0" opacity="0.7"/><path d="M40 42c-4-4 4-8 0-14M52 42c-4-4 4-8 0-14" opacity="0.8"/>`),
  // Trinket: a small locket on a chain.
  trinket: wrap(`<path d="M48 22c-10 0-16 8-14 16l14 8 14-8c2-8-4-16-14-16z"/><path d="M48 46v28"/><circle cx="48" cy="68" r="10"/><path d="M48 62v12M42 68h12" opacity="0.7"/>`),
};

// The icon markup for a card type, or null if there isn't one (the caller falls back to a glyph).
export function cardIcon(type) {
  return CARD_ICONS[type] || null;
}
