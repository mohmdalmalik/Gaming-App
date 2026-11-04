// A random source in [0, 1) from cryptographic random bytes, for everything secret at a Co-op table: the deal, the
// possessed seat, the hotel, reshuffles, Lock Picks, random discards, time-out choices, seat order and bot seeds.
// Stateless (nothing to save or recover after a restart). Pure: the bytes source is injected
// (Node: crypto.randomFillSync; a page: crypto.getRandomValues), so this file runs anywhere.
//
//   const rng = cryptoRng(buf => crypto.randomFillSync(buf));      // or buf => crypto.getRandomValues(buf)
//   rng()   // 0 <= x < 1, 53 random bits
//
// `randomBytes(buf)` fills the Uint8Array it is given (and may return it). Single player never uses this: it keeps
// makeRng(seed) (src/game/cards.js), so ?seed= links still replay.
export function cryptoRng(randomBytes) {
  if (typeof randomBytes !== 'function') throw new Error('cryptoRng needs a random bytes source');
  const buf = new Uint8Array(7);
  return function () {
    randomBytes(buf);
    // 53 bits: the top 5 bits of the first byte, then six whole bytes (5 + 48)
    let x = buf[0] & 0x1f;
    for (let i = 1; i < 7; i++) x = x * 256 + buf[i];
    return x / 9007199254740992;   // 2^53
  };
}
