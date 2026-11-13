// 강의 시험의 "계산" 부분 — 화면과 저장을 모르는 순수 함수만 모았다.
// 브라우저에서는 window.LectureExam, 테스트(node)에서는 require 로 쓴다.
(function (root) {
  const CIRCLE = ['①', '②', '③', '④'];

  // 배열을 섞은 새 배열 (rand 를 넘기면 테스트에서 결과를 고정할 수 있다)
  function shuffled(list, rand = Math.random) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 장별 할당량: 문항이 많은 장에서 더 많이 뽑되 합계가 정확히 count 가 되게(최대 나머지 방식).
  function chapterQuotas(pool, count) {
    const byCh = new Map();
    pool.forEach(q => byCh.set(q.ch, (byCh.get(q.ch) || 0) + 1));
    const total = pool.length;
    const rows = [...byCh].map(([ch, size]) => {
      const exact = (count * size) / total;
      return { ch, size, take: Math.min(size, Math.floor(exact)), rest: exact - Math.floor(exact) };
    });
    let left = count - rows.reduce((s, r) => s + r.take, 0);
    rows.sort((a, b) => b.rest - a.rest);
    for (const r of rows) { if (left <= 0) break; if (r.take < r.size) { r.take++; left--; } }
    return new Map(rows.map(r => [r.ch, r.take]));
  }

  // 문제 뽑기: 장별로 고르게 + 덜 본(seen 이 작은) 문제부터. 같은 횟수끼리는 무작위.
  // 결과는 장 순서대로 정렬해 교육자료 흐름과 맞춘다.
  function draw(pool, count, seen = {}, rand = Math.random) {
    count = Math.min(count, pool.length);
    const order = q => (seen[q.id] || 0);
    const ranked = shuffled(pool, rand).sort((a, b) => order(a) - order(b));
    const quotas = chapterQuotas(pool, count);
    const picked = [];
    const taken = new Map();
    for (const q of ranked) {
      const t = taken.get(q.ch) || 0;
      if (t < (quotas.get(q.ch) || 0)) { picked.push(q); taken.set(q.ch, t + 1); }
    }
    // 반올림 때문에 모자라면 남은 문제 중 덜 본 순서로 채운다.
    for (const q of ranked) { if (picked.length >= count) break; if (!picked.includes(q)) picked.push(q); }
    return picked.slice(0, count).sort((a, b) => a.ch - b.ch);
  }

  // 새 시험지: 객관식은 보기 순서(order)도 섞는다. order[i] = i번째로 보여 줄 원래 보기 번호.
  function newSheet(bank, seen = {}, rand = Math.random, sizes = { mcq: 20, subj: 8 }) {
    return {
      id: `sheet_${Date.now()}_${Math.floor(rand() * 1e6)}`,
      createdAt: Date.now(),
      mcq: draw(bank.mcq, sizes.mcq, seen, rand).map(q => ({ id: q.id, order: shuffled([0, 1, 2, 3], rand) })),
      subj: draw(bank.subj, sizes.subj, seen, rand).map(q => q.id),
      answers: {},   // 객관식: 문항 id → 고른 "원래" 보기 번호
      texts: {},     // 주관식: 문항 id → 내가 쓴 답
      checks: {},    // 주관식 채점: 문항 id → 체크한 채점 항목 번호 목록
      revealed: false
    };
  }

  // 해설 속 ①~④는 원래 보기 번호다. 섞인 화면 번호로 바꿔 준다.
  function remapCircles(text, order) {
    return String(text || '').replace(/[①②③④]/g, c => {
      const shown = order.indexOf(CIRCLE.indexOf(c));
      return shown >= 0 ? CIRCLE[shown] : c;
    });
  }

  const rubricMax = q => q.rubric.reduce((s, r) => s + Number(r.pts || 0), 0);

  // 점수: 객관식 2점 × 개수(40점) + 주관식은 받은 점수 ÷ 뽑힌 문항 만점 합 × 60
  function score(sheet, bankIndex) {
    const mcqItems = sheet.mcq.map(m => bankIndex[m.id]).filter(Boolean);
    const wrong = [];
    let correct = 0;
    sheet.mcq.forEach(m => {
      const q = bankIndex[m.id];
      if (!q) return;
      if (sheet.answers[m.id] === q.answer) correct++;
      else wrong.push({ id: q.id, ch: q.ch });
    });
    let subjGot = 0, subjMax = 0;
    sheet.subj.forEach(id => {
      const q = bankIndex[id];
      if (!q) return;
      subjMax += rubricMax(q);
      (sheet.checks[id] || []).forEach(i => { subjGot += Number(q.rubric[i]?.pts || 0); });
    });
    const mcqScore = mcqItems.length ? Math.round((correct / mcqItems.length) * 40) : 0;
    const subjScore = subjMax ? Math.round((subjGot / subjMax) * 60) : 0;
    return { correct, mcqCount: mcqItems.length, mcqScore, subjGot, subjMax, subjScore, total: mcqScore + subjScore, wrong };
  }

  // 강의 내용 HTML 을 화면에 넣기 전에 허용한 태그·속성만 남긴다.
  const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'CODE', 'BR', 'SUB', 'SUP', 'SPAN', 'SMALL', 'MARK', 'PRE', 'UL', 'OL', 'LI', 'P']);
  function sanitize(html, doc = root.document) {
    const tpl = doc.createElement('template');
    tpl.innerHTML = String(html || '');
    const walk = node => {
      [...node.childNodes].forEach(child => {
        if (child.nodeType === 1) {
          if (!ALLOWED.has(child.tagName)) { child.replaceWith(doc.createTextNode(child.textContent)); return; }
          [...child.attributes].forEach(a => { if (a.name !== 'class') child.removeAttribute(a.name); });
          walk(child);
        } else if (child.nodeType !== 3) child.remove();
      });
    };
    walk(tpl.content);
    return tpl.innerHTML;
  }

  const api = { CIRCLE, shuffled, chapterQuotas, draw, newSheet, remapCircles, rubricMax, score, sanitize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LectureExam = api;
})(typeof window !== 'undefined' ? window : globalThis);
