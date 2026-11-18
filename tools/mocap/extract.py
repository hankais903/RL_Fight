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


HINGE = {'LeftForeArm', 'RightForeArm', 'LeftLeg', 'RightLeg'}

ARM_JOINTS = {'LeftShoulder', 'LeftArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightHand'}

def exaggerate(q, joints, k, k_arm=None):
    """動作誇張化：每個關節相對片段第一格的旋轉角度乘上 k（手肘、膝蓋不放大，避免反折）"""
    base = q[0]
    out = q.copy()
    for j, jt in enumerate(joints):
        if jt['name'] in HINGE or jt['name'] in KEEP_DROP: continue
        rel = qmul(qinv(np.broadcast_to(base[j], q[:, j].shape)), q[:, j])
        rel[rel[:, 0] < 0] *= -1
        w = np.clip(rel[:, 0], -1, 1)
        ang = 2 * np.arccos(w)
        axis = rel[:, 1:] / (np.linalg.norm(rel[:, 1:], axis=1, keepdims=True) + 1e-9)
        kk = k_arm if (k_arm is not None and jt['name'] in ARM_JOINTS) else k
        na = np.minimum(ang * kk, np.pi * 0.92)
        nr = np.concatenate([np.cos(na / 2)[:, None], axis * np.sin(na / 2)[:, None]], 1)
        out[:, j] = qmul(np.broadcast_to(base[j], nr.shape), nr)
    return out


def make_clip(tk, a, b, yaw, impact=None, keep_move=0.3, ref=None, inplace=False, ground_all=False, exag=1.0, exag_arm=None):
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
    if exag != 1.0:
        q = exaggerate(q, tk.joints, exag, exag_arm)
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

def make_stance(tk, f, n=22, drop=0.07, amp=0.09, arm_lower=0.4):
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
    fwd = np.cross([0, 1, 0], lat)          # 胸口朝向（up × 右 = 前）
    # 對手方向：後腳 → 前腳
    lf0, rf0 = feet['Left'], feet['Right']
    front0, back0 = (lf0, rf0) if np.dot(lf0 - rf0, fwd) > 0 else (rf0, lf0)
    opp = front0 - back0; opp[1] = 0; opp /= np.linalg.norm(opp)
    lean_axis = np.cross([0, 1, 0], opp)    # 繞這個軸轉，頭會往對手方向或反方向
    def head_ahead(ang):
        t = q0.copy(); world_rotate(J, t, r0, ix['Spine'], qaxis1(lean_axis, ang))
        w, _ = fk(J, t[None], r0[None]); w = w[0]
        return float(np.dot(w[ix['Head']] - w[ix['Hips']], opp)) / tk.leg
    sp_sign = 1 if head_ahead(0.1) > head_ahead(0) else -1
    # 找出前傾角度：頭部超過髖部約 0.2 個腿長
    lo, hi = 0.0, 0.42   # 最多前傾約 24 度
    for _ in range(20):
        mid = (lo + hi) / 2
        if head_ahead(sp_sign * mid) < 0.1: lo = mid
        else: hi = mid
    base_lean = lo
    print('架式前傾', round(math.degrees(base_lean), 1), '度，原本頭部位置', round(head_ahead(0), 2))
    # 手肘往外張的方向：讓手肘離脊椎遠一點
    abd = {}
    for side in ('Left', 'Right'):
        t = q0.copy(); world_rotate(J, t, r0, ix[side + 'Arm'], qaxis1(opp, 0.2))
        w1, _ = fk(J, t[None], r0[None]); w0, _ = fk(J, q0[None], r0[None])
        e1 = np.linalg.norm((w1[0][ix[side + 'ForeArm']] - w1[0][ix['Spine1']])[[0, 2]])
        e0 = np.linalg.norm((w0[0][ix[side + 'ForeArm']] - w0[0][ix['Spine1']])[[0, 2]])
        abd[side] = 1 if e1 > e0 else -1
    Q, Rt = [], []
    for i in range(n):
        ph = i / n * 2 * math.pi
        bob = 0.5 - 0.5 * math.cos(ph)                     # 0→1→0
        q = q0.copy()
        r = r0.copy(); r[1] -= tk.leg * (drop + amp * bob)
        # 上半身慢半拍：身體微微前傾、雙拳上下
        lagb = 0.5 - 0.5 * math.cos(ph - 0.9)
        world_rotate(J, q, r, ix['Spine'], qaxis1(lean_axis, sp_sign * (base_lean + 0.05 * lagb)))
        for side in ('Left', 'Right'):
            world_rotate(J, q, r, ix[side + 'Arm'], qaxis1(lat, signs[side] * (arm_lower + 0.07 * lagb)))
            world_rotate(J, q, r, ix[side + 'Arm'], qaxis1(opp, abd[side] * 0.45))   # 手肘往外張
            # 手肘打開一些，拳頭往前推離身體
            w, _ = fk(J, q[None], r[None]); w = w[0]
            ua = w[ix[side + 'ForeArm']] - w[ix[side + 'Arm']]; fa = w[ix[side + 'Hand']] - w[ix[side + 'ForeArm']]
            ax = np.cross(ua, fa)
            if np.linalg.norm(ax) > 1e-6:
                world_rotate(J, q, r, ix[side + 'ForeArm'], qaxis1(ax, -0.45))
        for side in ('Left', 'Right'):
            ik_leg(tk, q, r, side, feet[side])
        Q.append(q); Rt.append(r)
    syn = Synth(tk, np.array(Q), np.array(Rt))
    # 檢查：腳的位置每一格都沒有滑動
    slip = max(np.linalg.norm(syn.wp[:, ix[s + 'Foot']] - feet[s], axis=1).max() for s in ('Left', 'Right'))
    assert slip < 0.05, f'腳滑動 {slip}'
    # 朝向：後腳 → 前腳 的方向轉成 +X（側身，前拳對著敵人）
    d = opp.copy()
    return syn, yaw_to_x(d)


