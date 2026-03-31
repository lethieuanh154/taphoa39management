import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class VietnameseService {

  constructor() { }
  normalizeAndTokenize(str: string): string[] {
    return str
      .replace(/[^a-zA-Z0-9À-ỹ\s]/g, '') // Xóa ký tự đặc biệt, giữ dấu và chữ hoa/thường
      .split(/\s+/)
      .filter(Boolean);
  }
  generateNGrams(tokens: string[], maxN = 3): Set<string> {
    const ngrams = new Set<string>();
    for (let n = 1; n <= maxN; n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        const gram = tokens.slice(i, i + n).join(' ');
        ngrams.add(gram);
      }
    }
    return ngrams;
  }
}
