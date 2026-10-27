'use strict';

// 체스: 규칙과 컴퓨터만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 표준 체스 규칙: 말마다 다른 움직임, 체크·체크메이트·스테일메이트, 캐슬링, 앙파상, 프로모션(퀸·룩·비숍·나이트)
// - 무승부: 스테일메이트 · 50수 규칙(잡거나 폰을 움직이지 않고 양쪽 50번씩) · 같은 모양 세 번 · 기물 부족(킹만, 킹+비숍/나이트 하나 등)
// - 바깥에 보이는 칸 번호는 0~63 (왼쪽 위 a8 이 0, 오른쪽 아래 h1 이 63, 가로로 한 줄씩). 안에서는 계산이 빠른 0x88 판을 쓴다
// - 0 번 편이 흰색(아래에서 위로)이고 먼저 둔다, 1 번 편이 검정
const LOGIC_CHESS = (() => {
const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;                // 기물 번호. 검정은 +8
const BLACK = 8;
const typeOf = (v) => v & 7;
const colorOf = (v) => (v >> 3) & 1;                          // 0 흰색 · 1 검정 (빈칸은 쓰지 않는다)
const WK = 1, WQ = 2, BK = 4, BQ = 8;                         // 캐슬링 권리 비트
const F_CAP = 1, F_EP = 2, F_CK = 4, F_CQ = 8, F_DBL = 16;    // 수의 성질
const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33], KING = [-17, -16, -15, -1, 1, 15, 16, 17];
const DIAG = [-17, -15, 15, 17], ORTH = [-16, -1, 1, 16];
const to88 = (i) => (i >> 3) * 16 + (i & 7), from88 = (s) => (s >> 4) * 8 + (s & 7);
const onBoard = (s) => (s & 0x88) === 0;
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const GLYPH = { [P]: 'p', [N]: 'n', [B]: 'b', [R]: 'r', [Q]: 'q', [K]: 'k' };

function rng(seed) {                                           // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 수 하나를 정수로: 출발 | 도착<<8 | 프로모션<<16 | 성질<<20 (칸은 0x88 번호)
const mk = (from, to, promo, flags) => from | (to << 8) | (promo << 16) | (flags << 20);
const mFrom = (m) => m & 0xff, mTo = (m) => (m >> 8) & 0xff, mPromo = (m) => (m >> 16) & 0xf, mFlags = (m) => (m >> 20) & 0xff;

// ---------- 판 만들기 ----------
function fromFen(fen) {
  const [place, side, castle, ep, half, full] = String(fen).trim().split(/\s+/);
  const st = { b: new Int8Array(128), side: side === 'b' ? 1 : 0, castle: 0, ep: -1, half: Number(half) || 0, full: Number(full) || 1, k: [-1, -1], stack: [], keys: [], over: false };
  const rows = place.split('/');
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { c += Number(ch); continue; }
      const t = 'pnbrqk'.indexOf(ch.toLowerCase()) + 1;
      const v = t | (ch === ch.toLowerCase() ? BLACK : 0);
      st.b[r * 16 + c] = v;
      if (t === K) st.k[ch === ch.toLowerCase() ? 1 : 0] = r * 16 + c;
      c++;
    }
  }
  for (const ch of castle || '') st.castle |= { K: WK, Q: WQ, k: BK, q: BQ }[ch] || 0;
  if (ep && ep !== '-') st.ep = (8 - Number(ep[1])) * 16 + (ep.charCodeAt(0) - 97);
  st.keys.push(posKey(st));
  return st;
}
function toFen(st) {
  let out = '';
  for (let r = 0; r < 8; r++) {
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const v = st.b[r * 16 + c];
      if (!v) { empty++; continue; }
      if (empty) { out += empty; empty = 0; }
      const ch = GLYPH[typeOf(v)];
      out += colorOf(v) ? ch : ch.toUpperCase();
    }
    if (empty) out += empty;
    if (r < 7) out += '/';
  }
  const castle = (st.castle & WK ? 'K' : '') + (st.castle & WQ ? 'Q' : '') + (st.castle & BK ? 'k' : '') + (st.castle & BQ ? 'q' : '');
  const ep = st.ep >= 0 ? String.fromCharCode(97 + (st.ep & 7)) + (8 - (st.ep >> 4)) : '-';
  return `${out} ${st.side ? 'b' : 'w'} ${castle || '-'} ${ep} ${st.half} ${st.full}`;
}
// 같은 모양인지 알아보는 열쇠 (말 배치·차례·캐슬링 권리·앙파상 가능 여부)
function posKey(st) {
  let k = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const v = st.b[r * 16 + c]; k += v ? String.fromCharCode(64 + v) : '.'; }
  return `${k}${st.side}${st.castle}${epCapturable(st) ? st.ep : -1}`;
}
function epCapturable(st) {                                      // 앙파상으로 실제로 잡을 수 있는 폰이 있을 때만 같은 모양 비교에 넣는다
  if (st.ep < 0) return false;
  const pawn = P | (st.side ? BLACK : 0);
  const dir = st.side ? -16 : 16;
  for (const d of [-1, 1]) { const s = st.ep + dir + d; if (onBoard(s) && st.b[s] === pawn) return true; }
  return false;
}
function newGame() { return fromFen(START); }
function clone(st) { return { ...st, b: Int8Array.from(st.b), k: st.k.slice(), stack: st.stack.slice(), keys: st.keys.slice() }; }

