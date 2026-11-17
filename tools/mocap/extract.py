"""
動作捕捉轉換工具：把 CMU 動作捕捉資料（BVH）裁切成遊戲用的動畫片段。

資料來源：CMU Graphics Lab Motion Capture Database（mocap.cs.cmu.edu），
BVH 轉檔由 Bruce Hahne 製作。CMU 聲明此資料可免費用於研究與商業專案。
The data used in this project was obtained from mocap.cs.cmu.edu.
The database was created with funding from NSF EIA-0196217.

用法：
  python3 tools/mocap/extract.py <BVH 資料夾> [輸出檔，預設 js/mocap.js]

會自動：
  1. 解析骨架與每一格的旋轉
  2. 依手腕伸展、腳的高度偵測出拳與踢腿的瞬間，前後裁切成片段
  3. 找出可循環的待機（拳擊架式）、走路、跑步片段
  4. 把出招方向轉成面向 +X，移除大部分位移（主角站在原地出招）
  5. 降到 30 fps，輸出成 JS 檔（window.MOCAP）
"""
import sys, json, math, pathlib
import numpy as np

KEEP_DROP = {'LeftFingerBase', 'LeftHandIndex1', 'LThumb', 'RightFingerBase', 'RightHandIndex1', 'RThumb'}
OUT_FPS = 30


# ---------- BVH 解析 ----------
def parse_bvh(path):
    text = pathlib.Path(path).read_text()
    head, motion = text.split('MOTION')
    tok = head.split()
    joints, stack, i = [], [], 0
    cur = None
    while i < len(tok):
        t = tok[i]
        if t in ('ROOT', 'JOINT'):
            j = {'name': tok[i + 1], 'parent': stack[-1] if stack else -1, 'end': None}
            joints.append(j)
            cur = len(joints) - 1
            i += 2
        elif t == 'End':
            # End Site：記錄末端位置（頭頂、腳尖）
            off = [float(x) for x in tok[i + 4:i + 7]]
            joints[stack[-1]]['end'] = off
            i += 8
            continue
        elif t == '{':
            stack.append(cur); i += 1
        elif t == '}':
            stack.pop(); i += 1
        elif t == 'OFFSET':
            joints[cur]['offset'] = np.array([float(x) for x in tok[i + 1:i + 4]]); i += 4
        elif t == 'CHANNELS':
            n = int(tok[i + 1]); joints[cur]['channels'] = tok[i + 2:i + 2 + n]; i += 2 + n
        else:
            i += 1
    lines = motion.strip().split('\n')
    nframes = int(lines[0].split()[1])
    ftime = float(lines[1].split()[2])
    data = np.array([[float(x) for x in l.split()] for l in lines[2:2 + nframes]])
    return joints, data, ftime


# ---------- 四元數 ----------
def qmul(a, b):
    aw, ax, ay, az = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    bw, bx, by, bz = b[..., 0], b[..., 1], b[..., 2], b[..., 3]
    return np.stack([aw * bw - ax * bx - ay * by - az * bz,
                     aw * bx + ax * bw + ay * bz - az * by,
                     aw * by - ax * bz + ay * bw + az * bx,
                     aw * bz + ax * by - ay * bx + az * bw], -1)

def qaxis(axis, ang):
    h = ang / 2
    q = np.zeros(ang.shape + (4,))
    q[..., 0] = np.cos(h)
    q[..., 'XYZ'.index(axis) + 1] = np.sin(h)
    return q

def qrot(q, v):
    # 用四元數旋轉向量
    qv = np.concatenate([np.zeros(v.shape[:-1] + (1,)), v], -1)
    qc = q * np.array([1, -1, -1, -1])
    return qmul(qmul(q, qv), qc)[..., 1:]


