import { launch, newPage, HUD_SELS } from './qa-lib.mjs';
const browser = await launch();
for (const vp of ['ipad', 'air', 'pro', 'desk']) {
  const h = await newPage(browser, vp);
  const t0 = Date.now();
  await h.load('seed=777', { pr: 1 });
  console.log(vp, 'load ms', Date.now() - t0);
  await h.shot(`01-startscreen-${vp}`);
  await h.begin();
  await h.page.waitForTimeout(1500);
  await h.shot(`02-lobby-${vp}`);
  console.log(vp, 'audit', JSON.stringify(await h.audit(), null, 1));
  console.log(vp, 'overlaps', JSON.stringify(await h.overlaps(HUD_SELS)));
  console.log(vp, 'log', h.log);
  await h.context.close();
}
await browser.close();
