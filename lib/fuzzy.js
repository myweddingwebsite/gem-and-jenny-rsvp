// ============================================================
//  FUZZY NAME MATCHING
//  Ignores case, accents, punctuation, extra spaces, titles
//  (Mr./Mrs./Dr.…), word order, middle names and small typos.
//  A single word (e.g. just a first name) never opens an invitation
//  by itself — it only returns "Did you mean…?" suggestions.
//  Tune: FUZZY_ACCEPT (higher = stricter), FUZZY_SUGGEST (lower = more suggestions)
// ============================================================
export const FUZZY_ACCEPT    = 0.84; // score needed to open an invitation directly
export const FUZZY_SUGGEST   = 0.62; // score needed to appear as a suggestion
export const FUZZY_MARGIN    = 0.08; // best match must beat the runner-up by this much
export const MAX_SUGGESTIONS = 4;
const NAME_TITLES = {
  mr: 1, mrs: 1, ms: 1, miss: 1, mx: 1, dr: 1, engr: 1, atty: 1, arch: 1,
  sir: 1, maam: 1, madam: 1, hon: 1, rev: 1, fr: 1, ptr: 1, pastor: 1, sis: 1, bro: 1,
};

// "Mrs. Ma. Luísa  De-la Cruz" → ["ma", "luisa", "de", "la", "cruz"]
export function nameTokens_(s) {
  let str = String(s || '').toLowerCase();
  try { str = str.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
  str = str.replace(/ñ/g, 'n').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!str) return [];
  return str.split(' ').filter((t) => t && !NAME_TITLES[t]);
}

export function levenshtein_(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = [], cur;
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function similarity_(a, b) {
  const L = Math.max(a.length, b.length);
  return L ? 1 - levenshtein_(a, b) / L : 1;
}

// Score one typed word against one word of a guest name
export function tokenScore_(q, t) {
  if (q === t) return 1;
  if (q.length === 1) return t.charAt(0) === q ? 0.8 : 0;        // initial: "J" → "Juan"
  if (t.length === 1) return q.charAt(0) === t ? 0.7 : 0;        // listed as initial
  if (q.length >= 3 && t.indexOf(q) === 0) return 0.9;           // prefix: "Chris" → "Christopher"
  if (t.length >= 3 && q.indexOf(t) === 0) return 0.85;          // nickname listed: "Ma" vs "Maria"
  return similarity_(q, t);                                      // typos: "Gonzales" → "Gonzalez"
}

// 0..1 — how well the typed name matches a guest-list name
export function nameScore_(qTokens, nTokens) {
  if (!qTokens.length || !nTokens.length) return 0;
  if (qTokens.join(' ') === nTokens.join(' ')) return 1;

  const qJoined = qTokens.join(''), nJoined = nTokens.join('');
  if (qJoined === nJoined) return 0.99;                          // "delacruz" vs "dela cruz"

  // Best one-to-one word pairing, any order
  const used = {};
  let sum = 0, minTok = 1;
  for (let i = 0; i < qTokens.length; i++) {
    let best = 0, bestJ = -1;
    for (let j = 0; j < nTokens.length; j++) {
      if (used[j]) continue;
      const s = tokenScore_(qTokens[i], nTokens[j]);
      if (s > best) { best = s; bestJ = j; }
    }
    if (bestJ >= 0 && best >= 0.5) used[bestJ] = true;
    sum += best;
    if (best < minTok) minTok = best;
  }
  const avg = sum / qTokens.length;
  const coverage = Object.keys(used).length / nTokens.length;
  let score = 0.85 * avg + 0.15 * coverage;
  if (minTok < 0.5) score *= 0.6;                                // a typed word matches nothing

  score = Math.max(score, similarity_(qJoined, nJoined));        // spacing / merged-word typos

  // A single word (e.g. just a first name) is never enough to open an invitation.
  if (qTokens.length < 2 && nTokens.length >= 2) score = Math.min(score, FUZZY_ACCEPT - 0.01);

  return score;
}

// rows: [{ ...anything, name }]  →  { match: row } | { suggestions: [names] }
export function fuzzyFind(typed, rows) {
  const qTokens = nameTokens_(typed);
  if (!qTokens.length || qTokens.join('').length < 2) return { suggestions: [] };

  const scored = [];
  for (const r of rows) {
    const nm = String(r.name || '').trim();
    if (!nm) continue;
    scored.push({ row: r, name: nm, score: nameScore_(qTokens, nameTokens_(nm)) });
  }
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0], second = scored[1];
  const confident = top && top.score >= FUZZY_ACCEPT &&
    (!second || top.score - second.score >= FUZZY_MARGIN || (top.score === 1 && second.score < 1));
  if (confident) return { match: top.row };

  const suggestions = [];
  for (const s of scored) {
    if (suggestions.length >= MAX_SUGGESTIONS || s.score < FUZZY_SUGGEST) break;
    if (!suggestions.includes(s.name)) suggestions.push(s.name);
  }
  return { suggestions };
}
