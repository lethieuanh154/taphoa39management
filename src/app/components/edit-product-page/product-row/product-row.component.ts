import { Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges, ChangeDetectorRef, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';
import { EditedProduct } from '../services/product-edit.service';
import { ChildUnitsListComponent } from '../child-units-list/child-units-list.component';
import { QuickCalcDialogComponent } from '../quick-calc-dialog/quick-calc-dialog.component';
import { DeleteConfirmDialogComponent } from '../delete-confirm-dialog/delete-confirm-dialog.component';
import { EditProductDialogComponent } from '../edit-product-dialog/edit-product-dialog.component';
import { CloneProductDialogComponent } from '../clone-product-dialog/clone-product-dialog.component';
import { ProductHistoryDialogComponent } from '../product-history-dialog/product-history-dialog.component';
import { ProductInfoDialogComponent } from '../product-info-dialog/product-info-dialog.component';
import { ProductService } from '../../../services/product.service';
import { validateNumber } from '../utility-functions/app.validate-number';

export interface DeleteProductEvent {
  product: EditedProduct;
  childProducts: EditedProduct[];
}

export interface EditProductEvent {
  product: EditedProduct;
  childProducts: EditedProduct[];
  updatedProducts: any[];
}

export interface CloneProductEvent {
  product: EditedProduct;
  childProducts: EditedProduct[];
  clonedProducts: any[];
}

export interface SyncProductEvent {
  product: EditedProduct;
  childProducts: EditedProduct[];
  syncedProducts: any[];
}

@Component({
  selector: 'app-product-row',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatDialogModule,
    MatMenuModule,
    MatButtonModule,
    ChildUnitsListComponent
  ],
  templateUrl: './product-row.component.html',
  styleUrls: ['./product-row.component.css']
})
export class ProductRowComponent implements OnInit, OnChanges, AfterViewInit {
  @Input() product!: EditedProduct;
  @Input() childProducts: EditedProduct[] = [];
  @Input() productColor: string = '#ffffff';

  @Input() pendingCloneSave = false;

  @Output() productChange = new EventEmitter<EditedProduct>();
  @Output() childrenChange = new EventEmitter<EditedProduct[]>();
  @Output() deleteProduct = new EventEmitter<DeleteProductEvent>();
  @Output() editProduct = new EventEmitter<EditProductEvent>();
  @Output() cloneProduct = new EventEmitter<CloneProductEvent>();
  @Output() syncProduct = new EventEmitter<SyncProductEvent>();
  @Output() saveCloneClick = new EventEmitter<void>();

  // Sync state
  isSyncing = false;

  @ViewChild('basePriceInput') basePriceInput?: ElementRef<HTMLInputElement>;
  @ViewChild('costDisplay') costDisplay?: ElementRef<HTMLSpanElement>;

  expanded = false;

  // Expose Math for template
  Math = Math;

  // Store original values from grouped_* localStorage or from product as loaded
  private originalBasePrice: number = 0;
  private originalCost: number = 0;
  private originalOnHand: number = 0;

  // Prevent multiple dialog opens
  private isDialogOpen = false;

  constructor(
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private productService: ProductService
  ) { }

  ngOnInit() {
    // Initial load (component creation)
    this.loadOriginalValues();
  }

  ngOnChanges(changes: SimpleChanges) {
    // IMPORTANT: ProductRow instances are reused by virtual scroll.
    // When the @Input() product changes we MUST reload original values used for calculations.
    if (changes['product'] && changes['product'].currentValue) {
      // Update original values to match the newly bound product
      this.loadOriginalValues();

      // Force update of input fields and view so calculations use the correct originals
      this.updateInputFields();
      this.cdr.detectChanges();

      // Auto-trigger recalculateCost if product has pre-filled input values (e.g. from invoice)
      // Skip for clone products with IsCloneUpdate - their Cost/OnHandNV are pre-calculated
      const p = changes['product'].currentValue;
      if (p.Edited && (p.Box > 0 || p.Retail > 0 || p.TotalPrice > 0) && !p.IsCloneUpdate) {
        this.recalculateCost();
      }
    }

    // FIX: Initialize _originalOnHand for children when childProducts input changes.
    // Without this, first-time Box edit only updates master (children lack originals for delta calc).
    if (changes['childProducts'] && changes['childProducts'].currentValue) {
      this.initChildOriginals(changes['childProducts'].currentValue);
    }
  }

  /**
   * Pre-initialize _originalOnHand/_originalCost/_originalBasePrice on children.
   * Called once when childProducts are first bound, BEFORE any Box/Retail edits.
   * This ensures delta-based calculations work correctly on first edit of the day.
   */
  private initChildOriginals(children: EditedProduct[]) {
    if (!children || children.length === 0) return;
    for (const child of children) {
      if ((child as any)._originalOnHand === undefined) {
        (child as any)._originalOnHand = this.parseNumber(child.OnHand);
        (child as any)._originalCost = this.parseNumber(child.Cost);
        (child as any)._originalBasePrice = this.parseNumber(child.BasePrice);
      }
    }
  }

  ngAfterViewInit() {
    // ViewChild references are available here
  }

