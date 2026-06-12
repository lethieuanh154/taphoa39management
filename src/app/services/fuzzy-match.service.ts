import { Injectable } from '@angular/core';

export interface MatchResult {
  product: any;
  score: number;
}

interface WorkerMatchResult {
  itemIndex: number;
  matches: Array<{ productIndex: number; score: number }>;
}

@Injectable({ providedIn: 'root' })
export class FuzzyMatchService {

  // ============================================================
  // Web Worker – fast async matching
  // ============================================================

  private worker: Worker | null = null;
  private workerProductCount = -1;
  private initPromise: Promise<void> | null = null;
  private initResolve: (() => void) | null = null;
  private pendingMatchRequests = new Map<string, (results: WorkerMatchResult[]) => void>();
  private matchRequestCounter = 0;

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./fuzzy-match.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }: MessageEvent) => {
        if (data.type === 'INIT_DONE') {
          this.initResolve?.();
          this.initResolve = null;
        } else if (data.type === 'MATCH_DONE') {
          const cb = this.pendingMatchRequests.get(data.requestId as string);
          if (cb) { cb(data.results as WorkerMatchResult[]); this.pendingMatchRequests.delete(data.requestId as string); }
        }
      };
      this.worker.onerror = (err) => {
        console.error('[FuzzyWorker]', err);
        this.worker = null; this.initPromise = null; this.workerProductCount = -1;
        this.pendingMatchRequests.forEach(cb => cb([]));
        this.pendingMatchRequests.clear();
      };
    }
    return this.worker;
  }

  /** Initialize (or reuse) the worker with the given product list. */
  async initWorker(products: any[]): Promise<void> {
    if (this.workerProductCount === products.length && this.initPromise) {
      return this.initPromise;
    }
    this.workerProductCount = products.length;
    this.initPromise = new Promise<void>(resolve => { this.initResolve = resolve; });
    // Send only Name + FullName to minimise postMessage payload (~2 MB vs ~16 MB)
    const slim = products.map((p: any) => ({ Name: p.Name ?? '', FullName: p.FullName ?? '' }));
    this.getOrCreateWorker().postMessage({ type: 'INIT', products: slim });
    return this.initPromise;
  }

  /**
   * Match all items against a product list using the Web Worker + trigram pre-filter.
   * @param items     Invoice items to match: [{index, name}]
   * @param products  Full product array (kept on main thread; only Name/FullName sent to worker)
   * @param subset    Optional array of product indices to restrict matching to (null = all)
   * @param topN      Max matches per item (default 5)
   */
  async matchAllAsync(
    items: Array<{ index: number; name: string }>,
    products: any[],
    subset: number[] | null = null,
    topN = 5,
  ): Promise<Map<number, MatchResult[]>> {
    await this.initWorker(products);
    const requestId = String(this.matchRequestCounter++);

    return new Promise(resolve => {
      this.pendingMatchRequests.set(requestId, (results: WorkerMatchResult[]) => {
        const map = new Map<number, MatchResult[]>();
        for (const r of results) {
          if (r.matches.length > 0) {
            map.set(r.itemIndex, r.matches.map((m: { productIndex: number; score: number }) => ({ product: products[m.productIndex], score: m.score })));
          }
        }
        resolve(map);
      });
      this.getOrCreateWorker().postMessage({ type: 'MATCH', requestId, items, subset, topN });
    });
  }

  /**
   * Remove Vietnamese diacritics/accents
   * ă→a, â→a, ơ→o, ô→o, ư→u, ê→e, đ→d, etc.
   */
  removeAccents(text: string): string {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  /**
   * Normalize text for comparison: lowercase, remove accents, trim, remove special chars.
   * Also splits concatenated camelCase/UPPERCASE tokens (e.g., "THTRUEJUICEMILK" → "th true juice milk").
   */
  normalize(text: string): string {
    if (!text) return '';
    let result = this.removeAccents(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Split long tokens (>8 chars) that may be concatenated words
    result = result.split(' ').map(token => {
      if (token.length <= 8) return token;
      return this.splitConcatenatedToken(token);
    }).join(' ');

    result = result.replace(/\s+/g, ' ').trim();

    // Expand common Vietnamese product abbreviations
    return result
      .replace(/(^|\s)ng(\s|$)/g, '$1nuoc giat$2')   // NG → Nước Giặt
      .replace(/(^|\s)nr(\s|$)/g, '$1nuoc rua$2')     // NR → Nước Rửa
      .replace(/(^|\s)nc(\s|$)/g, '$1nuoc cam$2')     // NC → Nước Cam
      .replace(/\s+/g, ' ').trim();
  }

  /**
   * Try to split a concatenated token into words using a greedy approach.
   * e.g., "thtruejuicemilk" → "th true juice milk"
   */
  private splitConcatenatedToken(token: string): string {
    // Common words found in Vietnamese product names (normalized, no accents)
    const commonWords = [
      'nuoc', 'sua', 'bia', 'ruou', 'tra', 'cafe', 'bot', 'dau', 'gao', 'mi',
      'thung', 'chai', 'lon', 'loc', 'goi', 'hop', 'kg', 'gram', 'lit',
      'true', 'juice', 'milk', 'water', 'green', 'tea', 'coffee', 'beer',
      'fresh', 'pure', 'zero', 'plus', 'light', 'gold', 'max', 'pro',
      'th', 'stc', 'tk', 'vinamilk', 'pepsi', 'coca', 'cola', 'fanta',
      'sprite', 'mirinda', 'sting', 'redbull', 'aquafina', 'lavie',
      'sagami', 'dasani', 'revive', 'oresol', 'pocari', 'nutriboost',
      'milo', 'ovaltine', 'ensure', 'abbott', 'dutch', 'lady',
      'omo', 'tide', 'comfort', 'downy', 'sunlight', 'vim',
      'glucerna', 'pediasure', 'similac', 'grow', 'gain',
    ];

    // Greedy match: try longest word first
    const sortedWords = [...commonWords].sort((a, b) => b.length - a.length);
    let remaining = token;
    const parts: string[] = [];

    while (remaining.length > 0) {
      let found = false;
      for (const word of sortedWords) {
        if (remaining.startsWith(word)) {
          parts.push(word);
          remaining = remaining.slice(word.length);
          found = true;
          break;
        }
      }
      if (!found) {
        // Take single character and continue
        parts.push(remaining[0]);
        remaining = remaining.slice(1);
      }
    }

    // Only use split result if we found at least 2 known words
    const knownWordCount = parts.filter(p => commonWords.includes(p)).length;
    if (knownWordCount >= 2) {
      return parts.join(' ');
    }
    return token; // Keep original if splitting didn't help
  }

  /**
   * Calculate similarity score between two strings (0-1)
   * Uses multiple strategies to handle OCR misspellings (e.g. Gluxena → Glucerna)
   */
  score(invoiceName: string, productName: string): number {
    const normInvoice = this.normalize(invoiceName);
    const normProduct = this.normalize(productName);

    if (!normInvoice || !normProduct) return 0;

    // 1. Exact match after normalization
    if (normInvoice === normProduct) return 1.0;

    // 2. One contains the other (substring)
    if (normProduct.includes(normInvoice)) return 0.95;
    if (normInvoice.includes(normProduct)) return 0.9;

    // 2b. Token-level containment: all product tokens exist in invoice tokens
    // Handles: "Dầu ăn thượng hạng Neptune Light 5L" vs "Dầu ăn Neptune Light 5L"
    const invoiceTokensAll = normInvoice.split(/\s+/).filter(t => t.length > 1);
    const productTokensAll = normProduct.split(/\s+/).filter(t => t.length > 1);
    if (productTokensAll.length >= 2 && invoiceTokensAll.length > productTokensAll.length) {
      const invoiceSet = new Set(invoiceTokensAll);
      if (productTokensAll.every(t => invoiceSet.has(t))) return 0.88;
    }

    // 3. Token overlap scoring with fuzzy token matching (handles OCR typos)
    const invoiceTokens = normInvoice.split(/\s+/).filter(t => t.length > 1);
    const productTokens = normProduct.split(/\s+/).filter(t => t.length > 1);

    if (invoiceTokens.length === 0 || productTokens.length === 0) return 0;

    // Score how well invoice tokens match product tokens
    let invoiceMatchCount = 0;
    for (const it of invoiceTokens) {
      invoiceMatchCount += this.bestFuzzyTokenMatch(it, productTokens);
    }
    const invoiceCoverage = invoiceMatchCount / invoiceTokens.length;

    // Score how well product tokens match invoice tokens (reverse direction)
    let productMatchCount = 0;
    for (const pt of productTokens) {
      productMatchCount += this.bestFuzzyTokenMatch(pt, invoiceTokens);
    }
    const productCoverage = productMatchCount / productTokens.length;

    // Token score: weighted average favoring invoice coverage (invoice is the query)
    const tokenScore = invoiceCoverage * 0.7 + productCoverage * 0.3;

    // 4. Dice coefficient on bigrams
    const diceScore = this.diceCoefficient(normInvoice, normProduct);

    // 5. Levenshtein-based similarity (full string, ignoring spaces)
    const compactInvoice = normInvoice.replace(/\s/g, '');
    const compactProduct = normProduct.replace(/\s/g, '');
    const levDist = this.levenshtein(compactInvoice, compactProduct);
    const maxLen = Math.max(compactInvoice.length, compactProduct.length);
    const levScore = maxLen > 0 ? 1 - (levDist / maxLen) : 0;

    // Weighted combination - best of multiple strategies
    return Math.max(
      tokenScore * 0.5 + diceScore * 0.2 + levScore * 0.3,
      diceScore,
      levScore * 0.9
    );
  }

  /**
   * Find best fuzzy match score for a token against a list of candidate tokens.
   * Returns 0-1 match quality.
   */
  private bestFuzzyTokenMatch(token: string, candidates: string[]): number {
    let best = 0;
    for (const c of candidates) {
      // Exact or substring match
      if (token === c || c.includes(token) || token.includes(c)) {
        return 1;
      }
      // Fuzzy match: allow edit distance for tokens ≥ 3 chars
      if (token.length >= 3 && c.length >= 3) {
        const editDist = this.levenshtein(token, c);
        const maxLen = Math.max(token.length, c.length);
        // Allow up to 2 edits, or 30% of length (whichever is more restrictive)
        if (editDist <= 2 && editDist / maxLen <= 0.4) {
          best = Math.max(best, 1 - (editDist / maxLen));
        }
      }
    }
    return best;
  }

  /**
   * Find best matching products for an invoice item name.
   * Scores against both Name and FullName, takes the higher score.
   */
  findMatches(invoiceName: string, products: any[], topN: number = 5): MatchResult[] {
    if (!invoiceName || !products?.length) return [];

    return products
      .map(p => {
        const nameScore = p.Name ? this.score(invoiceName, p.Name) : 0;
        const fullNameScore = p.FullName ? this.score(invoiceName, p.FullName) : 0;
        return {
          product: p,
          score: Math.max(nameScore, fullNameScore)
        };
      })
      .filter(m => m.score > 0.3)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
  }

  /**
   * Dice coefficient based on bigrams (character pairs)
   */
  private diceCoefficient(a: string, b: string): number {
    const bigramsA = this.getBigrams(a);
    const bigramsB = this.getBigrams(b);
    if (bigramsA.length === 0 && bigramsB.length === 0) return 0;

    const setB = new Set(bigramsB);
    const intersection = bigramsA.filter(bg => setB.has(bg)).length;
    return (2 * intersection) / (bigramsA.length + bigramsB.length) || 0;
  }

  private getBigrams(str: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.push(str.substring(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Levenshtein edit distance between two strings.
   * Counts minimum insertions, deletions, substitutions to transform a into b.
   */
  private levenshtein(a: string, b: string): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Use single-row optimization for memory efficiency
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    let curr = new Array(b.length + 1);

    for (let i = 1; i <= a.length; i++) {
      curr[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,      // deletion
          curr[j - 1] + 1,  // insertion
          prev[j - 1] + cost // substitution
        );
      }
      [prev, curr] = [curr, prev];
    }

    return prev[b.length];
  }
}
