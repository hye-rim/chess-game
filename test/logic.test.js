'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const sq = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);   // 'e2' -> 칸 번호
const play = (st, ...moves) => { for (const mv of moves) { const [a, b, p] = [mv.slice(0, 2), mv.slice(2, 4), mv[4]]; const r = L.move(st, sq(a), sq(b), p ? { n: 2, b: 3, r: 4, q: 5 }[p] : undefined); assert.ok(r, `${mv} should be legal`); } };

// 규칙 검증의 가장 강한 근거: 알려진 시작 판들에서 가능한 수의 개수(perft)가 정확히 같아야 한다
const PERFT = [
  ['start', L.START, [20, 400, 8902, 197281]],
  ['kiwipete (castling, pins, ep, promotion)', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['rook endgame with en passant pins', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['promotions and checks', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['promotion with check', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['symmetric middlegame', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
];
for (const [name, fen, counts] of PERFT) {
  test(`perft matches the known counts: ${name}`, () => {
    const st = L.fromFen(fen);
    counts.forEach((c, i) => assert.strictEqual(L.perft(st, i + 1), c, `depth ${i + 1}`));
    assert.strictEqual(L.toFen(st), fen, 'the board is back to where it started');
  });
}

test('fen round trip keeps the position', () => {
  for (const fen of [L.START, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3']) assert.strictEqual(L.toFen(L.fromFen(fen)), fen);
});

test('twenty opening moves and the first move changes the turn', () => {
  const st = L.newGame();
  assert.strictEqual(L.legalMoves(st).length, 20);
  play(st, 'e2e4');
  assert.strictEqual(st.side, 1);
  assert.strictEqual(L.toFen(st).split(' ')[3], 'e3', 'a double push allows en passant');
});

test('illegal moves are refused', () => {
  const st = L.newGame();
  for (const [f, t] of [[sq('e2'), sq('e5')], [sq('e7'), sq('e5')], [sq('a1'), sq('a3')], [sq('e1'), sq('e2')], [-1, 5], [5, 64], [1.5, 2], [NaN, 3], [null, 4]]) assert.strictEqual(L.move(st, f, t), null);
});

test('fools mate is checkmate with black the winner', () => {
  const st = L.newGame();
  play(st, 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  const s = L.status(st);
  assert.deepStrictEqual([s.over, s.winner, s.reason], [true, 1, 'checkmate']);
});

test('scholars mate is checkmate with white the winner', () => {
  const st = L.newGame();
  play(st, 'e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7');
  const s = L.status(st);
  assert.deepStrictEqual([s.over, s.winner, s.reason], [true, 0, 'checkmate']);
});

test('a check must be answered and a pinned piece cannot move off the line', () => {
  const st = L.fromFen('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');          // 비숍이 e 파일에서 핀
  const moves = L.legalMoves(st).filter((m) => m.from === sq('e2'));
  assert.strictEqual(moves.length, 0);
  const chk = L.fromFen('4k3/8/8/8/8/8/3pp3/4K3 w - - 0 1');
  assert.strictEqual(L.status(chk).check, true, 'pawns on d2 and e2 give check');
  assert.deepStrictEqual(L.legalMoves(chk).map((m) => m.to).sort((a, b) => a - b), [sq('d2'), sq('e2'), sq('f2')], 'only d2, e2 (captures) and f2 are safe; d1 and f1 are covered');
});

test('stalemate is a draw', () => {
  const st = L.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  const s = L.status(st);
  assert.deepStrictEqual([s.over, s.winner, s.reason], [true, 2, 'stalemate']);
});

test('castling both ways works and moves the rook', () => {
  const st = L.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  play(st, 'e1g1');
  assert.strictEqual(st.b[L.to88(sq('f1'))], L.R);
  assert.strictEqual(st.b[L.to88(sq('g1'))], L.K);
  play(st, 'e8c8');
  assert.strictEqual(st.b[L.to88(sq('d8'))], L.R | L.BLACK);
  assert.strictEqual(st.b[L.to88(sq('c8'))], L.K | L.BLACK);
});

test('castling is refused through check, out of check and after the king moved', () => {
  const through = L.fromFen('4k3/8/8/8/8/5r2/8/R3K2R w KQ - 0 1');      // f1 이 공격받는다
  assert.strictEqual(L.move(through, sq('e1'), sq('g1')), null);
  const inChk = L.fromFen('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1');
  assert.strictEqual(L.move(inChk, sq('e1'), sq('g1')), null);
  assert.strictEqual(L.move(inChk, sq('e1'), sq('c1')), null);
  const moved = L.fromFen('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  play(moved, 'e1e2', 'e8e7', 'e2e1', 'e7e8');
  assert.strictEqual(L.move(moved, sq('e1'), sq('g1')), null, 'the right is gone for good');
});

test('castling queenside is allowed when only b1 is attacked', () => {
  const st = L.fromFen('4k3/8/8/8/8/8/1r6/R3K3 w Q - 0 1');
  assert.ok(L.move(st, sq('e1'), sq('c1')));
});

test('en passant captures the pawn that just moved two squares', () => {
  const st = L.newGame();
  play(st, 'e2e4', 'a7a6', 'e4e5', 'd7d5');
  const r = L.move(st, sq('e5'), sq('d6'));
  assert.ok(r && r.ep && r.cap);
  assert.strictEqual(st.b[L.to88(sq('d5'))], 0, 'the captured pawn is gone');
});

test('en passant is only possible right after the double push', () => {
  const st = L.newGame();
  play(st, 'e2e4', 'a7a6', 'e4e5', 'd7d5', 'h2h3', 'h7h6');
  assert.strictEqual(L.move(st, sq('e5'), sq('d6')), null);
});

test('en passant that would expose the king is illegal', () => {
  const st = L.fromFen('8/8/8/KPp4r/8/8/8/7k w - c6 0 1');
  assert.strictEqual(L.move(st, sq('b5'), sq('c6')), null);
});

test('promotion defaults to a queen and can choose a knight', () => {
  const a = L.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const ra = L.move(a, sq('a7'), sq('a8'));
  assert.strictEqual(ra.promo, L.Q);
  assert.strictEqual(a.b[L.to88(sq('a8'))], L.Q);
  const b = L.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  L.move(b, sq('a7'), sq('a8'), L.N);
  assert.strictEqual(b.b[L.to88(sq('a8'))], L.N);
  assert.strictEqual(L.legalMoves(L.fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1')).filter((m) => m.from === sq('a7')).length, 4);
});

test('capturing a rook takes away its castling right', () => {
  const st = L.fromFen('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1');
  play(st, 'g2h1');
  assert.strictEqual(L.toFen(st).split(' ')[2], 'Qkq');
});

test('draws: fifty move rule, repetition and bare kings', () => {
  const fifty = L.fromFen('4k3/8/8/8/8/8/R7/4K3 w - - 100 80');
  assert.strictEqual(L.status(fifty).reason, 'fifty');
  const rep = L.fromFen('4k3/8/8/8/8/8/R7/4K3 w - - 0 1');
  play(rep, 'a2a3', 'e8d8', 'a3a2', 'd8e8', 'a2a3', 'e8d8', 'a3a2', 'd8e8');
  assert.strictEqual(L.status(rep).reason, 'repetition');
  assert.strictEqual(L.status(L.fromFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1')).reason, 'material');
  assert.strictEqual(L.status(L.fromFen('4k3/8/8/8/8/8/8/3BK3 w - - 0 1')).reason, 'material');
  assert.strictEqual(L.status(L.fromFen('4k3/8/8/8/8/8/8/3QK3 w - - 0 1')).over, false);
});

test('bishops on the same color squares cannot mate but on opposite colors might', () => {
  assert.strictEqual(L.insufficient(L.fromFen('2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1')), true);
  assert.strictEqual(L.insufficient(L.fromFen('2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1')), false);
});

test('the computer always returns a legal move', () => {
  const r = L.rng(4), st = L.newGame();
  for (let i = 0; i < 40 && !L.status(st).over; i++) {
    const m = L.aiPick(st, i % 2 ? 'hard' : 'easy', r, { depth: 2 });
    assert.ok(L.move(st, m.from, m.to, m.promo), 'ai move is legal');
  }
});

test('the computer finds mate in one and takes a free queen', () => {
  const mate = L.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const m = L.aiPick(mate, 'hard', L.rng(1), { depth: 3 });
  assert.deepStrictEqual([m.from, m.to], [sq('a1'), sq('a8')]);
  const free = L.fromFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
  const t = L.aiPick(free, 'hard', L.rng(1), { depth: 3 });
  assert.deepStrictEqual([t.from, t.to], [sq('d1'), sq('d5')]);
});

test('the computer does not hang its queen to a pawn', () => {
  const st = L.fromFen('4k3/8/2p5/8/3Q4/8/8/4K3 w - - 0 1');
  const m = L.aiPick(st, 'hard', L.rng(1), { depth: 3 });
  const after = L.clone(st); L.move(after, m.from, m.to);
  const pawnCan = L.legalMoves(after).some((x) => x.to === m.to && after.b[L.to88(x.from)] === (L.P | L.BLACK));
  assert.strictEqual(pawnCan, false);
});

test('hard beats easy in a fixed series', () => {
  let hard = 0, easy = 0;
  for (let s = 1; s <= 4; s++) {
    const st = L.newGame(), r = L.rng(s);
    const hardSide = s % 2;
    for (let i = 0; i < 160 && !L.status(st).over; i++) {
      const m = L.aiPick(st, st.side === hardSide ? 'hard' : 'easy', r, st.side === hardSide ? { depth: 3 } : { depth: 2 });
      L.move(st, m.from, m.to, m.promo);
    }
    const res = L.status(st);
    if (res.winner === hardSide) hard++; else if (res.winner === 1 - hardSide) easy++;
  }
  assert.ok(hard >= easy, `hard ${hard} easy ${easy}`);
});
