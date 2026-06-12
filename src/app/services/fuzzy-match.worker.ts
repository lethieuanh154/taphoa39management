/// <reference lib="webworker" />

// ============================================================
// Fuzzy Match Web Worker – self-contained, no Angular DI
// ============================================================

function removeAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}

const SORTED_WORDS: string[] = [
  'nuoc','sua','bia','ruou','tra','cafe','bot','dau','gao','mi',
  'thung','chai','lon','loc','goi','hop','kg','gram','lit',
  'true','juice','milk','water','green','tea','coffee','beer',
  'fresh','pure','zero','plus','light','gold','max','pro',
  'th','stc','tk','vinamilk','pepsi','coca','cola','fanta',
  'sprite','mirinda','sting','redbull','aquafina','lavie',
  'sagami','dasani','revive','oresol','pocari','nutriboost',
  'milo','ovaltine','ensure','abbott','dutch','lady',
  'omo','tide','comfort','downy','sunlight','vim',
  'glucerna','pediasure','similac','grow','gain',
].sort((a, b) => b.length - a.length);

function splitToken(token: string): string {
  let r = token;
  const parts: string[] = [];
  while (r.length > 0) {
    const w = SORTED_WORDS.find(x => r.startsWith(x));
    if (w) { parts.push(w); r = r.slice(w.length); }
    else   { parts.push(r[0]); r = r.slice(1); }
  }
  return parts.filter(p => SORTED_WORDS.includes(p)).length >= 2 ? parts.join(' ') : token;
}

// Expand common Vietnamese product abbreviations (applied after base normalization)
function expandAbbreviations(text: string): string {
  return text
    .replace(/(^|\s)ng(\s|$)/g, '$1nuoc giat$2')   // NG → Nước Giặt
    .replace(/(^|\s)nr(\s|$)/g, '$1nuoc rua$2')     // NR → Nước Rửa
    .replace(/(^|\s)nc(\s|$)/g, '$1nuoc cam$2')     // NC → Nước Cam
    .replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  if (!text) return '';
  let r = removeAccents(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  r = r.split(' ').map(t => t.length <= 8 ? t : splitToken(t)).join(' ').replace(/\s+/g, ' ').trim();
  return expandAbbreviations(r);
}

// --- Trigram helpers ---
function getTrigrams(str: string): string[] {
  const s = str.replace(/\s+/g, '');
  const result: string[] = [];
  for (let i = 0; i + 2 < s.length; i++) result.push(s.substring(i, i + 3));
  return result;
}

function buildIndex(names: string[]): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  names.forEach((n, i) => {
    for (const tg of getTrigrams(n)) {
      const arr = idx.get(tg);
      if (arr) arr.push(i); else idx.set(tg, [i]);
    }
  });
  return idx;
}

function getCandidates(query: string, idx: Map<string, number[]>, subset: Set<number> | null): Set<number> {
  const counts = new Map<number, number>();
  for (const tg of getTrigrams(query.replace(/\s+/g, ''))) {
    const arr = idx.get(tg);
    if (arr) arr.forEach(i => counts.set(i, (counts.get(i) ?? 0) + 1));
  }
  const result = new Set<number>();
  counts.forEach((_, i) => { if (!subset || subset.has(i)) result.add(i); });
  return result;
}

// --- Scoring ---
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, k) => k);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

function diceCoefficient(a: string, b: string): number {
  const ba: string[] = [], bb: string[] = [];
  for (let i = 0; i < a.length - 1; i++) ba.push(a.substring(i, i + 2));
  for (let i = 0; i < b.length - 1; i++) bb.push(b.substring(i, i + 2));
  if (!ba.length && !bb.length) return 0;
  const setB = new Set(bb);
  return (2 * ba.filter(x => setB.has(x)).length) / (ba.length + bb.length) || 0;
}

function bestTokenMatch(token: string, cands: string[]): number {
  let best = 0;
  for (const c of cands) {
    if (token === c || c.includes(token) || token.includes(c)) return 1;
    if (token.length >= 3 && c.length >= 3) {
      const d = levenshtein(token, c), ml = Math.max(token.length, c.length);
      if (d <= 2 && d / ml <= 0.4) best = Math.max(best, 1 - d / ml);
    }
  }
  return best;
}

