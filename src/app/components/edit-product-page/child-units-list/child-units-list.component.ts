import { Component, Input, Output, EventEmitter, ChangeDetectorRef, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EditedProduct } from '../services/product-edit.service';
import { validateNumber } from '../utility-functions/app.validate-number';

@Component({
  selector: 'app-child-units-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './child-units-list.component.html',
  styleUrls: ['./child-units-list.component.css']
})
export class ChildUnitsListComponent implements OnChanges {
  @Input() childProducts: EditedProduct[] = [];
  @Input() masterProduct!: EditedProduct;
  @Input() baseColor: string = '#ffffff';

  @Output() childEdit = new EventEmitter<EditedProduct>();

  // Expose Math for template
  Math = Math;

  // Store original values for diff calculation
  private originalValues = new Map<number, { BasePrice: number; Cost: number; OnHand: number }>();

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges) {
    // Force change detection when childProducts input changes
    if (changes['childProducts']) {
      // Load original values for diff calculation
      this.loadOriginalValues();
      this.cdr.detectChanges();
    }
  }

  private loadOriginalValues() {
    const isClone = (this.masterProduct as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';

    // Get original products from grouped_* localStorage
    const oldProducts = Object.entries(localStorage)
      .filter(([key]) => key.startsWith('grouped_'))
      .map(([_, value]) => JSON.parse(value || '[]'));

    console.group(`${tag} [ChildUnitsList.loadOriginals] Master: ${this.masterProduct?.Code} "${this.masterProduct?.Name}" | ${this.childProducts.length} children`);

    this.childProducts.forEach(child => {
      // CRITICAL: If child has _original* runtime values (set by sync/recalculate),
      // ALWAYS update originalValues to keep diff calculations accurate.
      // Without this, stale originalValues from first load cause wrong diffs after sync.
      const hasRuntimeOriginals = (child as any)._originalOnHand !== undefined;
      const alreadyHas = this.originalValues.has(child.Id);

      if (!alreadyHas || hasRuntimeOriginals) {
        // FIX: When we already have stored originals, use them as baseline
        // instead of current (potentially edited) child values.
        // This prevents "giá bán cũ" from being overwritten by the new value
        // when _originalBasePrice is undefined but _originalOnHand is defined.
        const existing = alreadyHas ? this.originalValues.get(child.Id) : null;
        let originalBasePrice = existing ? existing.BasePrice : child.BasePrice;
        let originalCost = existing ? existing.Cost : child.Cost;
        let originalOnHand = existing ? existing.OnHand : child.OnHand;
        let source = existing ? 'existing' : 'current';

        // Priority 1: Use _original* values (set by sync or recalculate)
        if ((child as any)._originalOnHand !== undefined) {
          originalOnHand = (child as any)._originalOnHand;
          source = '_original';
        }
        if ((child as any)._originalCost !== undefined) {
          originalCost = (child as any)._originalCost;
        }
        if ((child as any)._originalBasePrice !== undefined) {
          originalBasePrice = (child as any)._originalBasePrice;
        }

        // Priority 2: Find from grouped_* localStorage (only if no runtime originals)
        if (!hasRuntimeOriginals) {
          let found = false;
          oldProducts.forEach((oP) => {
            Object.values(oP).forEach((productList: any) => {
              if (Array.isArray(productList)) {
                const matchingProduct = productList.find((p: any) => p.Code === child.Code);
                if (matchingProduct) {
                  originalBasePrice = matchingProduct.BasePrice;
                  originalCost = matchingProduct.Cost;
                  originalOnHand = matchingProduct.OnHand;
                  source = 'localStorage';
                  found = true;
                }
              }
            });
          });

          // Skip if no source found at all (first load, no grouped_* data)
          if (!found && !alreadyHas) {
            // Use current values as baseline
            source = 'current (fallback)';
          }
        }

        this.originalValues.set(child.Id, {
          BasePrice: originalBasePrice,
          Cost: originalCost,
          OnHand: originalOnHand
        });

        console.log(`  Child: Id=${child.Id} ${child.Code} "${child.Name}" (${child.Unit}) Conv=${child.ConversionValue} | originals[${source}${alreadyHas ? ',UPDATED' : ''}]: Cost=${originalCost} BasePrice=${originalBasePrice} OnHand=${originalOnHand} | current: Cost=${child.Cost} BasePrice=${child.BasePrice} OnHand=${child.OnHand} | diff: Cost=${child.Cost - originalCost} BasePrice=${child.BasePrice - originalBasePrice} OnHand=${child.OnHand - originalOnHand}`);
      }
    });

    console.groupEnd();
  }

  getOriginalBasePrice(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    return original ? original.BasePrice : 0;
  }

  getBasePriceDiff(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    if (!original) return 0;
    return child.BasePrice - original.BasePrice;
  }

  getCostDiff(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    if (!original) return 0;
    return child.Cost - original.Cost;
  }

  getOnHandDiff(child: EditedProduct): number {
    const original = this.originalValues.get(child.Id);
    if (!original) return 0;
    return child.OnHand - original.OnHand;
  }

  isIncrease(diff: number): boolean {
    return diff > 0;
  }

  isDecrease(diff: number): boolean {
    return diff < 0;
  }

  isUnchanged(diff: number): boolean {
    return diff === 0;
  }

  onBasePriceChange(child: EditedProduct, event: any) {
    const value = this.parseNumberInput(event.target.value);
    const isClone = (child as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';
    console.log(`${tag} [ChildUnitsList.onBasePriceChange] ${child.Code} "${child.Name}" (${child.Unit}) | BasePrice: ${child.BasePrice}→${value} (KeepBasePrice=true)`);
    child.BasePrice = value;
    child.KeepBasePrice = true;
    child.Edited = true;

    this.emitChildEdit(child);
  }

  onBasePriceBlur(event: any) {
    event.target.value = this.formatNumber(this.parseNumberInput(event.target.value));
  }

  onCostChange(child: EditedProduct, event: any) {
    const value = this.parseNumberInput(event.target.value);
    const isClone = (child as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';
    console.log(`${tag} [ChildUnitsList.onCostChange] ${child.Code} "${child.Name}" (${child.Unit}) | Cost: ${child.Cost}→${value}`);
    child.Cost = value;
    child.Edited = true;

    this.emitChildEdit(child);
  }

  onCostBlur(event: any) {
    event.target.value = this.formatNumber(this.parseNumberInput(event.target.value));
  }

  getConversionText(child: EditedProduct): string {
    const unitA = child;
    const unitB = this.masterProduct;

    // Determine which unit is the 'bigger' one (larger conversion value)
    let biggerUnit, smallerUnit;
    if ((Number(unitA.ConversionValue) || 1) > (Number(unitB.ConversionValue) || 1)) {
      biggerUnit = unitA;
      smallerUnit = unitB;
    } else {
      biggerUnit = unitB;
      smallerUnit = unitA;
    }

    const biggerConversion = Number(biggerUnit.ConversionValue) || 1;
    const smallerConversion = Number(smallerUnit.ConversionValue) || 1;

    // Avoid division by zero and handle cases where values are identical
    if (smallerConversion === 0 || biggerConversion === smallerConversion) {
      // If values are the same, show a 1-to-1 mapping between the specific child and master
      return `1 ${child.Unit} = 1 ${this.masterProduct.Unit}`;
    }

    const ratio = biggerConversion / smallerConversion;

    // Always display as "1 [Bigger Unit] = X [Smaller Unit]"
    return `1 ${biggerUnit.Unit} = ${this.formatNumber(ratio)} ${smallerUnit.Unit}`;
  }

  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '0';

    // Format as Vietnamese currency (7000000 → 7.000.000)
    return Math.round(num).toLocaleString('en-US');
  }

  validateNumber(event: KeyboardEvent) {
    validateNumber(event);
  }

  private parseNumberInput(value: string): number {
    const cleaned = value.replace(/,/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }

  private emitChildEdit(child: EditedProduct) {
    this.childEdit.emit(child);
  }
}
