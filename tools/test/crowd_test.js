// 大批敵人測試（無敵＋一次生出大量敵人），檢查錯誤、繪製次數、飛踢與截圖
// 用法：node tools/test/crowd_test.js [敵人數量=150] [m=手機直式] [輸出資料夾=.]
// 需要 Playwright（雲端環境已預裝）。
const path = require('path');
const { chromium, devices } = require('playwright');
const N = +(process.argv[2] || 150);
const mobile = process.argv[3] === 'm';
const out = process.argv[4] || '.';
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1000, height: 720 } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.resolve(__dirname, '../../index.html'));
  await pg.waitForTimeout(600);
  await pg.evaluate(() => R3D.setQuality('high', true));
  await pg.click('[data-act=start]');
  await pg.evaluate(n => {
    __rlfight.god(); __rlfight.spawnMany(n);
    window.__fly = { frames: 0, maxDist: 0, maxTilt: 0 };
    const f = () => { const d = R3D.debugPlayer(); if (d.flying) { __fly.frames++; __fly.maxDist = Math.max(__fly.maxDist, Math.hypot(d.x, d.z)); __fly.maxTilt = Math.max(__fly.maxTilt, d.tilt); } requestAnimationFrame(f); }; f();
    setInterval(() => { const g = __rlfight; if (g.state === 'levelup') g.pick(0); if (g.run.enemies.length < n * 0.5) g.spawnMany(Math.round(n * 0.4)); }, 300);
  }, N);
  await pg.waitForTimeout(5000);
  await pg.screenshot({ path: path.join(out, `crowd_${mobile ? 'mobile' : 'desktop'}_1.png`) });
  await pg.waitForFunction(() => R3D.debugPlayer().flying && R3D.debugPlayer().tilt > 60, null, { timeout: 90000, polling: 30 }).catch(() => {});
  await pg.screenshot({ path: path.join(out, `crowd_${mobile ? 'mobile' : 'desktop'}_flykick.png`) });
  await pg.waitForTimeout(15000);
  await pg.screenshot({ path: path.join(out, `crowd_${mobile ? 'mobile' : 'desktop'}_2.png`) });
  const r = await pg.evaluate(() => ({ 敵人: __rlfight.run.enemies.length, 擊倒: __rlfight.run.kills, 繪製: R3D.stats(), 飛踢: __fly }));
  console.log(JSON.stringify(r), errs.length ? '錯誤：' + errs.slice(0, 3).join(' | ') : '沒有錯誤');
  await b.close();
  if (errs.length) process.exit(1);
})();
