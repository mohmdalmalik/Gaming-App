// Table codes: 5 letters from 18 consonants (src/data/online.js ONLINE.code: no vowels or Y, so no words; no L or Q,
// which look like other letters): 18^5 ≈ 1.9 million codes. Pure: the random bytes are injected.
//
//   newCode(randomBytes)   'BKTWM': every letter equally likely (rejection sampling: a byte >= 252 = 14 x 18 is
//                          drawn again), and a code containing a blocked word is drawn again
//   normaliseCode(text)    the code in it, or null: any case, spaces, dashes, dots, or a whole pasted link (…?join=BKTWM)
//   codeProblem(text)      null when the text holds a good code; 'letters' (a letter codes never use) or 'length'
import { ONLINE } from '../data/online.js';

const ALPHABET = ONLINE.code.alphabet;
const LENGTH = ONLINE.code.length;
const LIMIT = Math.floor(256 / ALPHABET.length) * ALPHABET.length;   // 252: bytes at or above are redrawn

// Letter runs a code must never contain (consonants only, so few can read as words): kept short and plain.
export const CODE_BLOCKLIST = ['FCK', 'FKK', 'SHT', 'CNT', 'KKK', 'NGGR', 'NGR', 'FGT', 'DCK', 'PSS', 'TWT', 'WNK', 'BTCH', 'XXX', 'JZZ', 'SPC', 'CHNK', 'PRN'];
export const isBlocked = code => CODE_BLOCKLIST.some(w => code.includes(w));

// `randomBytes(buf)`: fills the Uint8Array it is given (Node: crypto.randomFillSync; page: crypto.getRandomValues).
export function newCode(randomBytes) {
  const buf = new Uint8Array(16);
  for (let tries = 0; tries < 1000; tries++) {
    let code = '';
    while (code.length < LENGTH) {
      randomBytes(buf);
      for (let i = 0; i < buf.length && code.length < LENGTH; i++) {
        if (buf[i] < LIMIT) code += ALPHABET[buf[i] % ALPHABET.length];
      }
    }
    if (!isBlocked(code)) return code;
  }
  throw new Error('newCode: no code found (is the random source working?)');
}

const VALID = new RegExp(`^[${ALPHABET}]{${LENGTH}}$`);
export const isCode = text => typeof text === 'string' && VALID.test(text);

// The letters the player meant: the ?join= value of a pasted link if there is one, else the text itself,
// upper-cased, with spaces, dashes, dots and underscores taken out.
function cleaned(text) {
  if (typeof text !== 'string') return '';
  const s = text.slice(0, ONLINE.code.inputMax);
  const link = s.match(/[?&#]join=([^&#\s]*)/i);
  return (link ? decodeURIComponentSafe(link[1]) : s).toUpperCase().replace(/[\s\-–—._]+/g, '');
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

export function normaliseCode(text) {
  const c = cleaned(text);
  return isCode(c) ? c : null;
}

export function codeProblem(text) {
  const c = cleaned(text);
  if (isCode(c)) return null;
  if (/[^A-Z]/.test(c) || [...c].some(ch => !ALPHABET.includes(ch))) return 'letters';
  return 'length';
}