// ---------- 공격·수 만들기 ----------
function attacked(st, sq, by) {                                  // sq 칸을 by 편이 공격하는가
  const b = st.b, hi = by ? BLACK : 0;
  const pd = by ? -16 : 16;                                      // 공격하는 폰은 sq 에서 이만큼 떨어져 있다 (흰 폰은 아래에서 위로 간다)
  for (const d of [pd - 1, pd + 1]) { const s = sq + d; if (onBoard(s) && b[s] === (P | hi)) return true; }
  for (const d of KNIGHT) { const s = sq + d; if (onBoard(s) && b[s] === (N | hi)) return true; }
  for (const d of KING) { const s = sq + d; if (onBoard(s) && b[s] === (K | hi)) return true; }
  for (const d of DIAG) { for (let s = sq + d; onBoard(s); s += d) { const v = b[s]; if (v) { if (v === (B | hi) || v === (Q | hi)) return true; break; } } }
  for (const d of ORTH) { for (let s = sq + d; onBoard(s); s += d) { const v = b[s]; if (v) { if (v === (R | hi) || v === (Q | hi)) return true; break; } } }
  return false;
}
const inCheck = (st, side = st.side) => attacked(st, st.k[side], 1 - side);

function pseudo(st, caps) {                                      // 규칙에 맞는 모든 수(왕이 잡히는 수는 아직 거르지 않음). caps 가 참이면 잡는 수만
  const out = [], b = st.b, side = st.side, hi = side ? BLACK : 0;
  const fwd = side ? 16 : -16, startR = side ? 1 : 6, promoR = side ? 7 : 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const s = r * 16 + c, v = b[s];
    if (!v || (v & BLACK) !== hi) continue;
    const t = typeOf(v);
    if (t === P) {
      const one = s + fwd;
      if (!caps && !b[one]) {
        if ((one >> 4) === promoR) for (const pr of [Q, R, B, N]) out.push(mk(s, one, pr, 0));
        else {
          out.push(mk(s, one, 0, 0));
          const two = one + fwd;
          if (r === startR && !b[two]) out.push(mk(s, two, 0, F_DBL));
        }
      }
      for (const dc of [-1, 1]) {
        const to = one + dc;
        if (!onBoard(to)) continue;
        const tv = b[to];
        if (tv && (tv & BLACK) !== hi) {
          if ((to >> 4) === promoR) for (const pr of [Q, R, B, N]) out.push(mk(s, to, pr, F_CAP));
          else out.push(mk(s, to, 0, F_CAP));
        } else if (to === st.ep && !tv) out.push(mk(s, to, 0, F_CAP | F_EP));
      }
    } else if (t === N || t === K) {
      for (const d of (t === N ? KNIGHT : KING)) {
        const to = s + d;
        if (!onBoard(to)) continue;
        const tv = b[to];
        if (!tv) { if (!caps) out.push(mk(s, to, 0, 0)); } else if ((tv & BLACK) !== hi) out.push(mk(s, to, 0, F_CAP));
      }
    } else {
      const dirs = t === B ? DIAG : t === R ? ORTH : DIAG.concat(ORTH);
      for (const d of dirs) for (let to = s + d; onBoard(to); to += d) {
        const tv = b[to];
        if (!tv) { if (!caps) out.push(mk(s, to, 0, 0)); continue; }
        if ((tv & BLACK) !== hi) out.push(mk(s, to, 0, F_CAP));
        break;
      }
    }
  }
  if (!caps) {                                                   // 캐슬링: 왕과 룩이 안 움직였고, 사이가 비었고, 왕이 체크 중이거나 지나가는 칸이 공격받으면 안 된다
    const home = side ? 4 : 116, enemy = 1 - side;
    if (st.k[side] === home && !attacked(st, home, enemy)) {
      const rook = R | hi;
      if ((st.castle & (side ? BK : WK)) && b[home + 3] === rook && !b[home + 1] && !b[home + 2] && !attacked(st, home + 1, enemy) && !attacked(st, home + 2, enemy)) out.push(mk(home, home + 2, 0, F_CK));
      if ((st.castle & (side ? BQ : WQ)) && b[home - 4] === rook && !b[home - 1] && !b[home - 2] && !b[home - 3] && !attacked(st, home - 1, enemy) && !attacked(st, home - 2, enemy)) out.push(mk(home, home - 2, 0, F_CQ));
    }
  }
  return out;
}

