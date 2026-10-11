// The trade reveal: the player's OWN trade, shown as the two guests and the two cards with an effect,
// instead of sentences. Private: it lives on the player's private screen (the hand-over overlay,
// src/ui/handoff.js, opened as a NOTE so the tests and the turn clock treat it like the old note),
// and only for trades the player is in — two computer guests' trade stays a card-less line in the
// feed.
//
// Soul cards (approved 10 Oct 2026): every Possession card is its owner's own soul and shows their face
// (src/ui/cards.js setCardFace). A soul that has done its work is USED UP: it burns away in crimson
// (the 'soul' burn below), never lands in anyone's hand.
//
// What it shows (TRADE_OUTCOMES; tradeOutcome() picks one from resolveTrade's events):
//   swap             an ordinary trade: the two cards cross and land face up; a soft brass shimmer on the
//                    card you got
//   blocked          you gave a Lantern, they gave their soul: it flies at you, your Lantern flares and the
//                    soul burns away to ash; the Lantern gutters out (used up)
//   blockedMe        you gave your soul, they gave a Lantern: your soul burns in their light
//   possessed        you were clean and got their soul: it reaches you and burns away in crimson smoke,
//                    smoke curls round your portrait, your eyes turn red, and TWO souls with YOUR face
//                    rise where it was (two tries); then their eyes turn red too (you know them now)
//   possessedThem    your soul sinks into them with a crimson pulse and is used up; their eyes turn red;
//                    you got their card
//   soulSpent        you were already possessed, gave an ordinary card, and got their soul: it reaches you
//                    and fizzles out (no card for you); your card goes to them; their eyes turn red
//   alreadyPossessed you gave your soul to someone already possessed: it reaches them and fizzles out;
//                    their card comes to you; their eyes turn red
//   soulsCrossed     you both gave a soul: the two meet in the middle and burn out; their eyes turn red
//   noTrade          someone had no ordinary card: an empty, dimmed slot for whoever had nothing
// Red eyes on the other guest only as src/ui/allies.js allows (the player possessed, and certain of
// them): `allyBefore` (already known: red from the start) and `allyAfter` (this trade showed it: they
// turn at the moment it is shown). Your own possessed portrait only when you are possessed.
//
// Everything moves with CSS (styles.css, "Trade reveal" blocks); embers, ash and smoke are drawn on one
// small canvas, and the burning card is a per-pixel dissolve of its own face on a card-sized canvas.
// Reduced motion: shorter, no particles. A tap anywhere skips to the end. The sound cues go through
// src/audio/bus.js.
import { CARDS } from '../game/cards.js';
import { CARD_FACE, CARD_BACK, cardFaceSrc, setCardFace } from './cards.js';
import { makePortrait } from './portrait.js';
import { sfx } from '../audio/bus.js';
import { holdAlly, releaseAlly } from './allies.js';

export const TRADE_OUTCOMES = ['swap', 'blocked', 'blockedMe', 'possessed', 'possessedThem', 'soulSpent', 'alreadyPossessed', 'soulsCrossed', 'noTrade'];