def local_quats(joints, data):
    """每個關節每一格的局部旋轉，以及根節點位置"""
    F = data.shape[0]
    col = 0
    quats, rootpos = [], None
    for j in joints:
        q = np.tile(np.array([1.0, 0, 0, 0]), (F, 1))
        for ch in j['channels']:
            v = data[:, col]; col += 1
            if ch.endswith('position'):
                if rootpos is None: rootpos = np.zeros((F, 3))
                rootpos[:, 'XYZ'.index(ch[0])] = v
            else:
                q = qmul(q, qaxis(ch[0], np.radians(v)))
        quats.append(q)
    return np.stack(quats, 1), rootpos  # (F, J, 4), (F, 3)


def fk(joints, quats, rootpos):
    """正向運動學：每個關節的世界位置"""
    F, J = quats.shape[:2]
    wq = np.zeros((F, J, 4)); wp = np.zeros((F, J, 3))
    for k, j in enumerate(joints):
        p = j['parent']
        if p < 0:
            wq[:, k] = quats[:, k]; wp[:, k] = rootpos
        else:
            wq[:, k] = qmul(wq[:, p], quats[:, k])
            wp[:, k] = wp[:, p] + qrot(wq[:, p], np.tile(j['offset'], (F, 1)))
    return wp, wq


# ---------- 片段處理 ----------
class Take:
    def __init__(self, path):
        self.joints, data, self.ftime = parse_bvh(path)
        self.fps = round(1 / self.ftime)
        self.q, self.root = local_quats(self.joints, data)
        self.wp, _ = fk(self.joints, self.q, self.root)
        self.idx = {j['name']: k for k, j in enumerate(self.joints)}
        legs = np.linalg.norm(self.joints[self.idx['LeftLeg']]['offset']) + np.linalg.norm(self.joints[self.idx['LeftFoot']]['offset'])
        self.leg = legs
        self.arm = np.linalg.norm(self.joints[self.idx['LeftForeArm']]['offset']) + np.linalg.norm(self.joints[self.idx['LeftHand']]['offset'])

    def P(self, name):
        return self.wp[:, self.idx[name]]

    def ext(self, side):
        return np.linalg.norm(self.P(side + 'Hand') - self.P(side + 'Arm'), axis=1) / self.arm

    def foot_h(self, side):
        return (self.P(side + 'Foot')[:, 1] - self.P('Hips')[:, 1]) / self.leg


def peaks(sig, thr, min_gap, fps):
    out = []
    gap = int(min_gap * fps)
    order = np.argsort(-sig)
    for i in order:
        if sig[i] < thr: break
        if 2 < i < len(sig) - 3 and sig[i] >= sig[i - 2] and sig[i] >= sig[i + 2]:
            if all(abs(i - o) > gap for o in out):
                out.append(int(i))
    return sorted(out)


def yaw_to_x(d):
    return math.atan2(d[2], d[0])


def make_clip(tk, a, b, yaw, impact=None, keep_move=0.3, ref=None, inplace=False, ground_all=False):
    """裁切 [a, b)，旋轉讓方向朝 +X，降頻，回傳 dict"""
    step = max(1, round(tk.fps / OUT_FPS))
    sel = np.arange(a, b, step)
    qy = qaxis('Y', np.full(len(sel), yaw))  # 繞 Y 轉 yaw：方向 (cos yaw, sin yaw) 轉到 +X
    q = tk.q[sel].copy()
    q[:, 0] = qmul(qy, q[:, 0])
    root = qrot(qy, tk.root[sel])
    refp = qrot(qaxis('Y', np.array(yaw)), tk.root[ref if ref is not None else a])
    rel = root - refp
    if inplace:
        # 移除整體前進：減掉首尾之間的線性位移
        n = len(sel)
        lin = np.linspace(0, 1, n)[:, None] * (rel[-1] - rel[0])[None, :]
        rel = rel - rel[0] - lin
        rel[:, 1] = root[:, 1]
    else:
        rel[:, [0, 2]] *= keep_move
        rel[:, 1] = root[:, 1]
    # 讓片段中最低的腳剛好踩在地面
    feet = [tk.idx[n] for n in ('LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot')]
    ground = tk.wp[sel][:, feet, 1].min()
    if ground_all:
        # 倒地動作：用全身最低點（躺下時是背或頭）貼地
        ground = tk.wp[sel][:, :, 1].min()
        rel[:, 1] -= ground - 1.2
    else:
        rel[:, 1] -= ground - 0.6
    # 換算到共用骨架的大小
    rel *= SKEL_LEG / tk.leg
    keepj = [k for k, j in enumerate(tk.joints) if j['name'] not in KEEP_DROP]
    q = q[:, keepj]
    # 讓相鄰格的四元數同號，內插時不會繞遠路
    for f in range(1, len(sel)):
        dots = np.sum(q[f] * q[f - 1], -1)
        q[f][dots < 0] *= -1
    clip = {
        'n': int(len(sel)),
        'fps': OUT_FPS,
        'root': np.round(rel, 2).flatten().tolist(),
        'q': np.round(q, 3).flatten().tolist(),
    }
    if impact is not None:
        clip['impact'] = round((impact - a) / step, 2)
    return clip


