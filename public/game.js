'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 체스: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_CHESS), 방·매칭은 server.js
(() => {
const L = LOGIC_CHESS;
const $ = (id) => document.getElementById(id);
const GLYPH = { 1: '♟', 2: '♞', 3: '♝', 4: '♜', 5: '♛', 6: '♚' };     // 글자 모양으로 그리도록 뒤에 U+FE0E 를 붙인다 (이모지 방지)
const PIECE_NAME = { 1: '폰', 2: '나이트', 3: '비숍', 4: '룩', 5: '퀸', 6: '킹' };
const VALUE = { 1: 1, 2: 3, 3: 3, 4: 5, 5: 9 };
const SIDE_NAME = ['흰색', '검정'];
const T = { cpu: 250, over: 900 };                          // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('chessWins')) || 0;
const ONLINE_KEY = 'chessOnline', SESSION_KEY = 'chessSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('chessName') || '';
const coord = (i) => `${String.fromCharCode(97 + (i & 7))}${8 - (i >> 3)}`;

// ---------- 소리 ----------
let audio = null;
let muted = store.get('chessMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  select: () => tone(620, 0.05, 'triangle', 0.06),
  move: () => tone(300, 0.07, 'triangle', 0.09),
  capture: () => seq([260, 190], 70, 'square', 0.06),
  check: () => seq([700, 900], 90, 'square', 0.05),
  castle: () => seq([300, 380], 80, 'triangle', 0.08),
  promote: () => seq([523, 784, 1047], 90, 'triangle', 0.1),
  bad: () => tone(150, 0.1, 'square', 0.05),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('chessMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                  // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';                // title · play · over
let st = null;                      // 컴퓨터 대전 판
let mySide = 0;                     // 컴퓨터 대전에서 내 편 (0 흰색 · 1 검정)
let prefSide = store.get('chessSide') === '1' ? 1 : 0;
let lastMove = null;                // 마지막 수 { who, from, to, cap, ... } (컴퓨터 모드, 온라인은 room.lastMove)
let room = null, view = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '', seenMove = 0;
let sel = -1, pendingPromo = null;
let cpuTimer = 0, overTimer = 0, thinking = false;
const online = () => mode === 'online';

// 화면에 그릴 모양
function model() {
  if (online()) {
    if (!room || !view) return null;
    return { st: view, turn: room.turn, you: room.you, state: room.state, winner: room.winner, reason: room.reason, last: room.lastMove,
      names: [0, 1].map((c) => (c === room.you ? '나' : ((room.players.find((p) => p.color === c) || {}).name || '상대'))) };
  }
  if (!st) return null;
  const res = L.status(st);
  return { st, turn: st.side, you: mySide, state: res.over ? 'over' : 'playing', winner: res.winner, reason: res.reason, last: lastMove, names: mySide === 0 ? ['나', '컴퓨터'] : ['컴퓨터', '나'] };
}
const myTurn = (m) => !!m && m.state === 'playing' && m.turn === m.you && !netDown && !thinking;
const canAct = (m) => myTurn(m) && !waitingNet && !pendingPromo;

// ---------- 그리기 ----------
const sqEls = [];
function buildBoard() {
  const b = $('board');
  b.innerHTML = '';
  sqEls.length = 0;
  for (let k = 0; k < 64; k++) {
    const el = document.createElement('div');
    el.className = 'sq';
    el.dataset.k = String(k);
    el.onclick = () => onSquare(k);
    b.appendChild(el); sqEls.push(el);
  }
}
const flipped = () => { const m = model(); return !!m && m.you === 1; };
const toIdx = (k) => (flipped() ? 63 - k : k);
const toView = (i) => (flipped() ? 63 - i : i);

function legalFrom(m, from) { return L.legalMoves(m.st).filter((x) => x.from === from); }
function pieceAt(m, i) { return m.st.b[L.to88(i)]; }
function render() {
  const m = model();
  if (!m) { renderHud(null); return; }
  const turnNow = m.state === 'playing' && m.turn === m.you && !thinking;
  const dests = new Map();
  if (sel >= 0 && canAct(m)) for (const mv of legalFrom(m, sel)) dests.set(mv.to, mv.cap);
  const last = m.last, oppMoved = !!last && last.who !== undefined && last.who !== m.you;
  const lastSet = new Set(last ? [last.from, last.to] : []);
  const inChk = L.inCheck(m.st) ? from88idx(m.st.k[m.st.side]) : -1;       // 체크(체크메이트 포함)인 킹 칸
  for (let k = 0; k < 64; k++) {
    const i = toIdx(k), el = sqEls[k], v = pieceAt(m, i);
    const dk = ((i >> 3) + (i & 7)) & 1;
    el.className = 'sq' + (dk ? ' dk' : '') + (lastSet.has(i) ? ' last' : '') + (i === sel ? ' sel' : '') + (dests.has(i) ? ' dest' + (dests.get(i) ? ' cap' : '') : '')
      + (oppMoved && i === last.from ? ' lastfrom' : '') + (oppMoved && last.cap && i === last.to ? ' lastcap' : '') + (i === inChk ? ' chk' : '');
    let html = '';
    if ((k & 7) === 0) html += `<span class="co r">${8 - (i >> 3)}</span>`;
    if (k >> 3 === 7) html += `<span class="co f">${String.fromCharCode(97 + (i & 7))}</span>`;
    if (v) {
      const t = L.typeOf(v), white = !(v & L.BLACK);
      const mine = (white ? 0 : 1) === m.you;
      html += `<span class="pc ${white ? 'w' : 'b'}${turnNow && mine ? ' can' : ''}${oppMoved && i === last.to ? ' opplast' : ''}">${GLYPH[t]}︎</span>`;
    }
    el.innerHTML = html;
  }
  renderBars(m);
  renderHud(m);
}
const from88idx = (s88) => (s88 >> 4) * 8 + (s88 & 7);
function renderBars(m) {
  // 잡힌 말: 처음 개수에서 지금 남은 개수를 빼서 구한다
  const start = { 1: 8, 2: 2, 3: 2, 4: 2, 5: 1 };
  const have = [{ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const v = m.st.b[r * 16 + c]; if (v && L.typeOf(v) !== 6) have[(v & L.BLACK) ? 1 : 0][L.typeOf(v)]++; }
  const lost = (side) => { const o = []; let val = 0; for (const t of [5, 4, 3, 2, 1]) { const n = Math.max(0, start[t] - have[side][t]); for (let i = 0; i < n; i++) o.push(GLYPH[t] + '︎'); val += n * VALUE[t]; } return { glyphs: o.join(''), val }; };
  const bar = (el, side) => {
    const mine = lost(side), theirs = lost(1 - side);                                 // 내가 잡은 말 = 상대 편이 잃은 말
    const taken = lost(1 - side), diff = taken.val - lost(side).val;
    el.className = 'bar' + (m.state === 'playing' && m.turn === side ? ' turn' : '');
    el.innerHTML = `<span class="dot" style="--c:${side ? '#2b1d52' : '#ffffff'}"></span><span class="nm">${esc(m.names[side])} (${SIDE_NAME[side]})</span><span class="cap">${taken.glyphs}${diff > 0 ? `<small>+${diff}</small>` : ''}</span>`;
  };
  bar($('barOp'), 1 - m.you); bar($('barMe'), m.you);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '체스';
  if (m && phase === 'play' && m.state === 'playing') {
    const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
    const chk = L.inCheck(m.st) ? ' · 체크!' : '';
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.turn === m.you) text = `내 차례${chk}${online() ? ` · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : ''}`;
    else text = online() ? `${m.names[m.turn]} 차례${chk} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `컴퓨터 생각 중…${chk}`;
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && room.state === 'playing' ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 내 수 고르기 ----------
function onSquare(k) {
  const m = model();
  if (!canAct(m)) return;
  const i = toIdx(k), v = pieceAt(m, i);
  const mine = v && ((v & L.BLACK) ? 1 : 0) === m.you;
  if (sel >= 0) {
    const cands = legalFrom(m, sel).filter((x) => x.to === i);
    if (cands.length) {
      if (cands.length > 1) { askPromotion(sel, i); return; }              // 프로모션: 같은 칸으로 가는 수가 4개
      const from = sel; sel = -1;
      doMove(from, i, 0);
      return;
    }
    if (i === sel) { sel = -1; render(); return; }                          // 같은 말을 다시 누르면 취소
  }
  if (mine) {
    if (!legalFrom(m, i).length) { sfx.bad(); say('그 말은 지금 움직일 수 없어요'); sel = -1; render(); return; }
    sel = i; sfx.select(); tutorialSignal('select'); render();
  } else if (sel >= 0) { sfx.bad(); sel = -1; render(); }
}
function askPromotion(from, to) {
  pendingPromo = { from, to };
  const white = model().you === 0;
  const row = $('promo').querySelector('.row2');
  row.innerHTML = [5, 4, 3, 2].map((t) => `<button data-p="${t}" aria-label="${PIECE_NAME[t]}" style="color:${white ? '#fff' : '#2b1d52'};text-shadow:${white ? '0 0 2px #2b1d52,0 0 2px #2b1d52,1px 1px 0 #2b1d52,-1px -1px 0 #2b1d52' : 'none'}">${GLYPH[t]}︎</button>`).join('');
  $('promo').classList.add('on');
}
$('promo').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !pendingPromo) return;
  const { from, to } = pendingPromo;
  pendingPromo = null; sel = -1;
  $('promo').classList.remove('on');
  doMove(from, to, Number(b.dataset.p));
});
function doMove(from, to, promo) {
  if (online()) { waitingNet = true; net.send('move', { from, to, promo: promo || undefined }); render(); return; }
  const who = st.side;
  const r = L.move(st, from, to, promo || undefined);
  if (!r) return;
  lastMove = { who, from: r.from, to: r.to, promo: r.promo, cap: r.cap, ep: r.ep, castle: r.castle, check: r.check };
  announce(who, lastMove);
  tutorialSignal('move'); if (r.cap) tutorialSignal('capture'); if (r.check) tutorialSignal('check');
  render();
  afterMove(r);
}
function announce(who, mv) {
  const m = model();
  const mine = who === m.you, subj = mine ? '내가' : (online() ? `${m.names[who]}${hasBatchim(m.names[who]) ? '이' : '가'}` : '컴퓨터가');
  let t = '';
  if (mv.castle) { sfx.castle(); t = `${subj} 캐슬링했어요`; }
  else if (mv.promo) { sfx.promote(); t = `${subj} 폰을 ${PIECE_NAME[mv.promo]}으로 승진시켰어요!`; }
  else if (mv.ep) { sfx.capture(); t = `${subj} 앙파상으로 폰을 잡았어요`; }
  else if (mv.cap) { sfx.capture(); t = `${subj} 말을 잡았어요`; }
  else sfx.move();
  if (mv.check) { setTimeout(sfx.check, 120); t += `${t ? ' · ' : ''}체크!`; }
  say(t);
}
const hasBatchim = (name) => { const c = String(name).charCodeAt(String(name).length - 1); return c >= 0xAC00 && c <= 0xD7A3 && (c - 0xAC00) % 28 !== 0; };

// ---------- 컴퓨터 대전 ----------
function startCpu(level) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = level; mySide = prefSide; st = L.newGame(); phase = 'play'; lastMove = null; sel = -1; pendingPromo = null; thinking = false; turnEnd = 0;
  $('promo').classList.remove('on');
  hideOverlay(); buildBoard(); render();
  say(mySide === 0 ? '흰색이 먼저예요! 내 말을 눌러서 고르고, 갈 칸을 눌러요' : '컴퓨터(흰색)가 먼저 둬요');
  if (mySide === 1) scheduleCpu();
}
function scheduleCpu() { thinking = true; render(); cpuTimer = setTimeout(cpuTurn, T.cpu); }
function afterMove(r) {
  if (r.over) { overTimer = setTimeout(showOver, T.over); return; }
  scheduleCpu();
}
function cpuTurn() {
  if (phase !== 'play' || !st || online() || st.side === mySide) { thinking = false; return; }
  const res = L.status(st);
  if (res.over) { thinking = false; return; }
  const mv = L.aiPick(st, mode === 'hard' ? 'hard' : 'easy');
  thinking = false;
  if (!mv) return;
  const who = st.side;
  const r = L.move(st, mv.from, mv.to, mv.promo || undefined);
  lastMove = { who, from: r.from, to: r.to, promo: r.promo, cap: r.cap, ep: r.ep, castle: r.castle, check: r.check };
  announce(who, lastMove);
  render();
  if (r.over) overTimer = setTimeout(showOver, T.over);
}
const whyText = (reason, won) => ({
  checkmate: won ? '체크메이트! 상대 킹을 잡았어요' : '체크메이트… 내 킹이 막혔어요',
  stalemate: '스테일메이트: 움직일 수 있는 수가 없는데 체크는 아니라서 비겼어요',
  fifty: '잡거나 폰을 움직이지 않고 50수가 지나 비겼어요',
  repetition: '같은 모양이 세 번 나와서 비겼어요',
  material: '체크메이트를 만들 수 없는 말만 남아 비겼어요',
}[reason] || '');
function showOver() {
  phase = 'over';
  const m = model();
  const youWon = m.winner === m.you, draw = m.winner === 2;
  if (youWon) { wins++; store.set('chessWins', String(wins)); sfx.win(); } else if (draw) sfx.found(); else sfx.lose();
  showOverlay(`
    <h2>${draw ? '무승부! 🤝' : youWon ? '이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>${esc(whyText(m.reason, youWon))}</p>
    <dl class="stats card2"><dt>둔 수</dt><dd>${Math.ceil((st.keys.length - 1) / 2)}수</dd><dt>내 색</dt><dd>${SIDE_NAME[mySide]}</dd></dl>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; mySide = 0; st = L.newGame(); lastMove = null; sel = -1; pendingPromo = null; thinking = false;
  $('promo').classList.remove('on');
  buildBoard(); say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>체스</h1>
    <p>상대 <b>킹</b>을 잡을 수 없게 몰아 <b>체크메이트</b>!</p>
    <div class="card2" style="font-size:13px">말마다 다르게 움직여요 (폰·나이트·비숍·룩·퀸·킹)<br>킹이 공격받으면 <b>체크</b> — 반드시 피해야 해요<br>캐슬링·앙파상·폰 <b>승진</b> 규칙도 모두 있어요<br>합법인 수만 <b>점으로 표시</b>돼요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button>
      <button class="sub" data-act="side">내 색: ${prefSide ? '⚫ 검정(컴퓨터 먼저)' : '⚪ 흰색(내가 먼저)'}</button>
      <button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; view = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  room = r;
  view = L.fromFen(r.fen);
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  sel = -1; pendingPromo = null; $('promo').classList.remove('on');
  if (newGame) { seenMove = r.lastMove ? r.lastMove.seq : 0; buildBoard(); say(''); }
  if (r.state === 'waiting') { phase = 'title'; showWaiting(); render(); return; }
  phase = r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'playing') { sfx.found(); say(r.turn === r.you ? '내가 먼저 둬요! (흰색) 내 말을 눌러요' : '상대(흰색)가 먼저 둬요'); }
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  if (r.lastMove && r.lastMove.seq > seenMove && !newGame) {
    seenMove = r.lastMove.seq;
    announce(r.lastMove.who, r.lastMove);
    if (r.lastMove.who === r.you) { tutorialSignal('move'); if (r.lastMove.cap) tutorialSignal('capture'); if (r.lastMove.check) tutorialSignal('check'); }
  }
  render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else if (r.winner === 2) { rec.d = (rec.d || 0) + 1; sfx.found(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room;
  const draw = r.winner === 2, won = r.winner === r.you;
  const why = {
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || whyText(r.reason, won);
  const rec = loadJson(ONLINE_KEY);
  const opp = r.players.find((p) => p.color !== r.you);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  showOverlay(`
    <h2>${draw ? '🤝 무승부' : won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${esc(why)}</p>` : ''}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패${rec.d ? ` ${rec.d}무` : ''}</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; view = null; st = null; waitingNet = false; sel = -1; pendingPromo = null; thinking = false;
  $('promo').classList.remove('on');
  view = L.newGame(); buildBoard(); say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">한 수에 2분 · 흰색(먼저)과 검정은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('chessName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

let lastCpu = 'easy';
$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') { lastCpu = btn.dataset.lv; startCpu(lastCpu); }
  else if (act === 'again') startCpu(lastCpu);
  else if (act === 'side') { prefSide = 1 - prefSide; store.set('chessSide', String(prefSide)); showTitle(); }
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '체스 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && room.state === 'playing') confirmResign(); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyM') toggleMute(); });
setInterval(() => { if (online() && room && room.state === 'playing' && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  view = L.newGame(); buildBoard();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__ch = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get sel() { return sel; }, get thinking() { return thinking; }, T, onSquare, startCpu, render, toView, toIdx };
/* @test-hooks:end */
})();
