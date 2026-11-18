// Mixamo 動畫（FBX）轉成遊戲用的 js/hero_anims.js
// 用法：node tools/anims/convert.js
// 會用無頭瀏覽器載入 Three.js 的 FBX 讀取器，取樣成 30fps，並自動找出每一招的命中格與出招肢體。
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const dir = path.join(root, 'assets/anims');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.fbx'));
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  pg.on('console', m => console.log('[瀏覽器]', m.text()));
  pg.on('pageerror', e => console.log('[錯誤]', e.message));
  await pg.setContent('<html><body></body></html>');
  for (const f of ['vendor/three.min.js']) await pg.addScriptTag({ path: path.join(root, f) });
  for (const f of ['fflate.min.js', 'NURBSUtils.js', 'NURBSCurve.js', 'FBXLoader.js']) await pg.addScriptTag({ path: path.join(__dirname, 'vendor', f) });
  const data = {};
  for (const f of files) data[f.replace('.fbx', '')] = fs.readFileSync(path.join(dir, f)).toString('base64');
  const out = await pg.evaluate(async data => {
    const FPS = 30;
    const strip = n => n.replace(/^mixamorig:?/, '');
    const res = { bones: null, parents: null, restPos: null, restQuat: null, clips: {} };
    for (const [name, b64] of Object.entries(data)) {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
      const obj = new THREE.FBXLoader().parse(bin, '');
      const bones = []; obj.traverse(o => { if (o.isBone) bones.push(o); });
      const main = bones.filter(o => !/Hand(Thumb|Index|Middle|Ring|Pinky)/.test(o.name) && !/_End$/.test(o.name));
      if (!res.bones) {
        res.bones = main.map(o => strip(o.name));
        res.parents = main.map(o => main.indexOf(o.parent));
        res.restPos = main.map(o => o.position.toArray().map(v => +v.toFixed(3)));
        res.restQuat = main.map(o => o.quaternion.toArray().map(v => +v.toFixed(4)));
      }
      const clip = obj.animations[0];
      const mixer = new THREE.AnimationMixer(obj);
      mixer.clipAction(clip).play();
      const n = Math.max(2, Math.round(clip.duration * FPS));
      const q = [], hips = [];
      const by = {}; main.forEach(o => { by[strip(o.name)] = o; });
      const H = by.Hips, ends = { LeftHand: by.LeftHand, RightHand: by.RightHand, LeftFoot: by.LeftFoot, RightFoot: by.RightFoot };
      const reach = { LeftHand: [], RightHand: [], LeftFoot: [], RightFoot: [] };
      const vecs = { LeftHand: [], RightHand: [], LeftFoot: [], RightFoot: [] };
      const hp = new THREE.Vector3(), ep = new THREE.Vector3();
      const elbow = { LeftHand: [], RightHand: [] };
      const P = n => by[n].getWorldPosition(new THREE.Vector3());
      for (let i = 0; i < n; i++) {
        mixer.setTime(Math.min(clip.duration, i / FPS));
        obj.updateMatrixWorld(true);
        for (const nm of res.bones) { const o = by[nm]; o.quaternion.toArray().forEach(v => q.push(+v.toFixed(4))); }
        H.position.toArray().forEach(v => hips.push(+v.toFixed(2)));
        H.getWorldPosition(hp);
        for (const k in ends) { ends[k].getWorldPosition(ep); const d = ep.clone().sub(hp); reach[k].push(Math.hypot(d.x, d.z)); vecs[k].push(d.toArray()); }
        for (const s of ['Left', 'Right']) { const a = P(s + 'Arm'), b2 = P(s + 'ForeArm'), c2 = P(s + 'Hand'); elbow[s + 'Hand'].push(b2.clone().sub(a).angleTo(c2.clone().sub(b2)) * 180 / Math.PI); }
      }
      // 命中格：出招肢體水平伸得最遠的那一格（相對開頭的變化最大）
      let best = null;
      for (const k in reach) { const r = reach[k]; const gain = Math.max(...r) - r[0]; if (!best || gain > best.gain) best = { k, gain, i: r.indexOf(Math.max(...r)) }; }
      // 出拳：命中格改成伸得最遠附近「手肘最直」的那一格
      if (best && elbow[best.k]) {
        const e = elbow[best.k]; let bi = best.i;
        for (let i = Math.max(0, best.i - 6); i <= Math.min(n - 1, best.i + 6); i++) if (e[i] < e[bi]) bi = i;
        best.i = bi;
        console.log('  ', name, '命中格手肘彎曲', e[bi].toFixed(0), '度');
      }
      const c = { fps: FPS, n, q, hips };
      if (!/idle/i.test(name)) { c.impact = best.i; c.limb = best.k; c.limbVec = vecs[best.k][best.i].map(v => +v.toFixed(2)); c.hipsAtImpact = hips.slice(best.i * 3, best.i * 3 + 3); }
      res.clips[name] = c;
      console.log(name, '長度', clip.duration.toFixed(2), '秒', n, '格', c.limb ? `命中第 ${c.impact} 格，用 ${c.limb}` : '（循環）');
    }
    return res;
  }, data);
  fs.writeFileSync(path.join(root, 'js/hero_anims.js'), '// 由 tools/anims/convert.js 從 assets/anims/*.fbx（Mixamo）產生，請勿手動修改\nwindow.HERO_ANIMS = ' + JSON.stringify(out) + ';\n');
  console.log('骨頭', out.bones.length, '輸出', (fs.statSync(path.join(root, 'js/hero_anims.js')).size / 1024).toFixed(0), 'KB');
  await b.close();
})();
