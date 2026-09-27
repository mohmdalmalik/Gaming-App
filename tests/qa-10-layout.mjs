// QA: HUD layout audit at every target viewport with the widest action row (Escape + Trade in the
// Fire Exit) and 1 / 6 / 8 cards; the fan must not cover the panel or buttons. node qa-10-layout.mjs
import { launch, newPage, HUD_SELS } from './qa-lib.mjs';
const browser = await launch();
for (const vp of ['ipad', 'air', 'pro', 'desk']) {
  const h = await newPage(browser, vp);
  const { page, game } = h;
  await h.load('mode=hotseat&players=6&seed=77&timer=on', { pr: 0.5 });
  await game(() => { window.__game.revealTile('corridorE', 'hall'); window.__game.revealTile('exit'); });
  await h.begin();
  for (let i = 0; i < 16 && (await h.kind()) !== 'turn'; i++) await page.click('#btn-handoff-next', { force: true });
  await page.click('#btn-handoff-next', { force: true });
  await page.waitForTimeout(300);
  const P = await game(() => window.__game.state.activeIndex);
  await h.place((P + 1) % 6, 'exit'); await h.place(P, 'exit', 4);
  await game(() => { const g = window.__game; g.movers[g.state.activeIndex].reset(g.roomCenter('exit')[0] + 1, g.roomCenter('exit')[1] + 1); });
  for (const n of [1, 6, 8]) {
    const types = ['lantern', 'lantern', 'revolver', 'bandage', 'masterKey', 'espresso', 'handMirror', 'barricade'].slice(0, n);
    await h.setHand(P, types.map((t, k) => ({ id: `q${k}`, type: t, ...(t === 'revolver' ? { shots: 2 } : {}) })));
    await page.waitForTimeout(900);
    const clash = await page.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const cards = [...document.querySelectorAll('#hand-fan .fan-card')];
      const others = ['#player-panel', '#btn-room', '#btn-trade', '#btn-end-turn', '#btn-map', '#btn-rotate-left', '#btn-rotate-right'].map(s => [s, document.querySelector(s)]).filter(([, e]) => e && e.offsetParent && !e.closest('[hidden]'));
      const out = [];
      for (const c of cards) for (const [s, e] of others) {
        const a = r(c), b = r(e);
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) out.push(`${c.dataset.type} over ${s} ${Math.round(ox)}x${Math.round(oy)}`);
      }
      const fanW = cards.length ? Math.round(r(cards[0]).width) : 0;
      return { out, fanW, strip: Math.round(r(document.querySelector('.hud-top-center')).width) };
    });
    console.log(vp, n, 'cards', JSON.stringify(clash), JSON.stringify(await h.overlaps(HUD_SELS)), JSON.stringify((await h.audit()).filter(x => !/cname/.test(x))));
    await h.shot(`lay-${vp}-${n}`);
  }
  await h.context.close();
}
await browser.close();