const RIGHTS_LOST = new Int8Array(128).fill(15);                   // 이 칸에서 말이 움직이거나 잡히면 잃는 캐슬링 권리
RIGHTS_LOST[116] = ~(WK | WQ) & 15; RIGHTS_LOST[119] = ~WK & 15; RIGHTS_LOST[112] = ~WQ & 15;
RIGHTS_LOST[4] = ~(BK | BQ) & 15; RIGHTS_LOST[7] = ~BK & 15; RIGHTS_LOST[0] = ~BQ & 15;

function make(st, m) {                                            // 수를 둔다 (되돌릴 정보를 stack 에 쌓는다)
  const from = mFrom(m), to = mTo(m), promo = mPromo(m), fl = mFlags(m), b = st.b;
  const v = b[from];
  let cap = b[to];
  st.stack.push(cap, st.castle, st.ep, st.half);
  if (fl & F_EP) { const cs = to + (st.side ? -16 : 16); cap = b[cs]; b[cs] = 0; st.stack[st.stack.length - 4] = cap; }
  b[to] = promo ? (promo | (st.side ? BLACK : 0)) : v;
  b[from] = 0;
  if (fl & F_CK) { b[to + 1] = 0; b[to - 1] = R | (st.side ? BLACK : 0); }
  else if (fl & F_CQ) { b[to - 2] = 0; b[to + 1] = R | (st.side ? BLACK : 0); }
  if (typeOf(v) === K) st.k[st.side] = to;
  st.castle &= RIGHTS_LOST[from] & RIGHTS_LOST[to];
  st.ep = fl & F_DBL ? (from + to) >> 1 : -1;
  st.half = typeOf(v) === P || cap ? 0 : st.half + 1;
  if (st.side) st.full++;
  st.side ^= 1;
}
function unmake(st, m) {
  const from = mFrom(m), to = mTo(m), promo = mPromo(m), fl = mFlags(m), b = st.b;
  st.half = st.stack.pop(); st.ep = st.stack.pop(); st.castle = st.stack.pop(); const cap = st.stack.pop();
  st.side ^= 1;
  if (st.side) st.full--;
  const moved = promo ? (P | (st.side ? BLACK : 0)) : b[to];
  b[from] = moved;
  if (fl & F_EP) { b[to] = 0; b[to + (st.side ? -16 : 16)] = cap; } else b[to] = cap;
  if (fl & F_CK) { b[to - 1] = 0; b[to + 1] = R | (st.side ? BLACK : 0); }
  else if (fl & F_CQ) { b[to + 1] = 0; b[to - 2] = R | (st.side ? BLACK : 0); }
  if (typeOf(moved) === K) st.k[st.side] = from;
}
function legal(st, caps) {                                        // 합법인 수: 두고 나서 내 왕이 공격받지 않는 수만
  const out = [];
  for (const m of pseudo(st, caps)) {
    make(st, m);
    const ok = !attacked(st, st.k[st.side ^ 1], st.side);
    unmake(st, m);
    if (ok) out.push(m);
  }
  return out;
}
function perft(st, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legal(st)) { make(st, m); n += perft(st, depth - 1); unmake(st, m); }
  return n;
}

