// The sound cue bus: any module asks for a sound by NAME (sfx('lanternBlock')) without knowing how
// sounds are made or whether sound is on. src/audio/index.js listens and plays them; with no listener
// (tests, sound off, before the first tap on iOS) a cue is simply dropped. Keep names to this list so
// every cue has a sound:
//   interface  click · open · close · select · deny
//   menu       joined (a guest joins the table) · liftDing · liftDoors · fadeIn
//   turn       yourTurn · tick (the clock's last seconds) · timeUp
//   doors      doorOpen · doorJammed · doorLocked · unlock · lockFail · barricade
//   finding    search · cardFound · cardFlip
//   cards      bandage · espresso · mirror
//   trades     tradeSwap · lanternBlock (a Possession card burns in a Lantern's light) · possessed (you
//              are possessed) · possessOther (your card possessed them) · noTrade
//   combat     knife · revolver · hurt · death
//   rooms      infirmary · switchboard
//   ending     escape · dawn · win · winPossessed (the possessed side won: yours) · lose
//   walking    step (opts.surface: carpet | wood | marble)
// Options any cue may take: { volume 0..1, pan -1..1, delay s }. src/audio/sounds.js says which file
// each name plays and how.
const listeners = new Set();
export function sfx(name, opts = {}) { for (const fn of listeners) { try { fn(name, opts); } catch (err) { console.warn('sound cue failed:', name, err); } } }
export function onSfx(fn) { listeners.add(fn); return () => listeners.delete(fn); }
