import { Injectable } from '@angular/core';

/**
 * Normalizes Vietnamese product unit names for comparison.
 * Handles: "Thùng" vs "thùng" vs "1 thùng" vs "chiếc" vs "cái"
 */
@Injectable({ providedIn: 'root' })
export class UnitNormalizationService {

  /**
   * Maps canonical unit key → array of known aliases (all lowercase)
   */
  private readonly UNIT_ALIASES: Record<string, string[]> = {
    'thung':  ['thùng', 'thung', '1 thùng', '1 thung'],
    'chai':   ['chai', '1 chai'],
    'loc':    ['lốc', 'loc', '1 lốc', '1 loc'],
    'lon':    ['lon', '1 lon'],
    'goi':    ['gói', 'goi', '1 gói', '1 goi'],
    'hop':    ['hộp', 'hop', '1 hộp', '1 hop'],
    'bich':   ['bịch', 'bich', '1 bịch', '1 bich'],
    'cai':    ['cái', 'cai', 'chiếc', 'chiec', '1 cái', '1 chiếc'],
    'kg':     ['kg', 'kilogram', 'kí', 'ký', 'ki', 'ky'],
    'g':      ['g', 'gram', 'gam'],
    'lit':    ['lít', 'lit', 'l'],
    'ml':     ['ml', 'mililít', 'mililit'],
    'can':    ['can', '1 can'],
    'cuon':   ['cuộn', 'cuon', '1 cuộn'],
    'bao':    ['bao', '1 bao'],
    'tui':    ['túi', 'tui', '1 túi'],
    'bo':     ['bộ', 'bo', '1 bộ'],
    'cay':    ['cây', 'cay', '1 cây'],
    'to':     ['tờ', 'to', '1 tờ'],
    'tam':    ['tấm', 'tam', '1 tấm'],
    'ong':    ['ống', 'ong', '1 ống'],
    'hu':     ['hũ', 'hu', 'hủ', '1 hũ'],
    'ly':     ['ly', '1 ly', 'cốc', 'coc'],
    'xap':    ['xấp', 'xap', '1 xấp'],
    'kien':   ['kiện', 'kien', '1 kiện'],
  };

  /** Reverse lookup: alias (lowercase) → canonical key */
  private aliasMap = new Map<string, string>();

  constructor() {
    for (const [canonical, aliases] of Object.entries(this.UNIT_ALIASES)) {
      for (const alias of aliases) {
        this.aliasMap.set(alias.toLowerCase().trim(), canonical);
      }
      // Also map canonical to itself
      this.aliasMap.set(canonical, canonical);
    }
  }

  /**
   * Normalize a unit string to its canonical form.
   * "Thùng" → "thung", "1 thùng" → "thung", "chiếc" → "cai"
   */
  normalize(unit: string): string {
    if (!unit) return '';
    // Strip leading numbers and whitespace: "1 thùng" → "thùng"
    const cleaned = unit.replace(/^\d+\s*/, '').toLowerCase().trim();
    return this.aliasMap.get(cleaned) || cleaned;
  }

  /**
   * Check if two unit strings are equivalent.
   */
  areEquivalent(unitA: string, unitB: string): boolean {
    return this.normalize(unitA) === this.normalize(unitB);
  }

  /**
   * Find which product unit in a group matches the invoice unit.
   * Returns the matching unit info or null.
   */
  findMatchingUnit(
    invoiceUnit: string,
    productUnits: { unit: string; conversionValue: number; product?: any }[]
  ): { unit: string; conversionValue: number; product?: any } | null {
    const normalizedInvoice = this.normalize(invoiceUnit);
    if (!normalizedInvoice) return null;

    return productUnits.find(pu => this.normalize(pu.unit) === normalizedInvoice) || null;
  }
}