// ---------- 결과 ----------
function insufficient(st) {                                      // 어느 쪽도 체크메이트를 만들 수 없는 기물 구성
  const minors = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = st.b[r * 16 + c];
    if (!v) continue;
    const t = typeOf(v);
    if (t === P || t === R || t === Q) return false;
    if (t === B || t === N) minors.push({ t, sq: (r + c) & 1, side: colorOf(v) });
  }
  if (minors.length <= 1) return true;
  if (minors.every((m) => m.t === B) && minors.every((m) => m.sq === minors[0].sq)) return true;   // 비숍들이 모두 같은 색 칸
  return false;
}
// { over, winner(0·1·2 무승부·-1), reason, check }
function status(st) {
  const check = inCheck(st);
  if (!legal(st).length) return check ? { over: true, winner: 1 - st.side, reason: 'checkmate', check } : { over: true, winner: 2, reason: 'stalemate', check };
  if (insufficient(st)) return { over: true, winner: 2, reason: 'material', check };
  if (st.half >= 100) return { over: true, winner: 2, reason: 'fifty', check };
  const key = st.keys[st.keys.length - 1];
  if (st.keys.filter((k) => k === key).length >= 3) return { over: true, winner: 2, reason: 'repetition', check };
  return { over: false, winner: -1, reason: '', check };
}

// ---------- 바깥에서 쓰는 이름 ----------
const ext = (m) => ({ from: from88(mFrom(m)), to: from88(mTo(m)), promo: mPromo(m), cap: !!(mFlags(m) & F_CAP), ep: !!(mFlags(m) & F_EP), castle: mFlags(m) & F_CK ? 'k' : mFlags(m) & F_CQ ? 'q' : '' });
function legalMoves(st) { return legal(st).map(ext); }
// 사람·서버가 두는 수: 합법이 아니면 null. promo 는 2~5(나이트·비숍·룩·퀸), 프로모션이 아닌 수에는 무시된다 (빠뜨리면 퀸)
function move(st, from, to, promo) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > 63 || to < 0 || to > 63) return null;
  const f = to88(from), t = to88(to);
  const cands = legal(st).filter((m) => mFrom(m) === f && mTo(m) === t);
  if (!cands.length) return null;
  let m = cands[0];
  if (cands.length > 1) { const want = [N, B, R, Q].includes(promo) ? promo : Q; m = cands.find((x) => mPromo(x) === want); if (!m) return null; }
  const piece = st.b[f], captured = mFlags(m) & F_EP ? P | (st.side ? 0 : BLACK) : st.b[t];
  const who = st.side;
  make(st, m);
  st.keys.push(posKey(st));
  const res = status(st);
  return { ...ext(m), who, piece, captured, check: res.check, over: res.over, winner: res.winner, reason: res.reason };
}
function resultOf(st) { return status(st); }

// ---------- 컴퓨터 ----------
const VAL = [0, 100, 320, 330, 500, 900, 0];
// 기물 위치 점수 (위에서 아래로 8행, 흰색 기준. 검정은 위아래를 뒤집어 쓴다)
const PST = {
  [P]: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [N]: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [B]: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [R]: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [Q]: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  [K]: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};
const KING_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
const MATE = 100000;

function evaluate(st) {                                           // 지금 둘 차례인 쪽에서 본 점수
  let score = 0, material = 0;
  const b = st.b;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = b[r * 16 + c];
    if (!v) continue;
    const t = typeOf(v);
    if (t !== K && t !== P) material += VAL[t];
  }
  const endgame = material < 2600;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = b[r * 16 + c];
    if (!v) continue;
    const t = typeOf(v), white = !(v & BLACK);
    const idx = white ? r * 8 + c : (7 - r) * 8 + c;
    const pst = t === K && endgame ? KING_END[idx] : PST[t][idx];
    const s = VAL[t] + pst;
    score += white ? s : -s;
  }
  return st.side ? -score : score;
}

function orderMoves(st, moves, hashMove) {
  const b = st.b;
  const scored = moves.map((m) => {
    let s = 0;
    if (m === hashMove) s = 1e6;
    else if (mFlags(m) & F_CAP) { const victim = mFlags(m) & F_EP ? P : typeOf(b[mTo(m)]); s = 10000 + VAL[victim] * 10 - VAL[typeOf(b[mFrom(m)])]; }
    if (mPromo(m)) s += 9000 + VAL[mPromo(m)];
    return [m, s];
  });
  scored.sort((x, y) => y[1] - x[1]);
  return scored.map((x) => x[0]);
}

