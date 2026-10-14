// The device's Reduce Motion setting (iPad: Settings > Accessibility > Motion; the browser calls it
// prefers-reduced-motion). Read live, so turning it on while the game is open takes effect at once.
// What it quiets: the Service Corridor's and Back Stairs Passage's flickering light (src/render/mood.js),
// the lobby behind the menu (src/settings.js: held still), and, in styles.css, the cards dealt into the
// hand, the search icon's pulse, the waiting dots, the menu pages sliding in. It never removes
// information: only motion. (The trade and attack scenes had their own rule already.)
let query = null;
try { query = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { /* no matchMedia (a test, an old browser) */ }
export const reducedMotion = () => !!query?.matches;