def classify_punches(tk, side):
    """依拳頭軌跡把出拳分成直拳、勾拳、上勾拳。回傳 [(類別, 命中格, 清楚程度)]"""
    ix = tk.idx; fps = tk.fps
    hand = tk.P(side + 'Hand'); chest = tk.P('Spine1')
    rel = hand - chest
    v = np.zeros(len(rel)); v[1:] = np.linalg.norm(np.diff(rel, axis=0), axis=1) * fps / tk.leg
    lat = tk.P('RightArm') - tk.P('LeftArm'); lat[:, 1] = 0
    lat /= np.linalg.norm(lat, axis=1, keepdims=True)
    fwd = np.cross(np.array([0, 1, 0]), lat)
    inward = -lat if side == 'Right' else lat          # 往身體中線的方向
    ext = tk.ext(side)
    out = []
    pk = peaks(v, 2.2, 0.35, fps)
    for p in pk:
        a = p - int(0.12 * fps)
        # 命中：速度降到峰值 35% 以下的那一格（最多 0.12 秒）
        i = p
        while i < min(len(v) - 1, p + int(0.12 * fps)) and v[i] > v[p] * 0.35: i += 1
        if a < 0 or i >= len(v): continue
        D = rel[i] - rel[a]
        n = np.linalg.norm(D) / tk.leg
        if n < 0.25: continue
        dF, dI, dU = np.dot(D, fwd[p]), np.dot(D, inward[p]), D[1]
        L = np.linalg.norm(D)
        e = ext[i]
        if dF > 0.75 * L and e > 0.93 and abs(dU) < 0.35 * L:
            out.append(('straight', i, dF / L * v[p]))
        elif dU > 0.6 * L and dF > -0.1 * L:
            out.append(('upper', i, dU / L * v[p]))
        elif dI > 0.45 * L and abs(dU) < 0.5 * L and 0.4 < e < 0.95 and dF > -0.2 * L:
            out.append(('hook', i, dI / L * v[p]))
    return out


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
            res.append(make_clip(tk, a, b, yaw, impact=p, keep_move=0.6, ref=a, exag=1.35))
            if len(res) >= n: break
        for k, c in enumerate(res):
            clips[f'{prefix or kind}{side[0]}{k}'] = c
        print(f'{prefix or kind} {side}: 找到 {len(pk)} 個，使用 {len(res)}')

    # 出拳：空手道上段突（Oizuki）與拳擊
    # 出拳：從空手道與多段拳擊動作分類出 直拳 / 勾拳 / 上勾拳
    for k in ['13_17', '13_18', '14_02', '14_03', '15_13', '17_10']:
        if k not in T: T[k] = Take(src / f'{k}.bvh')
    pool = {}
    for k in ['135_09', '14_01', '13_17', '13_18', '14_02', '14_03', '15_13', '17_10']:
        tk = T[k]
        for side in ('Right', 'Left'):
            for cls, i, score in classify_punches(tk, side):
                pool.setdefault((cls, side), []).append((score, k, i))
    for (cls, side), lst in sorted(pool.items()):
        lst.sort(reverse=True)
        used = []
        for score, k, i in lst:
            if any(k == k2 and abs(i - i2) < T[k].fps for k2, i2 in used): continue
            tk = T[k]
            a, b = i - int(0.32 * tk.fps), i + int(0.28 * tk.fps)
            if a < 0 or b >= tk.q.shape[0]: continue
            d = tk.P(side + 'Hand')[i] - tk.P('Spine1')[i]
            # 直拳：只放大扭腰與蹬腿，手臂維持原本的直線；勾拳、上勾拳整體放大
            ex, exa, mv = (1.2, 1.0, 1.0) if cls == 'straight' else (1.5, 1.35, 0.7)
            clips[f'{cls}{side[0]}{len(used)}'] = make_clip(tk, a, b, yaw_to_x(d), impact=i, keep_move=mv, ref=a, exag=ex, exag_arm=exa)
            used.append((k, i))
            if len(used) >= 3: break
        print(f'{cls} {side}: 候選 {len(lst)}，使用 {len(used)}')
    # 踢腿：前踢、迴旋踢、側踢、飛踢
    strike(T['135_04'], 'Right', 'kick', 2, -0.35, 0.45, 0.4, prefix='front')
    strike(T['135_04'], 'Left', 'kick', 1, -0.35, 0.45, 0.4, prefix='front')
    strike(T['135_07'], 'Right', 'kick', 2, -0.3, 0.5, 0.45, prefix='round')
    strike(T['135_07'], 'Left', 'kick', 1, -0.3, 0.5, 0.45, prefix='round')
    strike(T['135_11'], 'Right', 'kick', 2, -0.3, 0.5, 0.45, prefix='side')
    strike(T['135_11'], 'Left', 'kick', 1, -0.3, 0.5, 0.45, prefix='side')
    # 飛踢：多種跳躍踢、跳躍旋踢
    fly = []
    for k in ['90_05', '90_06', '90_07', '75_16', '88_06', '87_01']:
        if k not in T: T[k] = Take(src / f'{k}.bvh')
        tk = T[k]
        for side in ('Right', 'Left'):
            sig = tk.foot_h(side)
            airborne = (tk.P('LeftToeBase')[:, 1] > tk.leg * 0.25) & (tk.P('RightToeBase')[:, 1] > tk.leg * 0.25)
            for p in peaks(np.where(airborne, sig, -9), -0.35, 0.8, tk.fps):
                fly.append((float(sig[p]), k, side, p))
    fly.sort(reverse=True)
    nfly = {'R': 0, 'L': 0}
    for h, k, side, p in fly:
        tk = T[k]
        s0 = side[0]
        if nfly[s0] >= 3: continue
        a, b = p - int(0.6 * tk.fps), p + int(0.55 * tk.fps)
        if a < 0 or b >= tk.q.shape[0]: continue
        d = tk.P(side + 'Foot')[p] - tk.P('Hips')[p]
        clips[f'fly{s0}{nfly[s0]}'] = make_clip(tk, a, b, yaw_to_x(d), impact=p, keep_move=0.9, ref=a, exag=1.3)
        nfly[s0] += 1
    print('飛踢', nfly)

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

    # 雙腳往前跳（閒置一秒後跳回中央用）：蹲下蓄力 → 起跳 → 屈膝落地；跳躍方向轉成 +X，水平位移移除
    if '16_05' not in T: T['16_05'] = Take(src / '16_05.bvh')
    tk = T['16_05']
    a, b = int(0.75 * tk.fps), int(2.0 * tk.fps)
    d = tk.P('Hips')[b] - tk.P('Hips')[a]; d[1] = 0
    clips['jumpF0'] = make_clip(tk, a, b, yaw_to_x(d), inplace=True)
    print('跳回', '往前距離', round(float(np.linalg.norm(d)), 1))

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