function quiesce(st, alpha, beta, ctx) {
  if ((++ctx.nodes & 1023) === 0 && ctx.deadline && Date.now() > ctx.deadline) ctx.stop = true;
  if (ctx.stop) return 0;
  const stand = evaluate(st);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  for (const m of orderMoves(st, pseudo(st, true))) {
    make(st, m);
    if (attacked(st, st.k[st.side ^ 1], st.side)) { unmake(st, m); continue; }
    const score = -quiesce(st, -beta, -alpha, ctx);
    unmake(st, m);
    if (ctx.stop) return 0;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}
function search(st, depth, alpha, beta, ply, ctx) {
  if ((++ctx.nodes & 1023) === 0 && ctx.deadline && Date.now() > ctx.deadline) ctx.stop = true;
  if (ctx.stop) return 0;
  const check = inCheck(st);
  if (check) depth++;                                             // 체크는 한 수 더 본다
  if (depth <= 0) return quiesce(st, alpha, beta, ctx);
  if (ply > 0 && (st.half >= 100 || insufficient(st))) return 0;
  let best = -MATE, any = false;
  for (const m of orderMoves(st, pseudo(st, false), ply === 0 ? ctx.pv : 0)) {
    make(st, m);
    if (attacked(st, st.k[st.side ^ 1], st.side)) { unmake(st, m); continue; }
    any = true;
    const score = -search(st, depth - 1, -beta, -alpha, ply + 1, ctx);
    unmake(st, m);
    if (ctx.stop) return 0;
    if (score > best) { best = score; if (ply === 0) ctx.best = m; }
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (!any) return check ? -MATE + ply : 0;                      // 체크메이트는 빨리 당할수록 나쁘고, 스테일메이트는 0
  return best;
}
// level 'easy': 2수 앞까지 보되 30% 는 아무 수나 둔다 / 'hard': 시간(기본 700ms) 안에서 깊이를 늘려 가며 본다 (최대 HARD_DEPTH=4수, 사람이 이길 만하게 예전 8수에서 낮춤)
// opts.depth 가 있으면 시간 대신 그 깊이로 고정 (시험용)
const HARD_DEPTH = 4;
function aiPick(st, level, rand = Math.random, opts = {}) {
  const moves = legal(st);
  if (!moves.length) return null;
  if (moves.length === 1) return ext(moves[0]);
  if (level === 'easy' && rand() < 0.3) return ext(moves[Math.floor(rand() * moves.length)]);
  const work = clone(st);
  const maxDepth = opts.depth || (level === 'hard' ? HARD_DEPTH : 2);
  const budget = opts.depth ? 0 : level === 'hard' ? (opts.ms || 700) : 0;
  const ctx = { nodes: 0, stop: false, deadline: 0, best: moves[0], pv: 0 };
  const startAt = Date.now();
  let bestMove = moves[0];
  for (let d = 1; d <= maxDepth; d++) {
    ctx.deadline = budget ? startAt + budget : 0;
    ctx.best = 0;
    const score = search(work, d, -MATE * 2, MATE * 2, 0, ctx);
    if (ctx.stop) break;
    if (ctx.best) { bestMove = ctx.best; ctx.pv = ctx.best; }
    if (Math.abs(score) > MATE - 100) break;                      // 메이트를 찾았다
    if (budget && Date.now() - startAt > budget * 0.5) break;     // 다음 깊이는 시간이 모자랄 가능성이 크다
  }
  if (level === 'easy' && opts.noise !== 0) {                     // 쉬움은 가끔 근소하게 나쁜 수를 둔다
    const alt = moves.filter((m) => !(mFlags(m) & F_CAP) && m !== bestMove);
    if (alt.length && rand() < 0.15) return ext(alt[Math.floor(rand() * alt.length)]);
  }
  return ext(bestMove);
}

return { P, N, B, R, Q, K, BLACK, START, typeOf, colorOf, rng, fromFen, toFen, newGame, clone, legalMoves, move, status, resultOf, inCheck: (st) => inCheck(st), perft: (st, d) => perft(st, d), aiPick, evaluate, insufficient, to88, from88 };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_CHESS;