  /**
   * Load original product values for calculation.
   * Called on component init AND every time @Input product changes (ngOnChanges).
   */
  private loadOriginalValues() {
    const isClone = (this.product as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';

    // CRITICAL: If the product already has saved originals (from a previous recalculateCost),
    // use them instead of the current values which may already include Box/Retail additions.
    // This prevents double-counting when the product is passed to the edited-products-dialog
    // or when virtual scroll recycles the row back to an already-edited product.
    if (this.product && (this.product as any)._originalOnHand !== undefined) {
      this.originalOnHand = this.parseNumber((this.product as any)._originalOnHand);
      this.originalCost = this.parseNumber((this.product as any)._originalCost);
      this.originalBasePrice = this.parseNumber((this.product as any)._originalBasePrice);
      console.log(`${tag} [loadOriginals] Id=${this.product.Id} "${this.product.Name}" (${this.product.Unit}) Conv=${this.product.ConversionValue} | FROM SAVED: Cost=${this.originalCost} BasePrice=${this.originalBasePrice} OnHand=${this.originalOnHand}`);
    } else {
      // First time: read from product values (from IndexedDB, before any editing)
      this.originalBasePrice = this.parseNumber(this.product?.BasePrice);
      this.originalCost = this.parseNumber(this.product?.Cost);
      this.originalOnHand = this.parseNumber(this.product?.OnHand);

      // Save originals on the product object for future re-use
      if (this.product) {
        (this.product as any)._originalOnHand = this.originalOnHand;
        (this.product as any)._originalCost = this.originalCost;
        (this.product as any)._originalBasePrice = this.originalBasePrice;
      }
      console.log(`${tag} [loadOriginals] Id=${this.product?.Id} "${this.product?.Name}" (${this.product?.Unit}) Conv=${this.product?.ConversionValue} | FIRST TIME: Cost=${this.originalCost} BasePrice=${this.originalBasePrice} OnHand=${this.originalOnHand}`);
    }

    // If product was just loaded and has no Edited flag, ensure Edited is boolean
    if (this.product && typeof this.product.Edited === 'undefined') {
      this.product.Edited = false;
    }
  }

  /**
   * Parse number from various input formats
   */
  private parseNumber(value: any): number {
    if (typeof value === 'string') {
      const normalized = value.replace(/[^0-9.-]/g, '');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  get darkerColor(): string {
    // Make master row color 15% darker than children
    const hex = this.productColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const darkerR = Math.max(0, Math.floor(r * 0.95));
    const darkerG = Math.max(0, Math.floor(g * 0.95));
    const darkerB = Math.max(0, Math.floor(b * 0.95));

    return `rgb(${darkerR}, ${darkerG}, ${darkerB})`;
  }

  toggleExpand() {
    this.expanded = !this.expanded;
  }

  onRowClick(event: MouseEvent) {
    // Only toggle if there are children and not clicking on input fields
    const target = event.target as HTMLElement;

    // Don't toggle if clicking on input, button, mat-icon, or mat-checkbox
    if (target.tagName === 'INPUT' ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'MAT-ICON' ||
      target.tagName === 'MAT-CHECKBOX' ||
      target.closest('input') ||
      target.closest('button') ||
      target.closest('mat-checkbox')) {
      return;
    }

    // Only toggle if there are children
    if (this.childProducts && this.childProducts.length > 0) {
      this.toggleExpand();
    }
  }

  /**
   * onCodeChange: support both (event) and direct value:
   * - If template uses (input) or (blur) => event object
   * - If template uses (ngModelChange) => receives string value
   *
   * Because [(ngModel)] updates the model before blur/ngModelChange, we always persist.
   * CRITICAL: Save OriginalCode BEFORE changing Code for KiotViet API matching
   */
  onCodeChange(eventOrValue: any) {
    const newCode = typeof eventOrValue === 'string'
      ? eventOrValue.trim()
      : (eventOrValue?.target?.value ?? '').toString().trim();

    // CRITICAL: Save OriginalCode FIRST time Code is changed
    // This is needed for KiotViet API to match edited product with payload
    if (!this.product.OriginalCode && this.product.Code !== newCode) {
      this.product.OriginalCode = this.product.Code;
      console.log(`🔖 [onCodeChange] Saved OriginalCode: "${this.product.OriginalCode}"`);
    }

    this.product.Code = newCode;
    this.product.Edited = true;
    this.saveToLocalStorage();
    this.emitProductChange();
  }

  /**
   * onNameChange: support both (event) and direct value (ngModelChange)
   * CRITICAL: Save OriginalName BEFORE changing Name for KiotViet API matching
   */
  onNameChange(eventOrValue: any) {
    const newName = typeof eventOrValue === 'string'
      ? eventOrValue.trim()
      : (eventOrValue?.target?.value ?? '').toString().trim();

    // CRITICAL: Save OriginalName FIRST time Name is changed
    // This is needed for KiotViet API to match edited product with payload
    if (!(this.product as any).OriginalName && this.product.Name !== newName) {
      (this.product as any).OriginalName = this.product.Name;
      console.log(`🔖 [onNameChange] Saved OriginalName: "${(this.product as any).OriginalName}"`);
    }

    this.product.Name = newName;
    this.product.Edited = true;
    this.saveToLocalStorage();
    this.emitProductChange();
  }

  onBasePriceChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.BasePrice = value;
    this.product.KeepBasePrice = true;
    this.product.Edited = true;
    this.saveToLocalStorage();
    this.emitProductChange();
  }

  onBasePriceBlur() {
    // Format the value when user leaves the input
    if (this.basePriceInput?.nativeElement) {
      this.basePriceInput.nativeElement.value = this.formatNumber(this.product.BasePrice || 0);
    }
  }

  onBoxChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Box = value;
    this.recalculateCost();
  }

  onBoxBlur(event: any) {
    event.target.value = this.formatNumber(this.product.Box || 0);
  }

  onRetailChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Retail = value;
    this.recalculateCost();
  }

  onRetailBlur(event: any) {
    event.target.value = this.formatNumber(this.product.Retail || 0);
  }

  onDiscountChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Discount = value;
    this.recalculateCost();
  }

  onDiscountBlur(event: any) {
    event.target.value = this.product.Discount ? this.formatNumber(this.product.Discount) : '';
  }

  onDiscount2Change(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.Discount2 = value;
    this.recalculateCost();
  }

  onDiscount2Blur(event: any) {
    event.target.value = this.product.Discount2 ? this.formatNumber(this.product.Discount2) : '';
  }

  onTotalPriceChange(event: any) {
    const value = this.parseNumberInput(event.target.value);
    this.product.TotalPrice = value;
    this.recalculateCost();
  }

  onTotalPriceBlur(event: any) {
    event.target.value = this.product.TotalPrice ? this.formatNumber(this.product.TotalPrice) : '';
  }

  onTotalPriceKeydown(event: KeyboardEvent) {
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation(); // Stop event from bubbling up

      // Prevent multiple opens
      if (!this.isDialogOpen) {
        this.openQuickCalcDialog();
      }
      return;
    }

    validateNumber(event);
  }

  onAverageCheckPointChange() {
    // When checkbox changes, recalculate cost with new mode
    this.product.Edited = true;
    this.recalculateCost();
  }

  openQuickCalcDialog() {
    // Prevent multiple dialog opens
    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    // Calculate the largest child ConversionValue ratio
    let largestChildRatio = 1;
    if (this.childProducts && this.childProducts.length > 0) {
      const largestChild = this.childProducts.reduce((prev, curr) => {
        const prevConv = Number(prev?.ConversionValue ?? -Infinity);
        const currConv = Number(curr?.ConversionValue ?? -Infinity);
        return currConv > prevConv ? curr : prev;
      }, this.childProducts[0]);

      const masterConversion = Number(this.product.ConversionValue) || 1;
      const largestChildConversion = Number(largestChild.ConversionValue) || 1;
      largestChildRatio = largestChildConversion / masterConversion;
    }

    const dialogRef = this.dialog.open(QuickCalcDialogComponent, {
      width: '500px',
      data: {
        box: this.product.Box || 0,
        retail: this.product.Retail || 0,
        discount: this.product.Discount || 0,
        discount2: this.product.Discount2 || 0,
        totalPrice: this.product.TotalPrice || 0,
        largestChildRatio: largestChildRatio // Pass ratio to dialog
      },
      disableClose: false // Allow closing with ESC or backdrop click
    });

    dialogRef.afterClosed().subscribe(result => {
      // Reset flag when dialog closes
      this.isDialogOpen = false;

      if (result && result.saved) {
        this.product.Box = result.box;
        this.product.Retail = result.retail;
        this.product.Discount = result.discount;
        this.product.Discount2 = result.discount2;
        this.product.TotalPrice = result.totalPrice;

        this.recalculateCost();
      }
    });
  }

  private parseNumberInput(value: string): number {
    const cleaned = value.replace(/,/g, '');
    const num = Number(cleaned);
    return isNaN(num) ? 0 : num;
  }

  /**
   * Manually update input field values after programmatic changes
   * This is needed because [value] binding doesn't auto-update
   */
  private updateInputFields() {
    // Update BasePrice input field
    if (this.basePriceInput?.nativeElement) {
      this.basePriceInput.nativeElement.value = this.formatNumber(this.product.BasePrice || 0);
    }

    // Force cost display update if available
    if (this.costDisplay?.nativeElement) {
      this.costDisplay.nativeElement.textContent = this.formatNumber(this.product.Cost);
    }

    // Force change detection to update view
    this.cdr.detectChanges();
  }

  private recalculateCost() {
    const isClone = (this.product as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';
    const label = `${this.product.Code} "${this.product.Name}" (${this.product.Unit})`;

    // 1) Lấy ConversionValue lớn nhất của master + child
    const allConversions = [
      this.parseNumber(this.product.ConversionValue) || 1,
      ...this.childProducts.map(c => this.parseNumber(c.ConversionValue) || 1)
    ];
    const largestConversion = Math.max(...allConversions);  // <-- conversion lớn nhất

    const conversionValue = this.parseNumber(this.product.ConversionValue) || 1;
    const originalRetail = this.parseNumber(this.product.Retail);
    const totalPrice = this.parseNumber(this.product.TotalPrice);
    const discountOnMaster = this.parseNumber(this.product.Discount);
    const discountOnTotal = this.parseNumber(this.product.Discount2);
    let box = 0;

    let retail = originalRetail;

    // Handle retail > conversionValue case (same as cost.service.ts)
    if (originalRetail > largestConversion) {
      retail = originalRetail % largestConversion;
      box = (originalRetail - retail) / largestConversion;
    } else {
      box = this.parseNumber(this.product.Box)
    }

    const totalUnits = (box * largestConversion) + retail;
    const addedOnHand = conversionValue > 0 ? totalUnits / conversionValue : 0;

    console.group(`${tag} [recalculateCost] ${label}`);
    console.log(`Input: Box=${box} Retail=${retail} TotalPrice=${totalPrice} Discount=${discountOnMaster} Discount2=${discountOnTotal}`);
    console.log(`Conversion: master=${conversionValue} largest=${largestConversion} children=[${this.childProducts.map(c => c.ConversionValue).join(',')}]`);
    console.log(`Calc: totalUnits=${totalUnits} addedOnHand=${addedOnHand}`);
    console.log(`Originals: Cost=${this.originalCost} BasePrice=${this.originalBasePrice} OnHand=${this.originalOnHand}`);

    if (box === 0 && retail === 0 && totalPrice === 0) {
      // No input yet - keep original values (matching cost.service.ts line 67-71)
      this.product.Cost = this.originalCost;
      this.product.BasePrice = this.originalBasePrice;
      this.product.OnHand = this.originalOnHand;
      console.log(`Result: NO INPUT → reset to originals`);
      console.groupEnd();
    } else if ((box > 0 || retail > 0) && totalPrice === 0) {
      // Only Box/Retail entered, no TotalPrice - only update OnHand (matching cost.service.ts line 72-76)
      this.product.Cost = this.originalCost;
      if (!this.product.KeepBasePrice) {
        this.product.BasePrice = this.originalBasePrice;
      }
      this.product.OnHand = (this.originalOnHand + addedOnHand) || 0;

      console.log(`Result: ONLY OnHand → OnHand=${this.originalOnHand} + ${addedOnHand} = ${this.product.OnHand} (Cost/BasePrice unchanged)`);
      console.groupEnd();

      // Mark as edited and emit change for UI update
      this.product.Edited = true;

      // Update children OnHand based on ConversionValue (without changing Cost/BasePrice)
      this.updateChildrenOnHandOnly();

      // Save to localStorage
      this.saveToLocalStorage();

      this.emitProductChange();

      // Manually update input fields to reflect new values
      this.updateInputFields();
    } else {
      // Has TotalPrice - proceed with calculation (matching cost.service.ts line 78-104)
      const mode = this.product.AverageCheckPoint ? 'WEIGHTED_AVG' : 'SIMPLE';

      if (this.product.AverageCheckPoint === true) {
        // WEIGHTED AVERAGE MODE (matching cost.service.ts line 79-90)
        const netTotalPrice = Math.max(totalPrice - discountOnTotal, 0);
        const newCostPerUnit = addedOnHand > 0 ? netTotalPrice / addedOnHand : 0;
        const combinedOnHand = this.originalOnHand + addedOnHand;

        if (addedOnHand > 0 && combinedOnHand > 0) {
          this.product.Cost = ((this.originalCost * this.originalOnHand) + (newCostPerUnit * addedOnHand)) / combinedOnHand;
        } else if (addedOnHand > 0) {
          this.product.Cost = newCostPerUnit || this.originalCost;
        } else {
          this.product.Cost = this.originalCost;
        }
      } else {
        // SIMPLE MODE (direct division) (matching cost.service.ts line 91-100)
        if (totalUnits > 0) {
          this.product.Cost = (totalPrice / totalUnits) * conversionValue || 0;
          if (discountOnTotal > 0) {
            this.product.Cost = ((totalPrice - discountOnTotal) / totalUnits) * conversionValue || 0;
          }
          if (discountOnMaster > 0) {
            this.product.Cost = ((totalPrice - (discountOnMaster * totalUnits)) / totalUnits) * conversionValue || 0;
          }
        } else {
          this.product.Cost = 0;
        }
      }

      // Update OnHand (matching cost.service.ts line 102-103)
      this.product.OnHand = (this.originalOnHand + addedOnHand) || 0;

      // Update BasePrice: skip if invoice auto-filled (KeepBasePrice flag), otherwise calculate
      if (!this.product.KeepBasePrice) {
        this.product.BasePrice = Math.round((this.originalBasePrice + (this.product.Cost - this.originalCost)) / 100) * 100;
      }

      console.log(`Result [${mode}]: Cost=${this.originalCost}→${this.product.Cost} BasePrice=${this.originalBasePrice}→${this.product.BasePrice} OnHand=${this.originalOnHand}→${this.product.OnHand} KeepBasePrice=${!!this.product.KeepBasePrice}`);
      console.groupEnd();

      this.product.Edited = true;

      // Update all children based on master changes
      this.updateChildrenByCost();

      // Save to localStorage using product Id (and Code fallback)
      this.saveToLocalStorage();

      this.emitProductChange();

      // Manually update input fields to reflect new values
      this.updateInputFields();
    }
  }

  /**
   * Save edited product to localStorage using product Id (and Code fallback)
   */
  private saveToLocalStorage() {
    try {
      const payload = { ...this.product };
      // Strip runtime-only _original* properties to prevent cross-session contamination
      // These are recalculated fresh each session from IndexedDB values
      delete (payload as any)._originalOnHand;
      delete (payload as any)._originalCost;
      delete (payload as any)._originalBasePrice;
      delete (payload as any)._derivedOriginalOnHand;
      const keyById = this.product.Id ? `editing_childProduct_${this.product.Id}` : null;
      const keyByCode = this.product.Code ? `editing_childProduct_${this.product.Code}` : null;

      if (keyById) {
        localStorage.setItem(keyById, JSON.stringify(payload));
      }

      // Also write by Code to help recovery when Id is missing or Code changed
      if (keyByCode) {
        localStorage.setItem(keyByCode, JSON.stringify(payload));
      }
    } catch (err) {
      console.error('Failed to save product to localStorage:', err);
    }
  }

  /**
   * Update all children units based on master's cost change
   * Using ConversionValue to calculate proportional prices
   * Matches cost.service.ts updateCostChildItems logic
   */
  private updateChildrenByCost() {
    if (!this.childProducts || this.childProducts.length === 0) return;

    const isClone = (this.product as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';

    const masterCost = this.product.Cost;
    const masterConversion = this.parseNumber(this.product.ConversionValue) || 1;
    const masterOnHand = this.product.OnHand;
    const masterDiscount = this.parseNumber(this.product.Discount) || 0;

    console.group(`${tag} [updateChildrenByCost] Master: ${this.product.Code} "${this.product.Name}" | Cost=${masterCost} OnHand=${masterOnHand} Conv=${masterConversion} Discount=${masterDiscount}`);

    // Get original products from grouped_* localStorage
    const oldProducts = Object.entries(localStorage)
      .filter(([key]) => key.startsWith('grouped_'))
      .map(([_, value]) => JSON.parse(value || '[]'));

    // Create new array to trigger Angular change detection
    this.childProducts = this.childProducts.map(child => {
      const childConversion = this.parseNumber(child.ConversionValue) || 1;

      // Find original child product for BasePrice calculation
      let originalChildBasePrice = child.BasePrice;
      let originalChildCost = child.Cost;

      oldProducts.forEach((oP) => {
        const productGroup = oP[this.product.Code];
        if (productGroup) {
          const matchingProduct = productGroup.find((o: any) => o.Code === child.Code);
          if (matchingProduct) {
            originalChildBasePrice = matchingProduct.BasePrice;
            originalChildCost = matchingProduct.Cost;
          }
        }
      });

      // FIX: Use delta-based OnHand calculation instead of total conversion
      // Save child's originals if not saved yet (all three to keep consistency)
      if ((child as any)._originalOnHand === undefined) {
        (child as any)._originalOnHand = child.OnHand;
        (child as any)._originalCost = child.Cost;
        (child as any)._originalBasePrice = child.BasePrice;
      }
      const childOriginalOnHand = this.parseNumber((child as any)._originalOnHand);
      const masterAddedOnHand = masterOnHand - this.originalOnHand;
      const childAddedOnHand = (masterAddedOnHand * masterConversion) / childConversion;
      child.OnHand = childOriginalOnHand + childAddedOnHand;

      // Calculate cost proportionally: (masterCost / masterConversion) * childConversion
      const oldChildCost = child.Cost;
      child.Cost = Math.round((masterCost / masterConversion) * childConversion) || 0;

      // Apply discount if exists
      if (masterDiscount > 0) {
        child.Cost = (child.Cost - (masterDiscount * childConversion)) || 0;
      }

      // Update BasePrice based on cost change from original (skip if manually set)
      const oldChildBasePrice = child.BasePrice;
      if (!child.KeepBasePrice) {
        child.BasePrice = Math.round((originalChildBasePrice + (child.Cost - originalChildCost)) / 100) * 100 || 0;
      }

      console.log(`  Child: ${child.Code} "${child.Name}" (${child.Unit}) Conv=${childConversion} | OnHand: ${childOriginalOnHand}+${childAddedOnHand}=${child.OnHand} | Cost: ${oldChildCost}→${child.Cost} (origCost=${originalChildCost}) | BasePrice: ${oldChildBasePrice}→${child.BasePrice} (origBP=${originalChildBasePrice}) KeepBP=${!!child.KeepBasePrice}`);

      child.Edited = true;

      // Save child to localStorage using Id (and Code fallback)
      // Strip runtime-only _original* properties
      try {
        const childPayload = { ...child };
        delete (childPayload as any)._originalOnHand;
        delete (childPayload as any)._originalCost;
        delete (childPayload as any)._originalBasePrice;
        delete (childPayload as any)._derivedOriginalOnHand;
        if (child.Id) {
          localStorage.setItem(`editing_childProduct_${child.Id}`, JSON.stringify(childPayload));
        }
        if (child.Code) {
          localStorage.setItem(`editing_childProduct_${child.Code}`, JSON.stringify(childPayload));
        }
      } catch (err) {
        console.error('Failed to save child to localStorage:', err);
      }

      return child; // Return the modified child for map
    });

    console.groupEnd();
    this.emitChildrenChange();
  }

  /**
   * Update only OnHand of children when Box/Retail changes without TotalPrice
   * This does NOT change Cost or BasePrice of children
   *
   * FIX: Use delta-based calculation instead of total conversion.
   * Old: child.OnHand = (masterTotal * masterConv) / childConv → wrong when child has independent OnHand
   * New: childAdded = (masterAdded * masterConv) / childConv; child.OnHand = childOriginal + childAdded
   */
  private updateChildrenOnHandOnly() {
    if (!this.childProducts || this.childProducts.length === 0) return;

    const isClone = (this.product as any)?.isClone;
    const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';

    const masterConversion = this.parseNumber(this.product.ConversionValue) || 1;
    const masterAddedOnHand = this.product.OnHand - this.originalOnHand;

    console.group(`${tag} [updateChildrenOnHandOnly] Master: ${this.product.Code} "${this.product.Name}" | masterOnHand=${this.product.OnHand} origOnHand=${this.originalOnHand} masterAdded=${masterAddedOnHand} Conv=${masterConversion}`);

    // Create new array to trigger Angular change detection
    this.childProducts = this.childProducts.map(child => {
      const childConversion = this.parseNumber(child.ConversionValue) || 1;

      // Save child's originals if not saved yet (all three to keep consistency)
      if ((child as any)._originalOnHand === undefined) {
        (child as any)._originalOnHand = child.OnHand;
        (child as any)._originalCost = child.Cost;
        (child as any)._originalBasePrice = child.BasePrice;
      }
      const childOriginalOnHand = this.parseNumber((child as any)._originalOnHand);

      // Calculate added amount proportionally and add to child's original
      const childAddedOnHand = (masterAddedOnHand * masterConversion) / childConversion;
      child.OnHand = childOriginalOnHand + childAddedOnHand;

      console.log(`  Child: ${child.Code} "${child.Name}" (${child.Unit}) Conv=${childConversion} | OnHand: ${childOriginalOnHand} + ${childAddedOnHand} = ${child.OnHand}`);

      child.Edited = true;

      // Save child to localStorage - strip runtime-only _original* properties
      try {
        const childPayload = { ...child };
        delete (childPayload as any)._originalOnHand;
        delete (childPayload as any)._originalCost;
        delete (childPayload as any)._originalBasePrice;
        delete (childPayload as any)._derivedOriginalOnHand;
        if (child.Id) {
          localStorage.setItem(`editing_childProduct_${child.Id}`, JSON.stringify(childPayload));
        }
        if (child.Code) {
          localStorage.setItem(`editing_childProduct_${child.Code}`, JSON.stringify(childPayload));
        }
      } catch (err) {
        console.error('Failed to save child to localStorage:', err);
      }

      return child;
    });

    console.groupEnd();
    this.emitChildrenChange();
  }

  onChildEdit(editedChild: EditedProduct) {
    // When a child is edited, just update it in the list
    // Child edits no longer affect master or siblings
    const childIndex = this.childProducts.findIndex(c => c.Id === editedChild.Id);
    if (childIndex >= 0) {
      this.childProducts[childIndex] = editedChild;

      // Save child to localStorage - strip runtime-only _original* properties
      try {
        const childPayload = { ...editedChild };
        delete (childPayload as any)._originalOnHand;
        delete (childPayload as any)._originalCost;
        delete (childPayload as any)._originalBasePrice;
        delete (childPayload as any)._derivedOriginalOnHand;
        if (editedChild.Id) {
          localStorage.setItem(`editing_childProduct_${editedChild.Id}`, JSON.stringify(childPayload));
        }
        if (editedChild.Code) {
          localStorage.setItem(`editing_childProduct_${editedChild.Code}`, JSON.stringify(childPayload));
        }
      } catch (err) {
        console.error('Failed to save editedChild to localStorage:', err);
      }

      this.emitChildrenChange();
    }
  }

  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '';
    return Math.round(num).toLocaleString('en-US');
  }

  validateNumber(event: KeyboardEvent) {
    validateNumber(event);
  }

  /**
   * Get BasePrice difference from original
   */
  getBasePriceDiff(): number {
    return this.product.BasePrice - this.originalBasePrice;
  }

  /**
   * Get Cost difference from original
   */
  getCostDiff(): number {
    return this.product.Cost - this.originalCost;
  }

  /**
   * Get OnHand difference from original
   */
  getOnHandDiff(): number {
    return this.product.OnHand - this.originalOnHand;
  }

  /**
   * Check if value increased
   */
  isIncrease(diff: number): boolean {
    return diff > 0;
  }

  /**
   * Check if value decreased
   */
  isDecrease(diff: number): boolean {
    return diff < 0;
  }

  /**
   * Check if value unchanged
   */
  isUnchanged(diff: number): boolean {
    return diff === 0;
  }

  private emitProductChange() {
    this.productChange.emit(this.product);
  }

  private emitChildrenChange() {
    this.childrenChange.emit(this.childProducts);
  }

  /**
   * Handle show info button click - open dialog showing all fields of the
   * master product (MasterUnit only). Works for both Original and Clone.
   */
  onShowInfoClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    const dialogRef = this.dialog.open(ProductInfoDialogComponent, {
      width: '600px',
      maxHeight: '85vh',
      data: { product: this.product }
    });

    dialogRef.afterClosed().subscribe(() => {
      this.isDialogOpen = false;
    });
  }

  onDeleteClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    const dialogRef = this.dialog.open(DeleteConfirmDialogComponent, {
      width: '420px',
      data: {
        productCode: this.product.Code || '',
        productName: this.product.Name || this.product.FullName || ''
      },
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(confirmed => {
      this.isDialogOpen = false;

      if (confirmed) {
        // Emit delete event to parent component
        this.deleteProduct.emit({
          product: this.product,
          childProducts: this.childProducts
        });
      }
    });
  }

  /**
   * Handle save clone button click - emit save event to parent
   */
  onSaveCloneClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.saveCloneClick.emit();
  }

  /**
   * Handle print barcode button click - open barcode label print window.
   * Renders a barcode label (Name + barcode + price) via JsBarcode and prints.
   */
  onPrintBarcodeClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    this.printBarcode();
  }

  private printBarcode(): void {
    const code = (this.product.Code || '').toString();
    const name = (this.product.Name || this.product.FullName || '').toString();
    const price = this.formatNumber(this.product.BasePrice || 0);

    // Số lượng in mặc định = tồn kho (giống KiotViet "Số lượng in")
    const stock = this.parseNumber((this.product as any).OnHand) || this.parseNumber((this.product as any).OnHandNV) || 1;
    const input = window.prompt('Số lượng tem cần in:', String(Math.max(1, Math.round(stock))));
    if (input === null) return; // user huỷ
    let copies = parseInt(input, 10);
    if (!Number.isFinite(copies) || copies < 1) copies = 1;
    if (copies > 5000) copies = 5000; // giới hạn như KiotViet

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) return;

    const safe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // 2 tem/hàng, khổ 72x22mm mỗi tem (mẫu giấy cuộn 2 nhãn - PrintSize "Base2Label" của KiotViet)
    let cells = '';
    for (let i = 0; i < copies; i++) {
      cells += `<div class="label"><div class="name">${safe(name)}</div><svg class="barcode"></svg><div class="price">${price} VND</div></div>`;
    }

    printWindow.document.write(`
    <html>
      <head>
        <title>In tem mã - ${safe(code)}</title>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
        <style>
          @page { size: 72mm 22mm; margin: 0; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
          .sheet { display: flex; flex-wrap: wrap; width: 72mm; }
          .label {
            width: 36mm; height: 22mm; padding: 1mm 1.5mm;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            overflow: hidden; page-break-inside: avoid;
          }
          .name { font-size: 8pt; font-weight: 600; line-height: 1.1; width: 100%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .barcode { width: 100%; height: 9mm; }
          .price { font-size: 9pt; font-weight: 700; }
        </style>
      </head>
      <body>
        <div class="sheet">${cells}</div>
        <script>
          window.onload = function () {
            try {
              document.querySelectorAll('.barcode').forEach(function (el) {
                JsBarcode(el, ${JSON.stringify(code)}, { format: "CODE128", width: 1, displayValue: true, fontSize: 11, height: 28, margin: 0, textMargin: 0 });
              });
            } catch (e) {}
            setTimeout(function () { window.print(); window.close(); }, 500);
          };
        </script>
      </body>
    </html>
    `);

    printWindow.document.close();
  }

  /**
   * Handle edit button click - open edit dialog
   */
  onEditClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    const dialogRef = this.dialog.open(EditProductDialogComponent, {
      width: '800px',
      maxHeight: '90vh',
      data: {
        product: this.product,
        childProducts: this.childProducts
      },
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(result => {
      this.isDialogOpen = false;

      if (result && result.saved) {
        // Update local product data from result
        if (result.products && result.products.length > 0) {
          const masterUpdate = result.products.find((p: any) => p.Id === this.product.Id);
          if (masterUpdate) {
            // Update master product properties
            this.product.Code = masterUpdate.Code;
            this.product.Name = masterUpdate.Name;
            this.product.FullName = masterUpdate.FullName || masterUpdate.Name;
            this.product.Description = masterUpdate.Description;
            this.product.OrderTemplate = masterUpdate.OrderTemplate;
            this.product.CategoryId = masterUpdate.CategoryId;
            this.product.TradeMarkId = masterUpdate.TradeMarkId;
            this.product.TradeMarkName = masterUpdate.TradeMarkName;
            this.product.Cost = masterUpdate.Cost;
            this.product.BasePrice = masterUpdate.BasePrice;
            this.product.OnHandNV = masterUpdate.OnHandNV;
            this.product.Image = masterUpdate.Image;
            this.product.Edited = true;

            this.emitProductChange();
          }

          // Update child products
          for (const childUpdate of result.products) {
            if (childUpdate.Id === this.product.Id) continue;

            const childIndex = this.childProducts.findIndex(c => c.Id === childUpdate.Id);
            if (childIndex >= 0) {
              this.childProducts[childIndex].BasePrice = childUpdate.BasePrice;
              this.childProducts[childIndex].Cost = childUpdate.Cost;
              this.childProducts[childIndex].OnHandNV = childUpdate.OnHandNV;
              this.childProducts[childIndex].OrderTemplate = childUpdate.OrderTemplate;
              this.childProducts[childIndex].Description = childUpdate.Description;
              this.childProducts[childIndex].Edited = true;
            }
          }

          this.emitChildrenChange();
        }

        // Emit edit event to parent component
        this.editProduct.emit({
          product: this.product,
          childProducts: this.childProducts,
          updatedProducts: result.products
        });
      }
    });
  }

  /**
   * Handle history button click - open history dialog
   * Only shown for clone products
   */
  onHistoryClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    const dialogRef = this.dialog.open(ProductHistoryDialogComponent, {
      width: '600px',
      maxHeight: '80vh',
      data: {
        productId: this.product.Id,
        productCode: this.product.Code,
        productName: this.product.Name
      },
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(() => {
      this.isDialogOpen = false;
    });
  }

  /**
   * Chuẩn nhận diện clone của dự án: isClone===true OR (OnHandNV>0 && OnHand===0)
   * OR KiotVietSync===false. Chỉ đọc mỗi `isClone` sẽ bỏ sót clone cũ thiếu field,
   * guard tưởng chưa có clone và tạo thêm một bộ đơn vị trùng.
   */
  private isCloneRecord(p: any): boolean {
    if (p?.isClone === true) return true;
    if (typeof p?.isClone === 'string' && p.isClone.toLowerCase() === 'true') return true;
    if (p?.KiotVietSync === false) return true;
    const onHandNV = Number(p?.OnHandNV) || 0;
    const onHand = Number(p?.OnHand) || 0;
    return onHandNV > 0 && onHand === 0;
  }

  /**
   * Clone có thuộc SP gốc đang thao tác không. Khớp BẤT KỲ khóa nào cũng tính là "đã có
   * clone" — thà nhận dư còn hơn tạo trùng: clone giữ nguyên Code của bản gốc nên Code
   * là khóa cuối cùng bám được khi CloneSourceId/CloneMasterSourceId bị thiếu.
   */
  private cloneBelongsToProduct(p: any, originalIds: Set<string>, originalCodes: Set<string>): boolean {
    if (p?.CloneSourceId && originalIds.has(String(p.CloneSourceId))) return true;
    if (p?.CloneMasterSourceId && String(p.CloneMasterSourceId) === String(this.product.Id)) return true;
    return !!p?.Code && originalCodes.has(p.Code);
  }

  /**
   * Handle clone button click - open clone dialog
   * Only shown for non-clone products (original KiotViet products)
   * Lấy danh sách existingClones từ IndexedDB để tránh tạo duplicate
   */
  async onCloneClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (this.isDialogOpen) {
      return;
    }

    this.isDialogOpen = true;

    try {
      // Lấy tất cả products từ IndexedDB để tìm existing clones
      const allProducts = await this.productService.getAllProductsFromIndexedDB();

      // Collect all original product IDs (master + children) for lookup
      const originalProductIds = new Set<string>();
      originalProductIds.add(String(this.product.Id));
      this.childProducts?.forEach(c => originalProductIds.add(String(c.Id)));

      // Tìm các clone đã tồn tại cho product này và các children.
      // Clone cũ có thể thiếu CloneSourceId / CloneMasterSourceId / isClone, nên phải
      // dò theo NHIỀU khóa — guard rỗng là nguyên nhân sinh ra bộ clone thứ 2 trùng đơn vị.
      const originalCodes = new Set<string>();
      if (this.product.Code) originalCodes.add(this.product.Code);
      this.childProducts?.forEach(c => { if (c.Code) originalCodes.add(c.Code); });

      const existingClones = allProducts.filter((p: any) =>
        this.isCloneRecord(p) && this.cloneBelongsToProduct(p, originalProductIds, originalCodes)
      );

      // Master clone: CloneSourceId trỏ về master gốc, hoặc (clone legacy) Code trùng master.
      const masterCloneExists = existingClones.some((c: any) =>
        String(c.CloneSourceId) === String(this.product.Id) || c.Code === this.product.Code
      );

      // KHÔNG xóa clone "lạ" khỏi IndexedDB nữa: xóa local không xóa Firestore, lần sync
      // sau nó quay lại và trong lúc đó guard tưởng chưa có clone → tạo trùng bộ mới.
      // Cũng KHÔNG clear danh sách khi thiếu master clone: giữ child cũ để không nhân đôi child.
      if (existingClones.length > 0 && !masterCloneExists) {
        console.warn(`⚠️ [onCloneClick] Có ${existingClones.length} child clone nhưng thiếu master clone — chỉ tạo bù master, giữ nguyên child cũ.`);
      }

      console.log(`📋 Found ${existingClones.length} valid existing clones for product ${this.product.Id}`);
      console.log(`📋 [onCloneClick] Original product IDs:`, Array.from(originalProductIds));
      console.log(`📋 [onCloneClick] Master product:`, this.product.Id, this.product.Code, this.product.Name);
      console.log(`📋 [onCloneClick] Child products count:`, this.childProducts?.length || 0);
      console.log(`📋 [onCloneClick] Child products:`, this.childProducts?.map(c => ({ Id: c.Id, Code: c.Code, Unit: c.Unit })));
      if (existingClones.length > 0) {
        console.log(`📋 [onCloneClick] Existing clones:`, existingClones.map((c: any) => ({
          Id: c.Id,
          CloneSourceId: c.CloneSourceId,
          Code: c.Code,
          OnHandNV: c.OnHandNV
        })));
      }

      const dialogRef = this.dialog.open(CloneProductDialogComponent, {
        width: '600px',
        maxHeight: '90vh',
        data: {
          product: this.product,
          childProducts: this.childProducts,
          existingClones: existingClones  // Truyền danh sách clone đã tồn tại
        },
        disableClose: false
      });

      dialogRef.afterClosed().subscribe(result => {
        this.isDialogOpen = false;

        if (result && result.saved) {
          console.log('✅ Clone products created:', result.products?.length || 0);

          // Emit clone event to parent component
          this.cloneProduct.emit({
            product: this.product,
            childProducts: this.childProducts,
            clonedProducts: result.products || []
          });
        }
      });
    } catch (error) {
      console.error('❌ Error loading existing clones:', error);
      this.isDialogOpen = false;
    }
  }

  /**
   * Handle sync button click - sync single product from KiotViet
   * Only shown for non-clone products (original KiotViet products)
   */
  async onSyncClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();

    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;

    try {
      const isClone = (this.product as any)?.isClone;
      const tag = isClone ? '🟣 CLONE' : '🔵 ORIGINAL';
      console.group(`${tag} [onSyncClick] Syncing: ${this.product.Code} "${this.product.Name}" (Id=${this.product.Id})`);
      console.log(`Before sync: Cost=${this.product.Cost} BasePrice=${this.product.BasePrice} OnHand=${this.product.OnHand} Name="${this.product.Name}" FullName="${this.product.FullName}"`);

      const result = await this.productService.syncSingleProductFromKiotViet(this.product.Id, this.product.Code);

      if (result.success) {
        console.log(`Sync API returned ${result.syncedCount} products`);

        // Update local product data from synced result
        if (result.products && result.products.length > 0) {
          const masterUpdate = result.products.find((p: any) =>
            p.Id === this.product.Id || p.Code === this.product.Code
          );

          if (masterUpdate) {
            console.log(`Master from API: Name="${masterUpdate.Name}" NameOriginal="${(masterUpdate as any).NameOriginal}" FullName="${masterUpdate.FullName}" Cost=${masterUpdate.Cost} BasePrice=${masterUpdate.BasePrice} OnHand=${masterUpdate.OnHand}`);

            // Update master product properties
            // Use NameOriginal from KiotViet API (e.g., "Test") instead of Name (e.g., "Test - Cam (chai)")
            this.product.Name = masterUpdate.NameOriginal || masterUpdate.Name;
            this.product.FullName = masterUpdate.FullName || masterUpdate.Name;
            this.product.Unit = masterUpdate.Unit || this.product.Unit;
            this.product.Cost = masterUpdate.Cost;
            this.product.BasePrice = masterUpdate.BasePrice;
            this.product.OnHand = masterUpdate.OnHand;
            this.product.Image = masterUpdate.Image;
            this.product.OrderTemplate = masterUpdate.OrderTemplate;
            // Update Tax from KiotViet (tax_id/tax_name/tax_text → Tax value)
            if ((masterUpdate as any).Tax !== undefined) {
              (this.product as any).Tax = (masterUpdate as any).Tax;
            }

            console.log(`Master after update: Name="${this.product.Name}" FullName="${this.product.FullName}" Cost=${this.product.Cost} BasePrice=${this.product.BasePrice} OnHand=${this.product.OnHand}`);

            // Update original values for calculations
            this.originalBasePrice = masterUpdate.BasePrice;
            this.originalCost = masterUpdate.Cost;
            this.originalOnHand = masterUpdate.OnHand;

            // Also update saved originals on product object (sync resets the baseline)
            (this.product as any)._originalBasePrice = this.originalBasePrice;
            (this.product as any)._originalCost = this.originalCost;
            (this.product as any)._originalOnHand = this.originalOnHand;

            // Clear localStorage edit so synced data isn't overwritten by stale cache
            try { localStorage.removeItem(`editing_childProduct_${this.product.Id}`); } catch(e) {}

            this.emitProductChange();
          }

          // Update child products from API results first
          const updatedChildIds = new Set<number>();
          for (const childUpdate of result.products) {
            if (childUpdate.Id === this.product.Id) continue;

            const childIndex = this.childProducts.findIndex(c =>
              c.Id === childUpdate.Id || c.Code === childUpdate.Code
            );
            if (childIndex >= 0) {
              const oldName = this.childProducts[childIndex].Name;
              // Use NameOriginal from KiotViet API if available
              this.childProducts[childIndex].Name = childUpdate.NameOriginal || childUpdate.Name;
              this.childProducts[childIndex].FullName = childUpdate.FullName;
              this.childProducts[childIndex].Unit = childUpdate.Unit || this.childProducts[childIndex].Unit;
              this.childProducts[childIndex].BasePrice = childUpdate.BasePrice;
              this.childProducts[childIndex].Cost = childUpdate.Cost;
              this.childProducts[childIndex].OnHand = childUpdate.OnHand;
              this.childProducts[childIndex].OrderTemplate = childUpdate.OrderTemplate;
              if ((childUpdate as any).Tax !== undefined) {
                (this.childProducts[childIndex] as any).Tax = (childUpdate as any).Tax;
              }
              updatedChildIds.add(this.childProducts[childIndex].Id);
              console.log(`  Child (API): ${childUpdate.Code} Name="${oldName}"→"${this.childProducts[childIndex].Name}" NameOriginal="${(childUpdate as any).NameOriginal}" Cost=${childUpdate.Cost} BasePrice=${childUpdate.BasePrice} OnHand=${childUpdate.OnHand}`);
              // Clear localStorage edit so synced data isn't overwritten by stale cache
              try { localStorage.removeItem(`editing_childProduct_${this.childProducts[childIndex].Id}`); } catch(e) {}
            }
          }

          // For child units NOT returned by API, compute values proportionally from master
          const masterConversion = this.parseNumber(this.product.ConversionValue) || 1;
          const masterOnHand = this.product.OnHand;
          const masterCost = this.product.Cost;
          const masterBasePrice = this.product.BasePrice;
          const masterTax = (this.product as any).Tax;

          for (const child of this.childProducts) {
            if (updatedChildIds.has(child.Id)) continue;
            // All units share the same tax → inherit from master
            if (masterTax !== undefined) (child as any).Tax = masterTax;

            const childConversion = this.parseNumber(child.ConversionValue) || 1;
            // OnHand proportional: for sync, master's OnHand IS the new total from KiotViet
            // Convert master total to child units (sync resets the baseline)
            child.OnHand = (masterOnHand * masterConversion) / childConversion || 0;
            // Cost proportional
            const oldChildCost = child.Cost;
            const oldChildBasePrice = child.BasePrice;
            child.Cost = Math.round((masterCost / masterConversion) * childConversion) || 0;
            // BasePrice: if cost changed, adjust price by cost difference; if unchanged, keep old price
            const costDiff = child.Cost - oldChildCost;
            if (costDiff !== 0 && !child.KeepBasePrice) {
              child.BasePrice = Math.round((oldChildBasePrice + costDiff) / 100) * 100 || 0;
            }
            // If costDiff === 0 or KeepBasePrice, keep old BasePrice (no change needed)

            console.log(`  Child (computed): ${child.Code} "${child.Name}" (${child.Unit}) Conv=${childConversion} | OnHand=${child.OnHand} Cost=${oldChildCost}→${child.Cost} BasePrice=${oldChildBasePrice}→${child.BasePrice} (costDiff=${costDiff})`);
          }

          // CRITICAL: Reset _originalOnHand/_originalCost/_originalBasePrice on ALL children
          // after sync. Without this, delta-based calculations (updateChildrenOnHandOnly,
          // updateChildrenByCost) will use stale pre-sync originals.
          for (const child of this.childProducts) {
            (child as any)._originalOnHand = child.OnHand;
            (child as any)._originalCost = child.Cost;
            (child as any)._originalBasePrice = child.BasePrice;
            console.log(`  Child (reset originals): ${child.Code} (${child.Unit}) _origOnHand=${child.OnHand} _origCost=${child.Cost} _origBasePrice=${child.BasePrice}`);
          }

          // Create new array reference to trigger Angular change detection in child-units-list
          this.childProducts = [...this.childProducts];
          this.emitChildrenChange();
        }

        // Emit sync event to parent component
        this.syncProduct.emit({
          product: this.product,
          childProducts: this.childProducts,
          syncedProducts: result.products
        });

        // Update input fields to reflect new values
        this.updateInputFields();
        this.cdr.detectChanges();

        console.log(`Sync complete: ${result.message}`);
        console.groupEnd();
      } else {
        console.error(`Sync failed: ${result.message}`);
        console.groupEnd();
        alert(`Lỗi đồng bộ: ${result.message}`);
      }
    } catch (error: any) {
      console.error('❌ Error syncing product:', error);
      console.groupEnd();
      alert(`Lỗi đồng bộ: ${error.message || 'Unknown error'}`);
    } finally {
      this.isSyncing = false;
      this.cdr.detectChanges();
    }
  }
}