function scoreNorm(ni: string, np: string): number {
  if (!ni || !np) return 0;
  if (ni === np) return 1.0;
  if (np.includes(ni)) return 0.95;
  if (ni.includes(np)) return 0.9;

  // Token-level containment: all product tokens exist in invoice tokens
  const itAll = ni.split(/\s+/).filter(t => t.length > 1);
  const ptAll = np.split(/\s+/).filter(t => t.length > 1);
  if (ptAll.length >= 2 && itAll.length > ptAll.length) {
    const iSet = new Set(itAll);
    if (ptAll.every(t => iSet.has(t))) return 0.88;
  }

  const it = ni.split(/\s+/).filter(t => t.length > 1);
  const pt = np.split(/\s+/).filter(t => t.length > 1);
  if (!it.length || !pt.length) return 0;

  const ic = it.reduce((s, t) => s + bestTokenMatch(t, pt), 0) / it.length;
  const pc = pt.reduce((s, t) => s + bestTokenMatch(t, it), 0) / pt.length;
  const tokenScore = ic * 0.7 + pc * 0.3;
  const ds = diceCoefficient(ni, np);
  const ci = ni.replace(/\s/g, ''), cp = np.replace(/\s/g, '');
  const ml = Math.max(ci.length, cp.length);
  const ls = ml > 0 ? 1 - levenshtein(ci, cp) / ml : 0;
  return Math.max(tokenScore * 0.5 + ds * 0.2 + ls * 0.3, ds, ls * 0.9);
}

// --- Worker state ---
let normNames: string[] = [];
let normFullNames: string[] = [];
let nameIndex: Map<string, number[]> = new Map();
let fullNameIndex: Map<string, number[]> = new Map();
let totalProducts = 0;

// --- Message handler ---
addEventListener('message', ({ data }: MessageEvent) => {
  const type: string = data.type;

  if (type === 'INIT') {
    const products: Array<{ Name: string; FullName: string }> = data.products;
    totalProducts = products.length;
    normNames     = products.map(p => p.Name     ? normalize(p.Name)     : '');
    normFullNames = products.map(p => p.FullName  ? normalize(p.FullName) : '');
    nameIndex     = buildIndex(normNames);
    fullNameIndex = buildIndex(normFullNames);
    postMessage({ type: 'INIT_DONE', count: totalProducts });
    return;
  }

  if (type === 'MATCH') {
    const { requestId, items, subset, topN = 5, minScore = 0.3 } = data as {
      requestId: string;
      items: Array<{ index: number; name: string }>;
      subset: number[] | null;
      topN: number;
      minScore: number;
    };

    const subsetSet: Set<number> | null = subset ? new Set(subset) : null;

    const results = items.map(item => {
      const nq = normalize(item.name);
      if (!nq) return { itemIndex: item.index, matches: [] };

      // Trigram pre-filter from both Name and FullName indices
      const candsFromName = getCandidates(nq, nameIndex, subsetSet);
      const candsFromFull = getCandidates(nq, fullNameIndex, subsetSet);
      let cands: Set<number> = new Set([...candsFromName, ...candsFromFull]);

      // Fallback: if too few candidates (short names / no trigrams), scan the whole subset
      if (cands.size < 5) {
        cands = subsetSet ? subsetSet : new Set(Array.from({ length: totalProducts }, (_, i) => i));
      }

      // DEBUG: log candidate pool for items containing "neptune"
      if (nq.includes('neptune')) {
        const neptuneProdIndices: number[] = [];
        for (let pi = 0; pi < normNames.length; pi++) {
          if (normNames[pi].includes('neptune') || normFullNames[pi].includes('neptune')) {
            neptuneProdIndices.push(pi);
          }
        }
        const inSubset = neptuneProdIndices.filter(pi => !subsetSet || subsetSet.has(pi));
        const inCands  = neptuneProdIndices.filter(pi => cands.has(pi));
        console.log(`[WORKER DEBUG] query="${nq}" | neptune products: total=${neptuneProdIndices.length} inSubset=${inSubset.length} inCands=${inCands.length}`);
        neptuneProdIndices.forEach(pi => {
          const inS = !subsetSet || subsetSet.has(pi);
          const inC = cands.has(pi);
          const sc = Math.max(
            normNames[pi] ? scoreNorm(nq, normNames[pi]) : 0,
            normFullNames[pi] ? scoreNorm(nq, normFullNames[pi]) : 0,
          );
          console.log(`  [${pi}] inSubset=${inS} inCands=${inC} score=${sc.toFixed(3)} name="${normNames[pi]}" fullName="${normFullNames[pi]}"`);
        });
      }

      const scored: Array<{ productIndex: number; score: number }> = [];
      for (const idx of cands) {
        const s = Math.max(
          normNames[idx]     ? scoreNorm(nq, normNames[idx])     : 0,
          normFullNames[idx] ? scoreNorm(nq, normFullNames[idx]) : 0,
        );
        if (s > minScore) scored.push({ productIndex: idx, score: s });
      }

      scored.sort((a, b) => b.score - a.score);
      return { itemIndex: item.index, matches: scored.slice(0, topN) };
    });

    postMessage({ type: 'MATCH_DONE', requestId, results });
  }
});