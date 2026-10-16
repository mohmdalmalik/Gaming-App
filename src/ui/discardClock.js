// The seconds maths of the end-of-turn discard (approved rule, 15 Oct 2026): plain functions, no page, no clock
// of their own. src/main.js keeps the turn clock and decides what happens at zero; src/ui/discard.js draws the
// countdown; this only answers "how long?", "now what?" and "what do we say?". (A node test holds it:
// tests/discard-clock-check.mjs.)
//
// The rule: the 45-second turn clock keeps running during the discard, but a guest who ends the turn over the
// hand limit always gets at least rules.discardMinSeconds to choose. When it reaches zero the game discards
// random ORDINARY cards for them (discardRandomDown, src/game/actions.js: never a Possession card, never more
// than needed) and the turn ends. The same happens at once if the turn clock itself runs out while they hold
// more than the limit, and the discard screen then never opens. Where the turn clock is off (Practice,
// ?timer=off) the discard has no time limit.
import { rules } from '../data/rules.js';
import { CARDS } from '../game/cards.js';

// The countdown turns urgent in its last seconds; a screen reader is told at these (whole seconds left).
export const URGENT_SECONDS = 5;
export const ANNOUNCE_AT = [10, 5];

const secs = left => (Number.isFinite(left) && left > 0 ? left : 0);

// How many seconds the discard screen runs: what is left of the turn clock when the guest ends the turn, but
// never less than rules.discardMinSeconds. `left` may be 0 or null (nothing left); `clockOn` false (the clock
// is off here) gives null: no time limit.
export function discardAllowance(left, clockOn = rules.turnTimerEnabled) {
  if (!clockOn) return null;
  return Math.max(secs(left), rules.discardMinSeconds);
}

// What ending the turn means for a guest `over` cards above the limit (overHandLimit) with `left` seconds of the
// turn clock remaining: no screen at all within the limit; otherwise the screen, with its allowance (or null).
export function discardPlan(over, left, clockOn = rules.turnTimerEnabled) {
  if (!(over > 0)) return { screen: false, over: 0, seconds: null };
  return { screen: true, over, seconds: discardAllowance(left, clockOn) };
}

// What a clock reaching zero on the guest's own turn does: 'random' (the game discards for them, then the turn
// ends) when they hold more than the limit, whatever the screen was doing; 'end' (the turn simply ends, as it
// always has) when they are within it.
export const atZero = over => (over > 0 ? 'random' : 'end');

// The whole seconds drawn on the countdown (it never shows 0 until time is really up) and its words.
export const secondsShown = left => Math.ceil(secs(left));
export const secondsLine = left => { const n = secondsShown(left); return `${n} second${n === 1 ? '' : 's'} left`; };
export const isUrgent = left => secs(left) <= URGENT_SECONDS;

// The seconds-left words to say aloud (politely, once each) as the clock passes 10 and 5: `before` and `now` are the
// seconds left at the last look and at this one (before = Infinity at the start: a screen opened with 10 or
// fewer says so at once). It says the seconds really left (as the clock goes down they are 10 and 5 exactly).
// null when neither was passed.
export function announcement(before, now) {
  const a = Math.ceil(before), b = Math.ceil(secs(now));
  for (const t of ANNOUNCE_AT) if (b <= t && a > t) return secondsLine(b);
  return null;
}

// "Time ran out. The game discarded your Knife and your Lantern." (the guest's own words, on their own screen:
// the cards that went, in the order of their first one; two of a kind as "your 2 Lanterns"). Nothing here can
// give a role away: Possession cards are never among them.
export function discardedLine(cards) {
  const plural = name => (/fe$/.test(name) ? `${name.slice(0, -2)}ves` : `${name}s`);      // (Knife -> Knives; the rest just add an s)
  const counts = new Map();
  for (const c of cards) counts.set(c.type, (counts.get(c.type) || 0) + 1);
  const parts = [...counts].map(([type, n]) => {
    const name = CARDS[type]?.name ?? 'card';
    return n === 1 ? `your ${name}` : `your ${n} ${plural(name)}`;
  });
  const list = parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Time ran out. The game discarded ${list}.`;
}