def pose_dist(tk, f1, f2):
    a, b = tk.q[f1, 1:], tk.q[f2, 1:]
    return float(np.sum(1 - np.abs(np.sum(a * b, -1))))


def best_loop(tk, lo, hi, lmin, lmax, cond=None):
    """找首尾姿勢最接近、可循環的片段"""
    best, bs = None, 1e9
    fps = tk.fps
    for s in range(int(lo * fps), int(hi * fps), max(1, fps // 20)):
        for L in range(int(lmin * fps), int(lmax * fps), max(1, fps // 30)):
            e = s + L
            if e >= tk.q.shape[0]: break
            if cond and not cond(s, e): continue
            d = pose_dist(tk, s, e)
            if d < bs: bs, best = d, (s, e)
    return best, bs


# ---------- 合成：格鬥遊戲式的備戰架式（上下彈動、可循環） ----------
def qinv(q): return q * np.array([1, -1, -1, -1])

def qfromto(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    c = np.cross(a, b); d = float(np.dot(a, b))
    if d < -0.9999: return np.array([0.0, 1, 0, 0])
    q = np.array([1 + d, *c]); return q / np.linalg.norm(q)

def qaxis1(axis_vec, ang):
    v = axis_vec / np.linalg.norm(axis_vec)
    return np.array([math.cos(ang / 2), *(v * math.sin(ang / 2))])

class Synth:
    """讓合成出來的片段可以直接丟進 make_clip"""
    def __init__(self, base, q, root):
        self.joints, self.idx, self.leg = base.joints, base.idx, base.leg
        self.fps = OUT_FPS
        self.q, self.root = q, root
        self.wp, _ = fk(self.joints, q, root)

def world_rotate(joints, q, root, j, R):
    """把關節 j 在世界座標再轉 R（子關節跟著動）"""
    _, wq = fk(joints, q[None], root[None])
    wq = wq[0]
    p = joints[j]['parent']
    q[j] = qmul(qinv(wq[p]), qmul(R, wq[j]))

def ik_leg(tk, q, root, side, target):
    """雙骨 IK：調整大腿、小腿，讓腳踝回到 target，腳掌方向不變"""
    J = tk.joints; ix = tk.idx
    iU, iL, iF = ix[side + 'UpLeg'], ix[side + 'Leg'], ix[side + 'Foot']
    iP = J[iU]['parent']
    wp, wq = fk(J, q[None], root[None]); wp, wq = wp[0], wq[0]
    H, K, A = wp[iU], wp[iL], wp[iF]
    l1, l2 = np.linalg.norm(K - H), np.linalg.norm(A - K)
    TH = target - H
    d = np.clip(np.linalg.norm(TH), abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3)
    u = TH / np.linalg.norm(TH)
    perp = (K - H) - np.dot(K - H, u) * u
    perp /= np.linalg.norm(perp) + 1e-9
    cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    K2 = H + u * l1 * cosA + perp * l1 * math.sqrt(max(0, 1 - cosA * cosA))
    q1 = qfromto(K - H, K2 - H)
    WU = qmul(q1, wq[iU])
    A1 = K2 + qrot(q1, A - K)
    q2 = qfromto(A1 - K2, target - K2)
    WL = qmul(q2, qmul(q1, wq[iL]))
    q[iU] = qmul(qinv(wq[iP]), WU)
    q[iL] = qmul(qinv(WU), WL)
    q[iF] = qmul(qinv(WL), wq[iF])

def make_stance(tk, f, n=22, drop=0.07, amp=0.09, arm_lower=0.7):
    J, ix = tk.joints, tk.idx
    q0, r0 = tk.q[f].copy(), tk.root[f].copy()
    wp0 = tk.wp[f]
    lat = wp0[ix['RightArm']] - wp0[ix['LeftArm']]; lat[1] = 0; lat /= np.linalg.norm(lat)
    feet = {s: wp0[ix[s + 'Foot']].copy() for s in ('Left', 'Right')}
    # 拳頭放低到胸口：找出讓手往下的旋轉方向
    def hand_y(qq, side):
        w, _ = fk(J, qq[None], r0[None]); return w[0][ix[side + 'Hand']][1]
    signs = {}
    for side in ('Left', 'Right'):
        t = q0.copy(); world_rotate(J, t, r0, ix[side + 'Arm'], qaxis1(lat, 0.2))
        signs[side] = 1 if hand_y(t, side) < hand_y(q0, side) else -1
    sp_sign = 1
    t = q0.copy(); world_rotate(J, t, r0, ix['Spine'], qaxis1(lat, 0.1))
    w1, _ = fk(J, t[None], r0[None]); w0, _ = fk(J, q0[None], r0[None])
    fwd = np.cross(lat, [0, 1, 0])
    if np.dot(w1[0][ix['Head']] - w0[0][ix['Head']], fwd) < 0: sp_sign = -1
    Q, Rt = [], []
    for i in range(n):
        ph = i / n * 2 * math.pi
        bob = 0.5 - 0.5 * math.cos(ph)                     # 0→1→0
        q = q0.copy()
        r = r0.copy(); r[1] -= tk.leg * (drop + amp * bob)
        # 上半身慢半拍：身體微微前傾、雙拳上下
        lagb = 0.5 - 0.5 * math.cos(ph - 0.9)
        world_rotate(J, q, r, ix['Spine'], qaxis1(lat, sp_sign * (0.06 + 0.05 * lagb)))
        for side in ('Left', 'Right'):
            world_rotate(J, q, r, ix[side + 'Arm'], qaxis1(lat, signs[side] * (arm_lower + 0.07 * lagb)))
        for side in ('Left', 'Right'):
            ik_leg(tk, q, r, side, feet[side])
        Q.append(q); Rt.append(r)
    syn = Synth(tk, np.array(Q), np.array(Rt))
    # 檢查：腳的位置每一格都沒有滑動
    slip = max(np.linalg.norm(syn.wp[:, ix[s + 'Foot']] - feet[s], axis=1).max() for s in ('Left', 'Right'))
    assert slip < 0.05, f'腳滑動 {slip}'
    # 朝向：後腳 → 前腳 的方向轉成 +X（側身，前拳對著敵人）
    lf, rf = feet['Left'], feet['Right']
    front, back = (lf, rf) if np.dot(lf - rf, fwd) > 0 else (rf, lf)
    d = front - back; d[1] = 0
    return syn, yaw_to_x(d)


def main():
    src = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else pathlib.Path(__file__).resolve().parents[2] / 'js' / 'mocap.js'
    T = {n: Take(src / f'{n}.bvh') for n in ['135_04', '135_07', '135_09', '135_11', '14_01', '07_01', '141_01', '90_05', '90_18', '90_16', '91_59']}
    base = T['135_09']
    global SKEL_LEG
    SKEL_LEG = base.leg
    clips = {}

    def strike(tk, side, kind, n, thr, pre, post, gap=0.8, prefix=None, keep=0.3):
        if kind == 'punch':
            sig = tk.ext(side)
        else:
            sig = tk.foot_h(side)
        pk = peaks(sig, thr, gap, tk.fps)
        res = []
        for p in pk:
            a, b = p - int(pre * tk.fps), p + int(post * tk.fps)
            if a < 0 or b >= tk.q.shape[0]: continue
            if kind == 'punch':
                d = tk.P(side + 'Hand')[p] - tk.P(side + 'Arm')[p]
            else:
                d = tk.P(side + 'Foot')[p] - tk.P('Hips')[p]
            yaw = yaw_to_x(d)
            chk = qrot(qaxis('Y', np.array(yaw)), d)
            err = math.degrees(math.atan2(chk[2], chk[0]))
            assert abs(err) < 1, f'方向校正失敗：{err:.1f} 度'
            res.append(make_clip(tk, a, b, yaw, impact=p, keep_move=keep, ref=p))
            if len(res) >= n: break
        for k, c in enumerate(res):
            clips[f'{prefix or kind}{side[0]}{k}'] = c
        print(f'{prefix or kind} {side}: 找到 {len(pk)} 個，使用 {len(res)}')

    # 出拳：空手道上段突（Oizuki）與拳擊
    strike(base, 'Right', 'punch', 2, 0.9, 0.35, 0.3, prefix='oi')
    strike(base, 'Left', 'punch', 2, 0.9, 0.35, 0.3, prefix='oi')
    strike(T['14_01'], 'Right', 'punch', 3, 0.9, 0.25, 0.25, gap=0.5, prefix='box', keep=0.2)
    strike(T['14_01'], 'Left', 'punch', 3, 0.9, 0.25, 0.25, gap=0.5, prefix='box', keep=0.2)
    # 踢腿：前踢、迴旋踢、側踢、飛踢
    strike(T['135_04'], 'Right', 'kick', 2, -0.35, 0.45, 0.4, prefix='front')
    strike(T['135_04'], 'Left', 'kick', 1, -0.35, 0.45, 0.4, prefix='front')
    strike(T['135_07'], 'Right', 'kick', 2, -0.3, 0.5, 0.45, prefix='round')
    strike(T['135_07'], 'Left', 'kick', 1, -0.3, 0.5, 0.45, prefix='round')
    strike(T['135_11'], 'Right', 'kick', 2, -0.3, 0.5, 0.45, prefix='side')
    strike(T['135_11'], 'Left', 'kick', 1, -0.3, 0.5, 0.45, prefix='side')
    strike(T['90_05'], 'Right', 'kick', 1, -0.6, 0.7, 0.6, prefix='jump', keep=0.15)
    if 'jumpR0' not in clips: strike(T['90_05'], 'Left', 'kick', 1, -0.6, 0.7, 0.6, prefix='jump', keep=0.15)

    # 待機：拳擊架式，雙手護在臉前、沒有出拳
    bx = T['14_01']
    exR, exL = bx.ext('Right'), bx.ext('Left')
    hy = (bx.P('RightHand')[:, 1] + bx.P('LeftHand')[:, 1]) / 2 - bx.P('Neck')[:, 1]
    guard = (exR < 0.75) & (exL < 0.75) & (hy > -0.35 * bx.arm)
    def cond(s, e): return guard[s:e].mean() > 0.97
    loop, d = best_loop(bx, 0, bx.q.shape[0] / bx.fps - 3, 1.2, 2.2, cond)
    if loop:
        s, e = loop
        fwd = bx.P('Hips')[s:e].mean(0)
        # 面向：兩手中點相對髖部的方向
        hand = (bx.P('RightHand')[s:e] + bx.P('LeftHand')[s:e]).mean(0) / 2
        yaw = yaw_to_x(hand - fwd)
        clips['idle'] = make_clip(bx, s, e, yaw, keep_move=0.25)
        print('待機', s / bx.fps, e / bx.fps, '首尾差', round(d, 3))

    # 走路、跑步（原地循環）
    for name, key, lmin, lmax in [('walk', '07_01', 0.9, 1.4), ('run', '141_01', 0.45, 0.85)]:
        tk = T[key]
        dur = tk.q.shape[0] / tk.fps
        loop, d = best_loop(tk, 0.05, max(0.1, dur - lmin - 0.05), lmin, lmax)
        s, e = loop
        mv = tk.root[e] - tk.root[s]
        yaw = yaw_to_x(mv)
        chk = qrot(qaxis('Y', np.array(yaw)), mv)
        assert abs(math.degrees(math.atan2(chk[2], chk[0]))) < 1
        clips[name] = make_clip(tk, s, e, yaw, inplace=True)
        print(name, s / tk.fps, e / tk.fps, '首尾差', round(d, 3))

    # 受擊反應與倒地：把「被推出去的方向」轉成 -X（遠離面前的攻擊者）
    def react(key, name, t0, t1, keep, ground_all, part='Hips'):
        tk = T[key]
        a, b = int(t0 * tk.fps), int(t1 * tk.fps)
        d = tk.P(part)[b] - tk.P(part)[a]
        d[1] = 0
        yaw = yaw_to_x(-d)
        chk = qrot(qaxis('Y', np.array(yaw)), -d)
        assert abs(math.degrees(math.atan2(chk[2], chk[0]))) < 1
        clips[name] = make_clip(tk, a, b, yaw, keep_move=keep, ref=a, ground_all=ground_all)
        print(name, t0, t1, '位移', round(float(np.linalg.norm(d)), 1))
    react('91_59', 'hit0', 0.55, 1.5, 0.6, False)
    react('91_59', 'hit1', 0.55, 1.05, 0.6, False)
    react('90_18', 'fallB0', 0.6, 2.2, 0.5, True, part='Head')
    react('90_16', 'fallF0', 3.25, 4.7, 0.5, True, part='Head')

    # 主角待機：格鬥架式彈動
    T['13_17'] = Take(src / '13_17.bvh')
    syn, yaw = make_stance(T['13_17'], 3264)
    clips['stance'] = make_clip(syn, 0, syn.q.shape[0], yaw, keep_move=0.0)
    print('架式', syn.q.shape[0], '格')

    keepj = [k for k, j in enumerate(base.joints) if j['name'] not in KEEP_DROP]
    remap = {old: new for new, old in enumerate(keepj)}
    skel = {
        'names': [base.joints[k]['name'] for k in keepj],
        'parents': [remap.get(base.joints[k]['parent'], -1) for k in keepj],
        'offsets': [np.round(base.joints[k]['offset'], 3).tolist() for k in keepj],
        'ends': [None if base.joints[k]['end'] is None else np.round(base.joints[k]['end'], 3).tolist() for k in keepj],
    }
    rest = base.wp[0]
    skel['height'] = round(float(rest[:, 1].max() - rest[:, 1].min() + 2), 2)
    payload = {'skeleton': skel, 'clips': clips,
               'credit': 'Motion data: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH conversion by Bruce Hahne. Funded by NSF EIA-0196217.'}
    js = '// 由 tools/mocap/extract.py 產生，請勿手動修改\n// 動作來源：CMU Graphics Lab Motion Capture Database（mocap.cs.cmu.edu）\nwindow.MOCAP = ' + json.dumps(payload, separators=(',', ':')) + ';\n'
    out.write_text(js)
    print('輸出', out, f'{len(js) / 1024:.0f} KB', '片段：', ', '.join(clips))


SKEL_LEG = 1.0
if __name__ == '__main__':
    main()