// Which outcome a trade (resolveTrade's events) or a skipped trade (skipTrade's) was, for `me`.
// (`spent`: a soul used up on a guest already possessed — one entry, or two when both gave a soul.)
export function tradeOutcome(events, me, other) {
  if (!events?.ok || events.skipped) return 'noTrade';
  if (events.blocks?.some(b => b.blocker === me.id)) return 'blocked';
  if (events.blocks?.some(b => b.revealed === me.id)) return 'blockedMe';
  if (events.possessed?.some(p => p.newly === me.id)) return 'possessed';
  if (events.possessed?.some(p => p.newly === other.id && p.by === me.id)) return 'possessedThem';
  const spentByMe = events.spent?.some(x => x.by === me.id), spentOnMe = events.spent?.some(x => x.at === me.id);
  if (spentByMe && spentOnMe) return 'soulsCrossed';
  if (spentOnMe) return 'soulSpent';
  if (spentByMe) return 'alreadyPossessed';
  return 'swap';
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const aCard = type => {
  if (type === 'possession') return 'a Possession card';
  const n = CARDS[type]?.name ?? type;
  return `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`;
};
// Tests only: stretch the reveal's own clock (with the page's animations slowed to match), to look at
// single frames.
const TS = () => (globalThis.__trTimeScale > 0 ? globalThis.__trTimeScale : 1);
const MAIN_CUE = {
  swap: 'tradeSwap', blocked: 'lanternBlock', blockedMe: 'lanternBlock', possessed: 'possessed', possessedThem: 'possessOther',
  soulSpent: 'possessOther', alreadyPossessed: 'possessOther', soulsCrossed: 'possessOther', noTrade: 'noTrade',
};

export function createTradeReveal(doc, { handoff }) {
  const overlay = doc.getElementById('handoff-overlay');
  const box = doc.getElementById('handoff-card');
  const kicker = doc.getElementById('handoff-kicker');
  const next = doc.getElementById('btn-handoff-next');
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  let cur = null;      // the reveal on screen
  let preloaded = null;
  // Every card face (and the back) fetched ahead, so a card never turns over onto a blank face.
  function preload() {
    if (preloaded) return;
    preloaded = [...new Set([...Object.values(CARD_FACE), CARD_BACK])].map(src => {
      const i = new Image(); i.src = src; i.decode?.().catch(() => {});
      return i;
    });
  }

  const el = (tag, cls, parent) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  };
  const img = (src, cls, parent, alt = '') => {
    // (decoded at once, not lazily: a card turning over must never show an empty face for a frame)
    const i = el('img', cls, parent); i.decoding = 'sync'; i.src = src; i.alt = alt; i.draggable = false;
    return i;
  };

  // One guest's seat: the portrait (two layers when it turns: normal, then possessed) and the name.
  function seat(player, { you, possessedLook, morph, side }) {
    const s = el('div', `tr-seat ${side}${possessedLook ? ' turned' : ''}`);
    const port = el('div', 'tr-port', s);
    const base = makePortrait(doc, player, { possessed: !!possessedLook });
    base.classList.add('tr-p1'); port.appendChild(base);
    if (morph) { const p2 = makePortrait(doc, player, { possessed: true }); p2.classList.add('tr-p2'); port.appendChild(p2); }
    el('div', 'tr-ring', s); el('div', 'tr-ring two', s);
    const name = el('div', 'tr-name', s);
    const dot = el('span', 'dot', name); dot.style.setProperty('--player-color', player.color || 'var(--brass)');
    name.appendChild(doc.createTextNode(you ? 'You' : player.name));
    return s;
  }

  // One card in flight: rail (moves across the stage, in % of its width) > card (placed at a slot,
  // fades in) > tilt (leans in flight, sinks) > flip (turns over) > the two faces. `card` null: a
  // face-down card back only.
  function cardEl(card, { faceUp, at, side }) {
    const rail = el('div', `tr-rail ${side}`);
    const pos = el('div', `tr-card at-${at}${card && CARDS[card.type]?.evil ? ' evil' : ''}`, rail);
    const tilt = el('div', 'tr-tilt', pos);
    const halo = el('div', 'tr-halo', tilt);
    const flip = el('div', `tr-flip${faceUp ? '' : ' down'}`, tilt);
    const front = el('div', 'tr-face tr-front', flip);
    const face = img(card ? (cardFaceSrc(card) || CARD_BACK) : CARD_BACK, '', front, card ? CARDS[card.type]?.name ?? '' : '');
    if (card && CARD_FACE[card.type]) setCardFace(face, card);   // (a soul: its owner's own face, kept up to date)
    if (card?.type === 'revolver' && card.shots != null) {
      const b = el('span', 'tr-badge', front); b.textContent = `${card.shots} shot${card.shots === 1 ? '' : 's'}`;
    }
    const back = el('div', 'tr-face tr-back', flip);
    img(CARD_BACK, '', back);
    el('div', 'tr-ash', tilt);
    return { rail, pos, tilt, halo, flip, front, face };
  }

  // An empty hand held out flat, seen from the side, fingers together ("nothing to give" — not a
  // raised "stop" palm: a meeting's trade can't be refused). It reaches in from its owner's side.
  function emptySlot(at) {
    const e = el('div', `tr-empty at-${at}`);
    const flipX = at === 'r' ? ' transform="translate(48 0) scale(-1 1)"' : '';
    e.innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><g${flipX}>`
      + '<path d="M3.5 23h6v13h-6z"/>'
      + '<path d="M9.5 25c2.6 0 4.5-1.7 5.8-4.2l1.4-2.7c.7-1.4 2.9-.9 2.8.7l-.3 4.2H39.5a2.6 2.6 0 0 1 0 5.2H33"/>'
      + '<path d="M33 28.2h5.2a2.4 2.4 0 0 1 0 4.8H32"/>'
      + '<path d="M32 33h3.6a2.2 2.2 0 0 1 0 4.4H31c-2 0-3.2-.4-4.6-1.2l-1.2-.7c-1.1-.6-2.3-.9-3.6-.9H9.5"/>'
      + '</g></svg>';
    return e;
  }

  // The caption: a few words; guests' names picked out.
  function caption(outcome, spec) {
    const { other, theirs, held = 1, empty = [] } = spec;
    const who = p => { const b = doc.createElement('b'); b.className = 'tr-who'; b.textContent = p.name; return b; };
    const evil = t => { const b = doc.createElement('b'); b.className = 'tr-evil'; b.textContent = t; return b; };
    const got = spec.got ?? theirs;
    switch (outcome) {
      case 'blocked': return spec.wasPossessed
        ? ['Your Lantern burned it away — ', who(other), ' is ', evil('possessed too'), '.']
        : ['Your Lantern burned it away — ', who(other), ' is ', evil('possessed'), '. Now you know.'];
      case 'blockedMe': return [who(other), ' blocked you — now they know.'];
      case 'possessed': return [evil('You are possessed'), ` — ${NUM[held] ?? held} soul${held === 1 ? '' : 's'} of your own to pass on.`];
      case 'possessedThem': return [who(other), ' is now ', evil('possessed'), '.'];
      case 'soulSpent': return [who(other), ' is ', evil('possessed too'), ' — their soul is spent.'];
      case 'alreadyPossessed': return [who(other), ' is ', evil('possessed too'), ' — your soul is spent.'];
      case 'soulsCrossed': return [who(other), ' is ', evil('possessed too'), ' — both souls are spent.'];
      case 'noTrade': {
        const meEmpty = empty.includes(spec.me.id), themEmpty = empty.includes(other.id);
        if (meEmpty && themEmpty) return ['Neither of you had a card to give.'];
        if (meEmpty) return ['You had nothing to give.'];
        return [who(other), ' had nothing to give.'];
      }
      default:
        return got ? [`You got ${aCard(got.type)}.`] : ['The cards changed hands.'];
    }
  }

  function stop() {
    if (!cur) return;
    if (cur.morphThem) releaseAlly(cur.otherId);
    for (const t of cur.timers) clearTimeout(t);
    cur.fx.stop();
    for (const b of cur.burns) b.cancel();
    overlay.removeEventListener('click', onTap);
    cur.stage.remove(); cur.cap.remove();
    cur = null;
    disarm();
  }
  const alive = () => !!cur && !overlay.hidden && box.classList.contains('trade-reveal') && box.contains(cur.stage);

  function onTap(e) {
    if (!cur?.playing || e.target === next) return;
    skip();
  }
  function skip() {
    if (!cur?.playing) return;
    cur.instant = true;
    cur.stage.classList.add('tr-end');
    for (const t of cur.timers) clearTimeout(t);
    cur.timers = [];
    cur.fx.stop();
    for (const b of cur.burns) b.finish();
    for (const s of cur.steps) {
      if (s.done) continue;
      s.done = true;
      if (!s.cue) s.fn(true);
    }
    if (!cur.mainPlayed) { cur.mainPlayed = true; sfx(MAIN_CUE[cur.outcome]); }
  }
  // The Continue button fades in at the end and only then takes a tap (CSS delays its visibility to
  // match): a quick second tap meant to hurry the scene along must not close it unseen.
  let armT = 0;
  const disarm = () => { clearTimeout(armT); armT = 0; next.style.pointerEvents = ''; };
  function finish() {
    if (!cur) return;
    cur.playing = false;
    if (cur.morphThem) { cur.themSeat.classList.add('known', 'turned'); releaseAlly(cur.otherId); }   // (whatever the outcome's own timing)
    cur.cap.classList.add('on');
    box.classList.remove('tr-playing');
    clearTimeout(armT);
    next.style.pointerEvents = 'none';
    armT = setTimeout(disarm, 320 * TS());
  }

  // --- The effects canvas (embers, ash, smoke) -------------------------------------------------
  // (A spent soul burns in crimson, not fire: its embers are crimson sparks and it ends in a puff of
  // crimson smoke instead of ash — `kind` 'spark' / puffs().)
  function createFx(canvas, enabled) {
    const ctx = canvas.getContext('2d');
    const sprite = (r, stops) => {
      const c = doc.createElement('canvas'); c.width = c.height = r * 2;
      const g = c.getContext('2d'); const grd = g.createRadialGradient(r, r, 0, r, r, r);
      for (const [o, col] of stops) grd.addColorStop(o, col);
      g.fillStyle = grd; g.fillRect(0, 0, r * 2, r * 2);
      return c;
    };
    const S = enabled ? {
      ember: sprite(16, [[0, 'rgba(255,250,225,1)'], [0.22, 'rgba(255,205,105,0.95)'], [0.55, 'rgba(235,110,35,0.38)'], [1, 'rgba(200,60,20,0)']]),
      smoke: sprite(32, [[0, 'rgba(178,28,50,0.6)'], [0.4, 'rgba(118,14,34,0.34)'], [1, 'rgba(62,5,18,0)']]),
      wisp: sprite(32, [[0, 'rgba(205,195,180,0.32)'], [0.55, 'rgba(150,140,130,0.12)'], [1, 'rgba(120,110,100,0)']]),
      ash: sprite(6, [[0, 'rgba(175,165,155,0.95)'], [1, 'rgba(120,112,104,0)']]),
      glint: sprite(12, [[0, 'rgba(255,248,215,1)'], [0.3, 'rgba(240,206,128,0.8)'], [1, 'rgba(201,162,78,0)']]),
      spark: sprite(16, [[0, 'rgba(255,232,238,1)'], [0.22, 'rgba(240,96,118,0.95)'], [0.55, 'rgba(176,28,52,0.4)'], [1, 'rgba(120,10,30,0)']]),
    } : null;
    let parts = [], emitters = [], raf = 0, last = 0, W = 1, H = 1, dpr = 1, ox = 0, oy = 0;
    const R = Math.random;
    function fit() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(1.5, window.devicePixelRatio || 1); W = Math.max(1, r.width); H = Math.max(1, r.height); ox = r.left; oy = r.top;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    function kick() { if (!raf && enabled) { last = performance.now(); raf = requestAnimationFrame(loop); } }
    function loop() {
      raf = 0;
      const now = performance.now();   // (not the frame's own timestamp: one clock throughout)
      if (!alive()) { parts = []; emitters = []; return; }
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000) / TS()); last = now;
      for (const e of emitters) { e.acc += e.rate * dt; while (e.acc >= 1) { e.acc -= 1; parts.push(e.make()); } }
      emitters = emitters.filter(e => now < e.until);
      parts = parts.filter(p => (p.t += dt) < p.life);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) p.step(p, dt);
      ctx.globalCompositeOperation = 'source-over';
      const bright = p => p.kind === 'ember' || p.kind === 'glint' || p.kind === 'spark';
      for (const p of parts) if (!bright(p)) draw(p);
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) if (bright(p)) draw(p);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (parts.length || emitters.length) raf = requestAnimationFrame(loop);
    }
    function draw(p) {
      const a = p.alpha(p);
      if (a <= 0.01) return;
      if (p.draw) { p.draw(p, a); return; }
      ctx.globalAlpha = Math.min(1, a);
      const s = p.size(p);
      ctx.drawImage(S[p.kind], p.x - s / 2, p.y - s / 2, s, s);
    }
    // Viewport coordinates in; the canvas's own out.
    const local = (x, y) => [x - ox, y - oy];
    const ember = (x, y, kind = 'ember') => {
      [x, y] = local(x, y);
      const sz = 4 + R() * 6, ph = R() * 6;
      return { kind, x, y, t: 0, life: 0.55 + R() * 0.8, vx: (R() - 0.5) * 46, vy: -(38 + R() * 80),
        step(p, dt) { p.vy -= 26 * dt; p.x += (p.vx + Math.sin(p.t * 9 + ph) * 18) * dt; p.y += p.vy * dt; },
        alpha: p => (1 - p.t / p.life) * (0.7 + 0.3 * Math.sin(p.t * 30 + ph)), size: () => sz };
    };
    const ash = (x, y) => {
      [x, y] = local(x, y);
      const sz = 2.5 + R() * 3, ph = R() * 6;
      return { kind: 'ash', x, y, t: 0, life: 0.9 + R() * 0.9, vx: (R() - 0.5) * 22, vy: 8 + R() * 24,
        step(p, dt) { p.x += (p.vx + Math.sin(p.t * 5 + ph) * 14) * dt; p.y += p.vy * dt; },
        alpha: p => (1 - p.t / p.life) * 0.85, size: () => sz };
    };
    // Crimson smoke curling round a portrait (an ellipse of radii rx, ry about cx, cy; its left and
    // right halves can differ — rxL, rxR — so it fits when the portrait sits near the canvas edge).
    // Each wisp of smoke is a ribbon: the same particle drawn at its last few positions along its
    // curling path, thinner and fainter towards the tail.
    const smoke = (cx, cy, rxL, rxR, ry) => {
      const a0 = R() * Math.PI * 2, dir = R() < 0.5 ? -1 : 1, w = 1.3 + R() * 1.1, r0 = 0.78 + R() * 0.36, sz = 24 + R() * 26, ph = R() * 6;
      const at = t => {
        const a = a0 + dir * w * t, r = r0 + t * 0.3 + Math.sin(t * 5 + ph) * 0.08, c = Math.cos(a);
        return [cx + c * (c < 0 ? rxL : rxR) * r, cy + Math.sin(a) * ry * r - t * 22];
      };
      return { kind: 'smoke', x: cx, y: cy, t: 0, life: 1.1 + R() * 0.8,
        step(p) { [p.x, p.y] = at(p.t); },
        alpha: p => Math.sin(Math.PI * p.t / p.life) * 0.75, size: p => sz * (0.7 + p.t * 0.6),
        draw(p, a) {
          for (let k = 0; k < 9; k++) {
            const tt = p.t - k * 0.04;
            if (tt < 0) break;
            const [x, y] = at(tt), s = sz * (0.7 + tt * 0.6) * (1 - k * 0.07);
            ctx.globalAlpha = Math.min(1, a * (1 - k * 0.1));
            ctx.drawImage(S.smoke, x - s / 2, y - s / 2, s, s);
          }
        } };
    };
    const wisp = (x, y) => {
      [x, y] = local(x, y);
      const ph = R() * 6;
      return { kind: 'wisp', x: x + (R() - 0.5) * 16, y, t: 0, life: 0.9 + R() * 0.6,
        step(p, dt) { p.x += Math.sin(p.t * 4 + ph) * 12 * dt; p.y -= (30 + p.t * 10) * dt; },
        alpha: p => Math.sin(Math.PI * p.t / p.life) * 0.55, size: p => 10 + p.t * 30 };
    };
    // A puff of crimson smoke rising from where a spent soul was.
    const puff = (x, y) => {
      [x, y] = local(x, y);
      const ph = R() * 6, sz = 26 + R() * 30, vx = (R() - 0.5) * 30;
      return { kind: 'smoke', x, y, t: 0, life: 1 + R() * 0.7,
        step(p, dt) { p.x += (vx + Math.sin(p.t * 3 + ph) * 16) * dt; p.y -= (34 + p.t * 18) * dt; },
        alpha: p => Math.sin(Math.PI * p.t / p.life) * 0.6, size: p => sz * (0.6 + p.t * 0.8) };
    };
    // A brass glint: a short twinkle that swells and fades where it is.
    const glint = (x, y) => {
      [x, y] = local(x, y);
      const sz = 8 + R() * 10, delay = R() * 0.35;
      return { kind: 'glint', x, y, t: 0, life: 0.55 + delay,
        step() {}, alpha: p => (p.t < delay ? 0 : Math.sin(Math.PI * (p.t - delay) / (p.life - delay))), size: p => sz * (p.t < delay ? 0.2 : 0.4 + Math.sin(Math.PI * (p.t - delay) / (p.life - delay)) * 0.8) };
    };
    return {
      fit,
      // A few brass glints round the edge of `target` (a card that has just landed in your hand).
      glints(target, n) {
        if (!enabled) return;
        fit();
        const r = target.getBoundingClientRect();
        for (let i = 0; i < n; i++) {
          const side = Math.floor(R() * 4), f = R();
          const x = side === 0 ? r.left + f * r.width : side === 1 ? r.right : side === 2 ? r.left + f * r.width : r.left;
          const y = side === 0 ? r.top : side === 1 ? r.top + f * r.height : side === 2 ? r.bottom : r.top + f * r.height;
          parts.push(glint(x, y));
        }
        kick();
      },
      ember(x, y, kind) { if (!enabled) return; parts.push(ember(x, y, kind)); kick(); },
      ashes(rect, n) { if (!enabled) return; for (let i = 0; i < n; i++) parts.push(ash(rect.left + R() * rect.width, rect.top + rect.height * (0.25 + R() * 0.6))); kick(); },
      puffs(rect, n) { if (!enabled) return; fit(); for (let i = 0; i < n; i++) parts.push(puff(rect.left + R() * rect.width, rect.top + rect.height * (0.2 + R() * 0.65))); kick(); },
      // Smoke round the element `target` for `ms`.
      smoke(target, ms) {
        if (!enabled) return;
        fit();
        const r = target.getBoundingClientRect();
        const [cx, cy] = local(r.left + r.width / 2, r.top + r.height / 2);
        const now = performance.now();
        // The smoke drifts out to about 1.6x its radius, and a puff is ~30 px across where it shows:
        // on a side with less room than that (your portrait sits near the left edge on smaller
        // screens) the orbit is pulled in, so the smoke never meets the canvas edge.
        const rx = r.width * 0.6, fitX = room => Math.min(rx, Math.max(r.width * 0.38, (room - 30) / 1.6));
        const rxL = fitX(cx), rxR = fitX(W - cx);
        emitters.push({ acc: 0, rate: 34, until: now + ms * TS(), make: () => smoke(cx, cy, rxL, rxR, r.height * 0.55) });
        kick();
      },
      // A thin grey wisp from the top of `target` (a Lantern going out).
      wisp(target, ms) {
        if (!enabled) return;
        const r = target.getBoundingClientRect();
        emitters.push({ acc: 0, rate: 12, until: performance.now() + ms * TS(), make: () => wisp(r.left + r.width / 2, r.top + r.height * 0.18) });
        kick();
      },
      stop() { if (raf) cancelAnimationFrame(raf); raf = 0; parts = []; emitters = []; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); },
    };
  }

  // --- A card burning away -------------------------------------------------------------------
  // Its face is copied onto a canvas of the card's size and dissolved from the edges in: a glowing rim
  // (yellow-white at the edge, orange behind it), charred brown behind that, grey ash where it has gone;
  // embers rise from the rim. Without the image (or reduced motion) it simply fades. A spent SOUL
  // (palette 'soul') burns the same way in crimson: a pale rose rim turning crimson, a dark plum char,
  // crimson sparks, and a puff of crimson smoke where ash would be.
  const BURN = {
    fire: { rim: f => [255, 238 - 140 * f, 160 - 140 * f], char: [52, 22, 10], ash: [96, 90, 84], ember: 'ember', end: (fx, r) => fx.ashes(r, 14) },
    soul: { rim: f => [255 - 40 * f, 214 - 168 * f, 222 - 166 * f], char: [44, 8, 20], ash: [70, 34, 52], ember: 'spark', end: (fx, r) => fx.puffs(r, 12) },
  };
  function makeNoise() {
    const g = new Float32Array(64 * 64);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    const at = (x, y) => g[((y & 63) << 6) + (x & 63)];
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  function burn(parts, ms, fx, particles, palette = 'fire') {
    const { pos, front, face } = parts;
    const B = BURN[palette] || BURN.fire;
    if (palette === 'soul') pos.classList.add('soul-burn');
    const done = () => { pos.classList.remove('burning'); pos.classList.add('burnt'); };
    ms *= TS();
    const fade = () => { pos.classList.add('fade-burn'); const t = setTimeout(done, 520 * TS()); return { finish() { clearTimeout(t); done(); }, cancel() { clearTimeout(t); } }; };
    const r = front.getBoundingClientRect();
    if (!particles || !face.complete || !face.naturalWidth || r.width < 8) return fade();
    const s = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.round(r.width * s), h = Math.round(r.height * s);
    const cv = doc.createElement('canvas'); cv.className = 'tr-burn'; cv.width = w; cv.height = h;
    let g, src;
    try { g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(face, 0, 0, w, h); src = g.getImageData(0, 0, w, h).data; } catch { return fade(); }
    const n = makeNoise(), key = new Float32Array(w * h);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        const e = Math.pow(Math.pow(Math.abs(u - 0.5) * 2, 4) + Math.pow(Math.abs(v - 0.5) * 2, 4), 0.25);   // 1 at the edges
        const k = 0.55 * (1 - Math.min(1, e)) + 0.45 * (0.65 * n(u * 5, v * 7.5) + 0.35 * n(u * 13 + 17, v * 19 + 5));
        key[y * w + x] = k; if (k < lo) lo = k; if (k > hi) hi = k;
      }
    }
    const span = hi - lo || 1;
    for (let i = 0; i < key.length; i++) key[i] = (key[i] - lo) / span;
    front.appendChild(cv); face.style.visibility = 'hidden'; pos.classList.add('burning');
    const out = g.createImageData(w, h), o = out.data;
    const RIM = 0.035, CHAR = 0.09, ASH = 0.03, ash = B.ash, ch = B.char;
    const t0 = performance.now();
    let raf = 0, over = false;
    const frame = () => {
      raf = 0;
      const now = performance.now();
      if (over) return;
      if (!alive()) { over = true; return; }
      const k = Math.min(1, (now - t0) / ms);
      const th = -0.05 + k * 1.12;
      let emits = 0;
      const pe = 0.004 / TS();
      for (let i = 0, j = 0; i < key.length; i++, j += 4) {
        const d = key[i] - th;
        if (d < -ASH) { o[j + 3] = 0; continue; }
        if (d < 0) { o[j] = ash[0]; o[j + 1] = ash[1]; o[j + 2] = ash[2]; o[j + 3] = 170 * (1 + d / ASH); continue; }
        if (d < RIM) {
          const [cr, cg, cb] = B.rim(d / RIM);
          o[j] = cr; o[j + 1] = cg; o[j + 2] = cb; o[j + 3] = 255;
          if (emits < 4 && Math.random() < pe) { emits++; fx.ember(r.left + ((i % w) / w) * r.width, r.top + (Math.floor(i / w) / h) * r.height, B.ember); }
          continue;
        }
        if (d < RIM + CHAR) {
          const f = (d - RIM) / CHAR, f2 = f * f;
          o[j] = ch[0] + (src[j] - ch[0]) * f2; o[j + 1] = ch[1] + (src[j + 1] - ch[1]) * f2; o[j + 2] = ch[2] + (src[j + 2] - ch[2]) * f2; o[j + 3] = 255;
          continue;
        }
        o[j] = src[j]; o[j + 1] = src[j + 1]; o[j + 2] = src[j + 2]; o[j + 3] = 255;
      }
      g.putImageData(out, 0, 0);
      if (k < 1) raf = requestAnimationFrame(frame);
      else { over = true; B.end(fx, r); cv.remove(); done(); }
    };
    raf = requestAnimationFrame(frame);
    return {
      finish() { if (over) return; over = true; if (raf) cancelAnimationFrame(raf); cv.remove(); done(); },
      cancel() { over = true; if (raf) cancelAnimationFrame(raf); },
    };
  }

  // --- The timelines --------------------------------------------------------------------------
  // Each step: at `ms`, `fn(instant)` (instant: skipped to the end — set the end state, no motion).
  function timeline(outcome, P, at, cue, end) {
    const { mine, theirs, meSeat, themSeat, held } = P;
    const cross = () => {
      mine.rail.classList.add('go-cross-r'); mine.tilt.classList.add('tilt-a');
      theirs.rail.classList.add('go-cross-l'); theirs.tilt.classList.add('tilt-b');
    };
    const flipTheirs = () => theirs.flip.classList.add('reveal');
    const burnIt = (c, ms, palette = 'fire') => instant => {
      if (instant) { c.pos.classList.add('burnt'); if (palette === 'soul') c.pos.classList.add('soul-burn'); return; }
      cur.fx.fit();
      cur.burns.push(burn(c, ms, cur.fx, cur.particles, palette));
    };
    // A spent soul: it burns out in crimson, wrapped in crimson smoke.
    const spend = (c, ms) => instant => {
      burnIt(c, ms, 'soul')(instant);
      if (!instant) cur.fx.smoke(c.front, ms * 0.8);
    };
    const gutter = c => instant => {
      c.halo.className = 'tr-halo gutter';
      c.pos.classList.remove('lit'); c.pos.classList.add('spent');
      if (!instant) cur.fx.wisp(c.front, 700);
    };
    // The other guest is shown to be possessed: on a possessed player's screen (P.morphThem, from
    // src/ui/allies.js) their eyes turn red, with a crimson pulse; on a clean player's, only the crimson
    // line round their portrait (the Lantern block).
    const revealThem = (pulse = true) => () => {
      if (P.morphThem) releaseAlly(P.otherId);
      themSeat.classList.add('known');
      if (P.morphThem) themSeat.classList.add('turned', ...(pulse ? ['pulse'] : []));
    };
    switch (outcome) {
      case 'swap':
        at(380, cross);
        at(760, flipTheirs); cue(760, 'cardFlip');
        at(1300, instant => { theirs.pos.classList.add('got'); theirs.front.classList.add('shine'); mine.pos.classList.add('given'); if (!instant) cur.fx.glints(theirs.front, 7); });
        cue(1300, 'tradeSwap', true);
        end(1850);
        break;
      case 'possessed':
        // Their soul reaches you and is used up in crimson smoke; your eyes turn red; two souls of your
        // own rise where it was; then theirs turn red too (you know who did it).
        at(380, cross);
        at(760, flipTheirs); cue(760, 'cardFlip');
        at(1300, instant => { theirs.pos.classList.add('evil-land'); mine.pos.classList.add('given'); if (!instant) cur.fx.smoke(meSeat.querySelector('.tr-port'), 1300); });
        cue(1300, 'possessed', true);
        at(1420, spend(theirs, 950));
        at(1560, () => { meSeat.classList.add('turned'); box.classList.add('possessed'); });
        if (held.length) at(2280, instant => { held.forEach(h => h.pos.classList.add('fanned')); if (!instant) cur.fx.glints(held[held.length - 1].front, 4); });
        at(2650, revealThem());
        end(3050);
        break;
      case 'possessedThem':
        at(380, () => {
          mine.rail.classList.add('go-sink-r'); mine.tilt.classList.add('sink');
          theirs.rail.classList.add('go-cross-l'); theirs.tilt.classList.add('tilt-b');
        });
        at(760, flipTheirs); cue(760, 'cardFlip');
        at(1400, instant => { revealThem()(); theirs.pos.classList.add('got'); theirs.front.classList.add('shine'); if (!instant) cur.fx.glints(theirs.front, 5); });
        cue(1400, 'possessOther', true);
        end(2150);
        break;
      case 'soulSpent':
        // Their soul reaches you and fizzles out; your card goes to them; they are possessed too.
        at(380, cross);
        at(760, flipTheirs); cue(760, 'cardFlip');
        at(1300, () => { theirs.pos.classList.add('evil-land'); mine.pos.classList.add('given'); });
        at(1380, spend(theirs, 800));
        at(1750, revealThem());
        cue(1750, 'possessOther', true);
        end(2500);
        break;
      case 'alreadyPossessed':
        // Your soul reaches them and fizzles out; their card comes to you; they are possessed too.
        at(380, cross);
        at(760, flipTheirs); cue(760, 'cardFlip');
        at(1300, instant => { theirs.pos.classList.add('got'); theirs.front.classList.add('shine'); if (!instant) cur.fx.glints(theirs.front, 5); });
        at(1340, spend(mine, 800));
        at(1750, revealThem());
        cue(1750, 'possessOther', true);
        end(2500);
        break;
      case 'soulsCrossed':
        // The two souls meet in the middle and burn out together.
        at(380, () => {
          mine.rail.classList.add('go-meet-r'); mine.tilt.classList.add('lean-a');
          theirs.rail.classList.add('go-meet-l'); theirs.tilt.classList.add('lean-b');
        });
        at(720, flipTheirs); cue(720, 'cardFlip');
        at(1200, instant => { spend(mine, 1000)(instant); spend(theirs, 1000)(instant); });
        at(1650, revealThem());
        cue(1650, 'possessOther', true);
        end(2600);
        break;
      case 'blocked':
        at(380, () => { theirs.rail.classList.add('go-strike-l'); theirs.tilt.classList.add('tilt-b'); mine.rail.classList.add('go-nudge-r'); });
        at(620, flipTheirs); cue(620, 'cardFlip');
        at(900, () => { mine.halo.classList.add('flare'); mine.pos.classList.add('lit'); });
        cue(1000, 'lanternBlock', true);
        at(1150, burnIt(theirs, 1100));
        at(1950, gutter(mine));
        at(2250, revealThem(false));
        end(2600);
        break;
      case 'blockedMe':
        at(380, () => { mine.rail.classList.add('go-strike-r'); mine.tilt.classList.add('tilt-a'); theirs.rail.classList.add('go-nudge-l'); });
        at(560, flipTheirs); cue(560, 'cardFlip');
        at(900, () => { theirs.halo.classList.add('flare'); theirs.pos.classList.add('lit'); });
        cue(1000, 'lanternBlock', true);
        at(1150, burnIt(mine, 1100));
        at(1950, gutter(theirs));
        end(2500);
        break;
      default:   // noTrade
        at(320, () => {
          for (const e of P.empties) e.classList.add('shrug');
          if (mine) mine.rail.classList.add('go-offer-r');
        });
        cue(420, 'noTrade', true);
        end(1500);
    }
  }

  const api = {
    get isOpen() { return !!cur && alive(); },
    get outcome() { return cur && alive() ? cur.outcome : null; },
    get playing() { return !!cur?.playing && alive(); },
    skip, preload,

    // spec: { outcome, me, other, mine (the card you gave), theirs (the card they gave), held (the souls
    // you hold now — all new, all yours; 'possessed'), empty (ids with no ordinary card; 'noTrade'),
    // wasPossessed (you were possessed before this trade), allyBefore / allyAfter (whether you see red
    // eyes on them before and after it: src/ui/allies.js), notes (this trade's own private notes: this
    // screen says them, so they are taken off the waiting list) }.
    show(spec, onContinue) {
      stop();
      preload();
      const outcome = TRADE_OUTCOMES.includes(spec.outcome) ? spec.outcome : 'swap';
      const { me, other } = spec;
      const own = new Set(spec.notes || []);
      if (Array.isArray(me.notes)) for (let i = me.notes.length - 1; i >= 0; i--) if (own.has(me.notes[i])) me.notes.splice(i, 1);
      // The private screen, as a note: any OTHER waiting notes still show under the reveal.
      handoff.privateNote(me, [], () => { stop(); onContinue?.(); });
      const reduced = reducedMotion();
      box.classList.add('trade-reveal', 'tr-playing');
      if (spec.wasPossessed) box.classList.add('possessed');
      kicker.textContent = `Only you see this · ${outcome === 'noTrade' ? 'No trade' : 'A trade'} with ${other.name}`;
      next.textContent = 'Continue';

      const stage = el('div', `tr-stage o-${outcome}${reduced ? ' tr-reduced' : ''}`);
      stage.setAttribute('role', 'img');
      const cap = el('div', 'tr-caption');
      cap.setAttribute('role', 'status');
      el('div', 'tr-deco', stage);
      const meSeat = seat(me, { you: true, possessedLook: spec.wasPossessed, morph: outcome === 'possessed' && !spec.wasPossessed, side: 'me' });
      // (their red eyes: only as src/ui/allies.js allows — already known, or turning when this trade shows it)
      const morphThem = !!spec.allyAfter && !spec.allyBefore;
      const themSeat = seat(other, { you: false, possessedLook: !!spec.allyBefore, morph: morphThem, side: 'them' });
      if (spec.allyBefore) themSeat.classList.add('known');
      stage.append(meSeat, themSeat);

      const P = { meSeat, themSeat, held: [], empties: [], mine: null, theirs: null, morphThem, otherId: other.id };
      if (morphThem) holdAlly(other.id);   // (no red eyes on them anywhere until this scene shows it)
      if (outcome === 'noTrade') {
        const empty = spec.empty || [];
        if (empty.includes(me.id)) { const e = emptySlot('l'); P.empties.push(e); stage.appendChild(e); }
        else { P.mine = cardEl(null, { faceUp: false, at: 'l', side: 'mine' }); stage.appendChild(P.mine.rail); }
        if (empty.includes(other.id)) { const e = emptySlot('r'); P.empties.push(e); stage.appendChild(e); }
      } else {
        // Possessed: the souls you hold now — new ones, with your own face — rise where the card that
        // possessed you burned away, fanned toward the middle (away from your portrait).
        if (outcome === 'possessed') {
          const n = Math.max(1, spec.held || 1);
          const rail = el('div', 'tr-rail held', stage);
          for (let i = 0; i < n; i++) {
            const h = cardEl({ id: `held-${i}`, type: 'possession', owner: me.id }, { faceUp: true, at: 'l', side: 'held' });
            h.pos.classList.add('tr-extra');
            h.pos.style.setProperty('--fan-x', `${i * 46}%`);
            h.pos.style.setProperty('--fan-r', `${(i - (n - 1) / 2) * 7}deg`);
            rail.appendChild(h.pos);
            P.held.push(h);
          }
        }
        P.mine = cardEl(spec.mine, { faceUp: true, at: 'l', side: 'mine' });
        P.theirs = cardEl(spec.theirs, { faceUp: false, at: 'r', side: 'theirs' });
        stage.append(P.mine.rail, P.theirs.rail);
      }
      const canvas = el('canvas', 'tr-fx', stage);
      canvas.setAttribute('aria-hidden', 'true');
      const parts = caption(outcome, spec);
      for (const p of parts) cap.append(typeof p === 'string' ? doc.createTextNode(p) : p);
      stage.setAttribute('aria-label', cap.textContent);

      const anchor = doc.getElementById('handoff-role');
      if (anchor && anchor.parentNode === box) anchor.before(stage, cap); else box.querySelector('.modal-actions')?.before(stage, cap);

      const fx = createFx(canvas, !reduced);
      cur = { outcome, stage, cap, fx, timers: [], steps: [], burns: [], playing: true, instant: false, mainPlayed: false, particles: !reduced, themSeat, morphThem, otherId: other.id };
      fx.fit();
      overlay.addEventListener('click', onTap);

      const k = reduced ? 0.4 : 1;
      const steps = cur.steps;
      const me_ = cur;
      const at = (ms, fn) => steps.push({ ms, fn });
      const cue = (ms, name, main = false) => steps.push({ ms, cue: true, fn: () => { if (main) me_.mainPlayed = true; sfx(name); } });
      const end = ms => steps.push({ ms, fn: () => finish() });
      timeline(outcome, P, at, cue, end);
      for (const s of steps) {
        cur.timers.push(setTimeout(() => {
          if (cur !== me_ || s.done) return;
          if (!alive()) { stop(); return; }
          s.done = true;
          s.fn(me_.instant);
        }, s.ms * k * TS()));
      }
      return outcome;
    },

    // QA: open the reveal for `outcome` with sample cards, for guests `a` (you) and `b` (them). Copies
    // of the guests are used, so nothing in a game changes. Extra names: 'noTradeMe' (you had nothing),
    // 'noTradeBoth', 'blockedPossessed' (a possessed you blocked their soul with a Lantern).
    preview(name, a, b) {
      const meP = { ...a, notes: [], hand: [], possessed: false };
      const them = { ...b, notes: [], hand: [], possessed: false };
      const c = (type, extra = {}) => ({ id: `preview-${type}`, type, ...extra });
      const mySoul = () => c('possession', { owner: meP.id }), theirSoul = () => c('possession', { owner: them.id });
      const S = {
        swap: { outcome: 'swap', mine: c('knife'), theirs: c('lantern') },
        blocked: { outcome: 'blocked', mine: c('lantern'), theirs: theirSoul() },
        blockedPossessed: { outcome: 'blocked', mine: c('lantern'), theirs: theirSoul(), wasPossessed: true, allyAfter: true },
        blockedMe: { outcome: 'blockedMe', mine: mySoul(), theirs: c('lantern'), wasPossessed: true },
        possessed: { outcome: 'possessed', mine: c('bandage'), theirs: theirSoul(), held: 2, allyAfter: true },
        possessedThem: { outcome: 'possessedThem', mine: mySoul(), theirs: c('revolver', { shots: 2 }), wasPossessed: true, allyAfter: true },
        soulSpent: { outcome: 'soulSpent', mine: c('bandage'), theirs: theirSoul(), wasPossessed: true, allyAfter: true },
        alreadyPossessed: { outcome: 'alreadyPossessed', mine: mySoul(), theirs: c('knife'), wasPossessed: true, allyAfter: true },
        soulsCrossed: { outcome: 'soulsCrossed', mine: mySoul(), theirs: theirSoul(), wasPossessed: true, allyAfter: true },
        noTrade: { outcome: 'noTrade', empty: [them.id] },
        noTradeMe: { outcome: 'noTrade', empty: [meP.id] },
        noTradeBoth: { outcome: 'noTrade', empty: [meP.id, them.id] },
      };
      const spec = S[name] || S.swap;
      if (spec.wasPossessed) meP.possessed = true;
      api.show({ me: meP, other: them, ...spec }, () => {});
      return spec.outcome;
    },
  };
  return api;
}
