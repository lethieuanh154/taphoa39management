import { Injectable, inject } from '@angular/core';
import { MatchResult } from '../../../services/fuzzy-match.service';
import { UnitNormalizationService } from '../../../services/unit-normalization.service';
import { ProductService } from '../../../services/product.service';

export interface InvoiceItemForUpdate {
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  amount: number;
  isPromotional?: boolean; // KM item: amount=0, unit_price=0
}

export interface ItemUpdateResult {
  itemIndex: number;
  status: 'success' | 'skipped' | 'warning' | 'error';
  reason?: string;
  productCode?: string;
  newCost?: number;
}

export interface UpdateResult {
  results: ItemUpdateResult[];
  totalUpdated: number;
  updatedSearchTerms: string[];
}

@Injectable({ providedIn: 'root' })
export class InvoicePriceUpdateService {
  private unitNorm = inject(UnitNormalizationService);
  private productService = inject(ProductService);

  private parseNumber(value: any): number {
    if (typeof value === 'string') {
      const normalized = value.replace(/[^0-9.-]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Update product prices from invoice data.
   *
   * For each invoice item with a matched product:
   * 1. Skip items with amount === 0 (promotional/free items)
   * 2. Find the product group from IndexedDB (all products with same Code)
   * 3. Match invoice unit to a product unit in the group
   * 4. Set Box/Retail/TotalPrice on master (mirroring product-row inputs)
   * 5. Calculate Cost/OnHand/BasePrice using product-row's recalculateCost logic
   * 6. Save master to localStorage (DON'T update children/clones)
   */
  async updatePricesFromInvoice(
    invoiceItems: InvoiceItemForUpdate[],
    confirmedMatches: Map<number, MatchResult>
  ): Promise<UpdateResult> {
    const results: ItemUpdateResult[] = [];
    const updatedSearchTerms: string[] = [];
    const processedMasters = new Set<string>();
    const promoMasters = new Set<string>(); // Track which masters were processed as promo

    // Load all products from IndexedDB once
    const allProducts = await this.productService.getAllProductsFromIndexedDB() || [];
    console.log(`[InvoicePriceUpdate] Loaded ${allProducts.length} products from IndexedDB`);

    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      const match = confirmedMatches.get(i);

      if (!match) {
        results.push({ itemIndex: i, status: 'skipped', reason: 'Không có sản phẩm match' });
        continue;
      }

      const isPromo = item.isPromotional || (item.amount === 0 && item.unit_price === 0);

      const product = match.product;
      const searchCode = String(product.Code || product.Id);

      // 1. Find product group from IndexedDB (all products with same Code)
      const group = this.findProductGroupFromList(searchCode, allProducts);
      // Check for duplicate master
      const masterCandidate = group ? this.findMaster(group) : null;
      const isPromoEarly = item.isPromotional || (item.amount === 0 && item.unit_price === 0);
      if (masterCandidate && processedMasters.has(masterCandidate.Code)) {
        if (isPromoEarly && promoMasters.has(masterCandidate.Code)) {
          // PROMO into PROMO: accumulate quantity (e.g., 3 identical KM rows → sum qty)
          const accResult = this.accumulatePromoQuantity(masterCandidate, item, group!, allProducts);
          results.push({
            itemIndex: i,
            status: 'success',
            productCode: masterCandidate.Code,
            reason: `KM - cộng dồn SL (${accResult})`
          });
          continue;
        }
        if (isPromoEarly && !promoMasters.has(masterCandidate.Code)) {
          // PROMO into REGULAR: skip! Don't mix promo qty into regular (corrupts cost)
          results.push({
            itemIndex: i,
            status: 'warning',
            reason: `KM "${masterCandidate.Code}" không có SP (KM) riêng - bỏ qua (không trộn vào hàng thường)`
          });
          continue;
        }
        // Regular item: skip duplicate
        results.push({
          itemIndex: i,
          status: 'warning',
          reason: `Sản phẩm "${masterCandidate.Code}" đã được cập nhật bởi item trước đó`
        });
        continue;
      }
      if (!group || group.length === 0) {
        results.push({ itemIndex: i, status: 'error', reason: `Không tìm thấy nhóm SP (Code=${searchCode}) trong IndexedDB` });
        continue;
      }

      // 2. Find master (base unit, non-clone)
      const master = this.findMaster(group);
      if (!master) {
        results.push({ itemIndex: i, status: 'error', reason: 'Không tìm thấy sản phẩm gốc (master)' });
        continue;
      }

      // LOG
      console.log(`[${i}] Group (${group.length}):`, group.map((p: any) => `${p.Code}|${p.Name}|isClone=${p.isClone}|CV=${p.ConversionValue}`));
      console.log(`[${i}] Master: Code=${master.Code} Name="${master.Name}" Id=${master.Id} isClone=${master.isClone}`);

      // 3. Build unit list from group
      const groupUnits = group.map(p => ({
        unit: (p as any).Unit || '',
        conversionValue: this.parseNumber((p as any).ConversionValue) || 1,
        product: p
      }));

      // 4. Match invoice unit to product unit
      const masterConversion = this.parseNumber(master.ConversionValue) || 1;
      let unitMatch = this.unitNorm.findMatchingUnit(item.unit, groupUnits);
      if (!unitMatch) {
        // FALLBACK 1: Try word-by-word matching (e.g., "Thùng 30 chai" → try "Thùng", "chai")
        if (item.unit) {
          const words = item.unit.split(/[\s,()]+/).filter(w => w.length > 0);
          for (const word of words) {
            unitMatch = this.unitNorm.findMatchingUnit(word, groupUnits);
            if (unitMatch) {
              console.warn(`[${i}] Unit "${item.unit}" → word match "${word}" → "${unitMatch.unit}" (CV=${unitMatch.conversionValue})`);
              break;
            }
          }
        }

        // FALLBACK 2: Infer from unit price vs existing Cost
        if (!unitMatch && item.unit_price > 0) {
          const masterCost = this.parseNumber(master.Cost) || 0;
          if (masterCost > 0) {
            let bestMatch: typeof groupUnits[0] | null = null;
            let bestRatio = Infinity;
            for (const gu of groupUnits) {
              const expectedCost = masterCost * (gu.conversionValue / masterConversion);
              const ratio = expectedCost > 0 ? Math.abs(item.unit_price / expectedCost - 1) : Infinity;
              if (ratio < bestRatio) {
                bestRatio = ratio;
                bestMatch = gu;
              }
            }
            if (bestMatch && bestRatio < 0.5) {
              unitMatch = bestMatch;
              console.warn(`[${i}] Unit "${item.unit}" → price-inferred "${unitMatch.unit}" (CV=${unitMatch.conversionValue}, ratio=${bestRatio.toFixed(2)})`);
            }
          }
        }

        // FALLBACK 3: Default to LARGEST unit (box/thùng) since invoices typically use bulk units
        if (!unitMatch) {
          const sorted = [...groupUnits].sort((a, b) => b.conversionValue - a.conversionValue);
          unitMatch = sorted[0];
          console.warn(`[${i}] Unit "${item.unit}" không match → fallback largest unit "${unitMatch.unit}" (CV=${unitMatch.conversionValue})`);
        }
      }

      // 5. Determine Box and Retail values
      const allConversions = group.map(p => this.parseNumber((p as any).ConversionValue) || 1);
      const largestConversion = Math.max(...allConversions);

      let box = 0;
      let retail = 0;

      if (unitMatch.conversionValue >= largestConversion) {
        box = item.quantity;
        retail = 0;
      } else if (unitMatch.conversionValue <= masterConversion) {
        box = 0;
        retail = item.quantity;
      } else {
        const totalBaseUnits = item.quantity * unitMatch.conversionValue;
        box = Math.floor(totalBaseUnits / largestConversion);
        retail = totalBaseUnits % largestConversion;
      }

      const totalPrice = item.amount;

      // LOG
      console.log(`[${i}] Input: Box=${box} Retail=${retail} TotalPrice=${totalPrice} largestCV=${largestConversion} masterCV=${masterConversion} isPromo=${isPromo}`);

      if (isPromo) {
        // 6a. PROMOTIONAL ITEM: Only update OnHand (quantity), NOT price
        const editPayload = {
          ...master,
          Box: box,
          Retail: retail,
          TotalPrice: 0,
          Discount: 0,
          Discount2: 0,
          Edited: true,
          KeepBasePrice: true,
          IsPromotional: true, // Flag for product-row to skip price recalculation
          OnlyUpdateOnHand: true
        };

        if (master.Id) {
          localStorage.setItem(`editing_childProduct_${master.Id}`, JSON.stringify(editPayload));
        }
        if (master.Code) {
          localStorage.setItem(`editing_childProduct_${master.Code}`, JSON.stringify(editPayload));
        }

        const searchTerm = product.Code || product.Name;
        if (searchTerm && !updatedSearchTerms.includes(searchTerm)) {
          updatedSearchTerms.push(searchTerm);
        }

        processedMasters.add(master.Code);
        promoMasters.add(master.Code);

        results.push({
          itemIndex: i,
          status: 'success',
          productCode: master.Code,
          reason: 'KM - chỉ cập nhật tồn kho'
        });
      } else {
        // 6b. REGULAR ITEM: Save input fields to localStorage - let product-row's recalculateCost() handle the rest
        const editPayload = {
          ...master,
          Box: box,
          Retail: retail,
          TotalPrice: totalPrice,
          Discount: 0,
          Discount2: 0,
          Edited: true,
          KeepBasePrice: true
        };

        if (master.Id) {
          localStorage.setItem(`editing_childProduct_${master.Id}`, JSON.stringify(editPayload));
        }
        if (master.Code) {
          localStorage.setItem(`editing_childProduct_${master.Code}`, JSON.stringify(editPayload));
        }

        const searchTerm = product.Code || product.Name;
        if (searchTerm && !updatedSearchTerms.includes(searchTerm)) {
          updatedSearchTerms.push(searchTerm);
        }

        processedMasters.add(master.Code);

        results.push({
          itemIndex: i,
          status: 'success',
          productCode: master.Code
        });
      }
    }

    return {
      results,
      totalUpdated: results.filter(r => r.status === 'success').length,
      updatedSearchTerms
    };
  }

  /**
   * Update CLONE product prices from invoice data.
   *
   * Similar to updatePricesFromInvoice but:
   * - Only searches among clone products
   * - Finds clone "master" (base unit clone) instead of original master
   * - Uses OnHandNV field for clone stock
   */
  async updateClonePricesFromInvoice(
    invoiceItems: InvoiceItemForUpdate[],
    confirmedMatches: Map<number, MatchResult>
  ): Promise<UpdateResult> {
    const results: ItemUpdateResult[] = [];
    const updatedSearchTerms: string[] = [];
    const processedClones = new Set<string>();

    const allProducts = await this.productService.getAllProductsFromIndexedDB() || [];
    console.log(`[ClonePriceUpdate] Loaded ${allProducts.length} products from IndexedDB`);

    for (let i = 0; i < invoiceItems.length; i++) {
      const item = invoiceItems[i];
      const match = confirmedMatches.get(i);

      if (!match) {
        results.push({ itemIndex: i, status: 'skipped', reason: 'Không có sản phẩm Clone match' });
        continue;
      }

      const product = match.product;
      const searchCode = String(product.Code || product.Id);

      // Find clone product group (only clones with same Code)
      const cloneGroup = this.findCloneGroupFromList(searchCode, allProducts);
      if (!cloneGroup || cloneGroup.length === 0) {
        results.push({ itemIndex: i, status: 'error', reason: `Không tìm thấy nhóm Clone (Code=${searchCode})` });
        continue;
      }

      // Find clone master (base unit clone)
      const cloneMaster = this.findCloneMaster(cloneGroup);
      if (!cloneMaster) {
        results.push({ itemIndex: i, status: 'error', reason: 'Không tìm thấy Clone master' });
        continue;
      }

      // Skip duplicates
      if (processedClones.has(cloneMaster.Code)) {
        results.push({ itemIndex: i, status: 'warning', reason: `Clone "${cloneMaster.Code}" đã được cập nhật` });
        continue;
      }

      console.log(`[Clone ${i}] Group (${cloneGroup.length}):`, cloneGroup.map((p: any) => `${p.Code}|${p.Name}|CV=${p.ConversionValue}`));
      console.log(`[Clone ${i}] Master: Code=${cloneMaster.Code} Name="${cloneMaster.Name}"`);

      // Build unit list from clone group
      const groupUnits = cloneGroup.map(p => ({
        unit: (p as any).Unit || '',
        conversionValue: this.parseNumber((p as any).ConversionValue) || 1,
        product: p
      }));

      const allConversions = cloneGroup.map(p => this.parseNumber((p as any).ConversionValue) || 1);
      const largestConversion = Math.max(...allConversions);
      const masterConversion = this.parseNumber(cloneMaster.ConversionValue) || 1;

      // Match invoice unit
      let unitMatch = this.unitNorm.findMatchingUnit(item.unit, groupUnits);
      if (!unitMatch) {
        // FALLBACK 1: Try word-by-word matching (e.g., "Thùng 30 chai" → try "Thùng", "chai")
        if (item.unit) {
          const words = item.unit.split(/[\s,()]+/).filter(w => w.length > 0);
          for (const word of words) {
            unitMatch = this.unitNorm.findMatchingUnit(word, groupUnits);
            if (unitMatch) {
              console.warn(`[Clone ${i}] Unit "${item.unit}" → word match "${word}" → "${unitMatch.unit}" (CV=${unitMatch.conversionValue})`);
              break;
            }
          }
        }

        // FALLBACK 2: Infer from unit price - compare with existing Cost to find closest unit
        if (!unitMatch && item.unit_price > 0) {
          const masterCost = this.parseNumber(cloneMaster.Cost) || 0;
          if (masterCost > 0) {
            let bestMatch: typeof groupUnits[0] | null = null;
            let bestRatio = Infinity;
            for (const gu of groupUnits) {
              // Expected cost for this unit = masterCost * (CV / masterCV)
              const expectedCost = masterCost * (gu.conversionValue / masterConversion);
              const ratio = expectedCost > 0 ? Math.abs(item.unit_price / expectedCost - 1) : Infinity;
              if (ratio < bestRatio) {
                bestRatio = ratio;
                bestMatch = gu;
              }
            }
            // Accept if within 50% of expected price
            if (bestMatch && bestRatio < 0.5) {
              unitMatch = bestMatch;
              console.warn(`[Clone ${i}] Unit "${item.unit}" → price-inferred "${unitMatch.unit}" (CV=${unitMatch.conversionValue}, ratio=${bestRatio.toFixed(2)})`);
            }
          }
        }

        // FALLBACK 3: Default to LARGEST unit (box/thùng) since invoices typically use bulk units
        if (!unitMatch) {
          const sorted = [...groupUnits].sort((a, b) => b.conversionValue - a.conversionValue);
          unitMatch = sorted[0];
          console.warn(`[Clone ${i}] Unit "${item.unit}" không match → fallback largest unit "${unitMatch.unit}" (CV=${unitMatch.conversionValue})`);
        }
      }

      let box = 0;
      let retail = 0;

      if (unitMatch.conversionValue >= largestConversion) {
        box = item.quantity;
      } else if (unitMatch.conversionValue <= masterConversion) {
        retail = item.quantity;
      } else {
        const totalBaseUnits = item.quantity * unitMatch.conversionValue;
        box = Math.floor(totalBaseUnits / largestConversion);
        retail = totalBaseUnits % largestConversion;
      }

      const isPromo = item.isPromotional || (item.amount === 0 && item.unit_price === 0);

      // Calculate OnHandNV (clone stock) for master
      const currentMasterOnHandNV = this.parseNumber(cloneMaster.OnHandNV) || 0;
      const totalBaseUnits = (box * largestConversion) + retail;
      const addedOnHandNV = masterConversion > 0 ? totalBaseUnits / masterConversion : 0;
      const newMasterOnHandNV = currentMasterOnHandNV + addedOnHandNV;

      // Calculate new Cost for master
      const currentCost = this.parseNumber(cloneMaster.Cost) || 0;
      let newCost = currentCost;
      if (!isPromo && item.amount > 0 && totalBaseUnits > 0) {
        newCost = Math.round(item.amount / totalBaseUnits * masterConversion);
      }

      console.log(`[Clone ${i}] Box=${box} Retail=${retail} TotalPrice=${item.amount} isPromo=${isPromo} OnHandNV: ${currentMasterOnHandNV}→${newMasterOnHandNV} Cost: ${currentCost}→${newCost}`);

      // Save master to localStorage with calculated OnHandNV and Cost
      const editPayload = {
        ...cloneMaster,
        Box: box,
        Retail: retail,
        TotalPrice: isPromo ? 0 : item.amount,
        OnHandNV: newMasterOnHandNV,
        Cost: isPromo ? currentCost : newCost,
        Discount: 0,
        Discount2: 0,
        Edited: true,
        KeepBasePrice: isPromo,
        IsPromotional: isPromo,
        OnlyUpdateOnHand: isPromo,
        IsCloneUpdate: true
      };

      if (cloneMaster.Id) {
        localStorage.setItem(`editing_childProduct_${cloneMaster.Id}`, JSON.stringify(editPayload));
      }
      if (cloneMaster.Code) {
        localStorage.setItem(`editing_childProduct_${cloneMaster.Code}`, JSON.stringify(editPayload));
      }

      // Save ALL children in clone group with proportional OnHandNV and Cost
      for (const child of cloneGroup) {
        if (String(child.Id) === String(cloneMaster.Id)) continue;
        const childConversion = this.parseNumber((child as any).ConversionValue) || 1;
        const childOnHandNV = masterConversion > 0 ? (newMasterOnHandNV * masterConversion) / childConversion : 0;
        const oldChildCost = this.parseNumber(child.Cost) || 0;
        const oldChildBasePrice = this.parseNumber(child.BasePrice) || 0;
        const childCost = isPromo
          ? oldChildCost
          : Math.round((newCost / masterConversion) * childConversion);
        const childBasePrice = isPromo
          ? oldChildBasePrice
          : Math.round((oldChildBasePrice + (childCost - oldChildCost)) / 100) * 100;

        const childPayload = {
          ...child,
          OnHandNV: childOnHandNV,
          Cost: childCost,
          BasePrice: childBasePrice,
          Edited: true,
          IsCloneUpdate: true
        };

        if (child.Id) {
          localStorage.setItem(`editing_childProduct_${child.Id}`, JSON.stringify(childPayload));
        }
        if (child.Code) {
          localStorage.setItem(`editing_childProduct_${child.Code}`, JSON.stringify(childPayload));
        }
      }

      const searchTerm = product.Code || product.Name;
      if (searchTerm && !updatedSearchTerms.includes(searchTerm)) {
        updatedSearchTerms.push(searchTerm);
      }

      processedClones.add(cloneMaster.Code);

      results.push({
        itemIndex: i,
        status: 'success',
        productCode: cloneMaster.Code,
        newCost: isPromo ? undefined : newCost,
        reason: isPromo ? 'Clone KM - chỉ cập nhật tồn kho' : undefined
      });
    }

    return {
      results,
      totalUpdated: results.filter(r => r.status === 'success').length,
      updatedSearchTerms
    };
  }

  /**
   * Find CLONE product group from a full product list.
   * Only includes clone products with matching Code.
   */
  private findCloneGroupFromList(codeOrId: string, allProducts: any[]): any[] | null {
    const matching = allProducts.filter(
      p => (String(p.Code) === codeOrId || String(p.Id) === codeOrId) && this.isClone(p)
    );

    if (matching.length === 0) return null;

    const baseProduct = matching[0];
    const masterId = baseProduct.MasterUnitId || baseProduct.Id;

    // Collect full clone group: same MasterUnitId or same Code, all clones
    const group = allProducts.filter(p => {
      if (!this.isClone(p)) return false;
      const pCode = String(p.Code);
      const pMasterId = p.MasterUnitId;
      if (pCode === codeOrId || String(p.Id) === codeOrId) return true;
      if (pMasterId && String(pMasterId) === String(masterId)) return true;
      if (String(p.Id) === String(masterId)) return true;
      return false;
    });

    return group.length > 0 ? group : null;
  }

  /**
   * Find clone master (base unit clone with lowest ConversionValue)
   */
  private findCloneMaster(group: any[]): any | null {
    if (group.length === 0) return null;

    const byMasterId = group.find(
      p => p.MasterUnitId == null || p.MasterUnitId === undefined
    );
    if (byMasterId) return byMasterId;

    const bySelfRef = group.find(p => p.MasterUnitId === p.Id);
    if (bySelfRef) return bySelfRef;

    return group.reduce((min, p) => {
      const cv = this.parseNumber(p.ConversionValue) || 1;
      const minCv = this.parseNumber(min.ConversionValue) || 1;
      return cv < minCv ? p : min;
    }, group[0]);
  }

  private isClone(p: any): boolean {
    if (typeof p.isClone === 'boolean') return p.isClone;
    if (typeof p.isClone === 'string') return p.isClone.toLowerCase() === 'true';
    if (p.OnHandNV > 0 && (p.OnHand === 0 || !p.OnHand)) return true;
    if (p.KiotVietSync === false) return true;
    return false;
  }

  /**
   * Accumulate promo item quantity into an existing localStorage entry.
   * Returns a description string like "+9 retail → total 27 retail"
   */
  private accumulatePromoQuantity(
    master: any,
    item: InvoiceItemForUpdate,
    group: any[],
    allProducts: any[]
  ): string {
    // Calculate Box/Retail for this item (same logic as main flow)
    const allConversions = group.map(p => this.parseNumber((p as any).ConversionValue) || 1);
    const largestConversion = Math.max(...allConversions);
    const masterConversion = this.parseNumber(master.ConversionValue) || 1;

    const groupUnits = group.map(p => ({
      unit: (p as any).Unit || '',
      conversionValue: this.parseNumber((p as any).ConversionValue) || 1,
      product: p
    }));
    const unitMatch = this.unitNorm.findMatchingUnit(item.unit, groupUnits);
    const cv = unitMatch ? unitMatch.conversionValue : masterConversion;

    let addBox = 0;
    let addRetail = 0;
    if (cv >= largestConversion) {
      addBox = item.quantity;
    } else if (cv <= masterConversion) {
      addRetail = item.quantity;
    } else {
      const totalBaseUnits = item.quantity * cv;
      addBox = Math.floor(totalBaseUnits / largestConversion);
      addRetail = totalBaseUnits % largestConversion;
    }

    // Read existing localStorage entry and accumulate
    const key = master.Id
      ? `editing_childProduct_${master.Id}`
      : `editing_childProduct_${master.Code}`;
    const existing = localStorage.getItem(key);
    let payload: any;

    if (existing) {
      payload = JSON.parse(existing);
      payload.Box = (this.parseNumber(payload.Box) || 0) + addBox;
      payload.Retail = (this.parseNumber(payload.Retail) || 0) + addRetail;
    } else {
      // Shouldn't happen (master was already processed), but handle gracefully
      payload = {
        ...master,
        Box: addBox,
        Retail: addRetail,
        TotalPrice: 0,
        Discount: 0,
        Discount2: 0,
        Edited: true,
        KeepBasePrice: true,
        IsPromotional: true,
        OnlyUpdateOnHand: true
      };
    }

    // Save back to both keys
    if (master.Id) {
      localStorage.setItem(`editing_childProduct_${master.Id}`, JSON.stringify(payload));
    }
    if (master.Code) {
      localStorage.setItem(`editing_childProduct_${master.Code}`, JSON.stringify(payload));
    }

    console.log(`[PromoAccumulate] ${master.Code}: +Box=${addBox} +Retail=${addRetail} → total Box=${payload.Box} Retail=${payload.Retail}`);
    return `+Box=${addBox} +Retail=${addRetail} → total Box=${payload.Box} Retail=${payload.Retail}`;
  }

  /**
   * Find ORIGINAL (non-clone) product group from a full product list (IndexedDB).
   * Groups products by Code, then finds the group containing the search key.
   */
  private findProductGroupFromList(codeOrId: string, allProducts: any[]): any[] | null {
    // Find all products matching this Code (both original and clone)
    const matching = allProducts.filter(
      p => String(p.Code) === codeOrId || String(p.Id) === codeOrId
    );

    if (matching.length === 0) return null;

    // For each matching product, find its full unit group (master + children by MasterUnitId)
    // First try to find an original (non-clone) product
    const original = matching.find(p => !this.isClone(p));
    const baseProduct = original || matching[0];

    // Find the master of this product
    const masterId = baseProduct.MasterUnitId || baseProduct.Id;

    // Collect the full group: master + all children with same MasterUnitId
    const group = allProducts.filter(p => {
      if (this.isClone(p)) return false; // Skip clones
      const pCode = String(p.Code);
      const pMasterId = p.MasterUnitId;
      // Same product (by Code) OR same master group (by MasterUnitId)
      if (pCode === codeOrId || String(p.Id) === codeOrId) return true;
      if (pMasterId && String(pMasterId) === String(masterId)) return true;
      if (String(p.Id) === String(masterId)) return true;
      return false;
    });

    return group.length > 0 ? group : null;
  }

  /**
   * Find master product in a group (prefer original, skip clones):
   * Master = non-clone with MasterUnitId === null or lowest ConversionValue
   */
  private findMaster(group: any[]): any | null {
    const originals = group.filter(p => !this.isClone(p));
    const candidates = originals.length > 0 ? originals : group;

    const byMasterId = candidates.find(
      p => p.MasterUnitId == null || p.MasterUnitId === undefined
    );
    if (byMasterId) return byMasterId;

    const bySelfRef = candidates.find(p => p.MasterUnitId === p.Id);
    if (bySelfRef) return bySelfRef;

    return candidates.reduce((min, p) => {
      const cv = this.parseNumber(p.ConversionValue) || 1;
      const minCv = this.parseNumber(min.ConversionValue) || 1;
      return cv < minCv ? p : min;
    }, candidates[0]);
  }
}
