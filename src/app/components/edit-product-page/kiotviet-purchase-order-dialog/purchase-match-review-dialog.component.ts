import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { KiotVietPurchaseOrderService } from '../../../services/kiotviet-purchase-order.service';
import { KiotVietPurchaseProduct } from '../../../services/kiotviet.service';
import { log, logError } from '../../../utils/log.util';

/** 1 dòng hóa đơn cần user xác nhận sản phẩm KiotViet */
export interface PurchaseMatchReviewItem {
  lineIndex: number;
  description: string;                     // Tên hàng trên XML
  invoiceUnit: string;
  candidates: KiotVietPurchaseProduct[];   // Gợi ý từ KiotViet autocomplete
  selectedIdx: number;                     // -1 = bỏ qua dòng này
}

/** lineIndex → SP đã chọn (null = user bỏ qua) */
export type PurchaseMatchReviewResult = Map<number, KiotVietPurchaseProduct | null>;

@Component({
  selector: 'purchase-match-review-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatButtonModule,
    MatSelectModule, MatFormFieldModule, MatIconModule, MatAutocompleteModule
  ],
  template: `
    <div class="pmr-header">
      <div class="pmr-title">
        <mat-icon>fact_check</mat-icon>
        <div>
          <h2>Xác nhận sản phẩm KiotViet</h2>
          <span class="pmr-subtitle">{{ items.length }} mục cần kiểm tra — chọn đúng sản phẩm trên KiotViet cho từng dòng hóa đơn</span>
        </div>
      </div>
      <button mat-icon-button mat-dialog-close class="pmr-close"><mat-icon>close</mat-icon></button>
    </div>

    <mat-dialog-content class="pmr-content">
      <div class="pmr-item" *ngFor="let item of items; let i = index"
           [class.pmr-item--skip]="item.selectedIdx < 0">
        <!-- Dòng hóa đơn XML -->
        <div class="pmr-invoice">
          <span class="pmr-index">{{ i + 1 }}</span>
          <div class="pmr-invoice-body">
            <div class="pmr-label">Tên trên hóa đơn</div>
            <div class="pmr-invoice-name">
              {{ item.description }}
              <span class="pmr-unit-chip" *ngIf="item.invoiceUnit">{{ item.invoiceUnit }}</span>
            </div>
          </div>
          <span class="pmr-status" [ngClass]="statusClass(item)">
            <mat-icon>{{ statusIcon(item) }}</mat-icon>
            {{ statusLabel(item) }}
          </span>
        </div>

        <!-- Chọn sản phẩm KiotViet -->
        <div class="pmr-label pmr-label--pick">Sản phẩm KiotViet</div>
        <mat-form-field appearance="outline" class="pmr-select">
          <mat-select [(ngModel)]="item.selectedIdx" panelClass="pmr-select-panel">
            <mat-option [value]="-1">
              <span class="pmr-skip-opt">
                <mat-icon>block</mat-icon> Bỏ qua dòng này (không nhập)
              </span>
            </mat-option>
            <mat-option *ngFor="let c of item.candidates; let j = index" [value]="j">
              <span class="pmr-opt">
                <span class="pmr-opt-code">{{ c.Code }}</span>
                <span class="pmr-opt-name">{{ c.Name }}</span>
                <span class="pmr-unit-tag" [class.pmr-unit-tag--ok]="unitOf(c) === invoiceUnitNorm(item)">{{ c.Unit }}</span>
                <span class="pmr-score" [ngClass]="scoreClass(scoreOf(item, c))">{{ scoreOf(item, c) }}%</span>
              </span>
            </mat-option>
          </mat-select>
        </mat-form-field>

        <div class="pmr-unit-warn" *ngIf="unitMismatch(item)">
          <mat-icon>swap_horiz</mat-icon>
          Đơn vị đang chọn <b>{{ selectedUnit(item) }}</b> khác ĐVT hóa đơn <b>{{ item.invoiceUnit }}</b> — kiểm tra lại!
        </div>

        <!-- Tìm SP thủ công trên KiotViet -->
        <div class="pmr-search">
          <mat-icon class="pmr-search-icon">search</mat-icon>
          <input type="text"
                 placeholder="Không thấy? Gõ mã/tên rồi Enter để tìm trên KiotViet..."
                 [(ngModel)]="searchTexts[i]"
                 (keyup.enter)="searchProduct(i)"
                 [matAutocomplete]="auto">
          <mat-autocomplete #auto="matAutocomplete"
                            (optionSelected)="selectSearchResult(i, item, $event.option.value)">
            <mat-option *ngFor="let sr of searchResults[i]" [value]="sr" class="pmr-sr-opt">
              <span class="pmr-opt-code">{{ sr.Code }}</span> {{ sr.Name }}
            </mat-option>
          </mat-autocomplete>
        </div>
        <div class="pmr-search-hint" *ngIf="searching[i]">Đang tìm trên KiotViet...</div>
        <div class="pmr-search-hint pmr-search-hint--empty"
             *ngIf="!searching[i] && searched[i] && !searchResults[i].length">
          Không tìm thấy sản phẩm phù hợp
        </div>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions class="pmr-actions">
      <div class="pmr-summary">
        <span class="pmr-summary-ok"><mat-icon>check_circle</mat-icon> {{ chosenCount }} đã chọn</span>
        <span class="pmr-summary-skip" *ngIf="skipCount > 0"><mat-icon>block</mat-icon> {{ skipCount }} bỏ qua</span>
      </div>
      <span class="pmr-spacer"></span>
      <button mat-stroked-button mat-dialog-close>Hủy</button>
      <button mat-raised-button color="primary" (click)="confirm()">
        <mat-icon>done_all</mat-icon> Xác nhận
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }

    .pmr-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; padding: 16px 20px 12px;
      background: linear-gradient(135deg, #0288d1, #01579b);
      color: #fff;
    }
    .pmr-title { display: flex; gap: 12px; align-items: flex-start; }
    .pmr-title > mat-icon { font-size: 28px; width: 28px; height: 28px; margin-top: 2px; }
    .pmr-title h2 { margin: 0; font-size: 18px; font-weight: 600; }
    .pmr-subtitle { font-size: 12px; opacity: .9; }
    .pmr-close { color: #fff; }

    .pmr-content { padding: 12px 20px 4px; max-height: 62vh; }
    @media (min-width: 600px) { .pmr-content { min-width: 540px; } }

    .pmr-item {
      border: 1px solid #e3eaf0; border-radius: 10px;
      padding: 12px 14px; margin-bottom: 12px; background: #fbfdff;
      transition: border-color .2s, background .2s;
    }
    .pmr-item--skip { background: #fff6f6; border-color: #f3caca; opacity: .85; }

    .pmr-invoice { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .pmr-index {
      flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
      background: #0288d1; color: #fff; font-size: 13px; font-weight: 600;
      display: flex; align-items: center; justify-content: center;
    }
    .pmr-invoice-body { flex: 1; min-width: 0; }
    .pmr-label { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; color: #90a4ae; font-weight: 600; }
    .pmr-label--pick { margin: 2px 0 2px; }
    .pmr-invoice-name { font-size: 14px; font-weight: 600; color: #263238; word-break: break-word; }
    .pmr-unit-chip {
      display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 10px;
      background: #e1f5fe; color: #0277bd; font-size: 11px; font-weight: 500; vertical-align: middle;
    }

    .pmr-status {
      flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px;
      padding: 3px 9px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .pmr-status mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .pmr-status--ok { background: #e8f5e9; color: #2e7d32; }
    .pmr-status--warn { background: #fff3e0; color: #e65100; }
    .pmr-status--none { background: #ffebee; color: #c62828; }

    .pmr-select { width: 100%; font-size: 13px; }
    .pmr-select ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    .pmr-opt { display: flex; align-items: center; gap: 8px; width: 100%; }
    .pmr-opt-code {
      flex: 0 0 auto; font-family: monospace; font-size: 12px; color: #1565c0;
      background: #e3f2fd; padding: 1px 6px; border-radius: 4px;
    }
    .pmr-opt-name { flex: 1; overflow: hidden; text-overflow: ellipsis; }
    .pmr-score {
      flex: 0 0 auto; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 10px;
    }
    .pmr-score--high { background: #e8f5e9; color: #2e7d32; }
    .pmr-score--mid { background: #fff3e0; color: #e65100; }
    .pmr-score--low { background: #ffebee; color: #c62828; }
    .pmr-unit-tag {
      flex: 0 0 auto; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 10px;
      background: #eceff1; color: #607d8b;
    }
    .pmr-unit-tag--ok { background: #e0f2f1; color: #00796b; }
    .pmr-skip-opt, .pmr-sr-opt { display: inline-flex; align-items: center; gap: 6px; color: #c62828; }
    .pmr-skip-opt mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .pmr-unit-warn {
      display: flex; align-items: center; gap: 6px; margin-top: 4px;
      padding: 5px 10px; border-radius: 6px; background: #fff3e0; color: #e65100; font-size: 12px;
    }
    .pmr-unit-warn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .pmr-search {
      display: flex; align-items: center; gap: 6px;
      border: 1px dashed #b0bec5; border-radius: 8px; padding: 4px 10px; background: #fff;
    }
    .pmr-search-icon { color: #90a4ae; font-size: 18px; width: 18px; height: 18px; }
    .pmr-search input { flex: 1; border: none; outline: none; font-size: 12px; padding: 4px 0; background: transparent; }
    .pmr-search-hint { font-size: 11px; color: #90a4ae; margin: 3px 2px 0; }
    .pmr-search-hint--empty { color: #c62828; }

    .pmr-actions { display: flex; align-items: center; gap: 10px; padding: 10px 16px; border-top: 1px solid #eceff1; }
    .pmr-summary { display: flex; gap: 14px; font-size: 12px; font-weight: 600; }
    .pmr-summary-ok { display: inline-flex; align-items: center; gap: 3px; color: #2e7d32; }
    .pmr-summary-skip { display: inline-flex; align-items: center; gap: 3px; color: #c62828; }
    .pmr-summary mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .pmr-spacer { flex: 1; }
  `],
})
export class PurchaseMatchReviewDialogComponent {
  private data = inject(MAT_DIALOG_DATA) as { items: PurchaseMatchReviewItem[] };
  private dialogRef = inject(MatDialogRef<PurchaseMatchReviewDialogComponent>);
  private purchaseOrderService = inject(KiotVietPurchaseOrderService);

  searchTexts: string[] = this.data.items.map(() => '');
  searchResults: KiotVietPurchaseProduct[][] = this.data.items.map(() => []);
  searching: boolean[] = this.data.items.map(() => false);
  searched: boolean[] = this.data.items.map(() => false);

  get items(): PurchaseMatchReviewItem[] { return this.data.items; }

  get chosenCount(): number { return this.items.filter(i => i.selectedIdx >= 0).length; }
  get skipCount(): number { return this.items.filter(i => i.selectedIdx < 0).length; }

  /** % giống nhau giữa tên trên hóa đơn và tên SP KiotViet */
  scoreOf(item: PurchaseMatchReviewItem, product: KiotVietPurchaseProduct): number {
    return Math.round(this.purchaseOrderService.similarity(item.description, product.ProductName) * 100);
  }

  unitOf(product: KiotVietPurchaseProduct): string {
    return this.purchaseOrderService.normalizeUnit(product.Unit);
  }

  invoiceUnitNorm(item: PurchaseMatchReviewItem): string {
    return this.purchaseOrderService.normalizeUnit(item.invoiceUnit);
  }

  selectedUnit(item: PurchaseMatchReviewItem): string {
    return item.selectedIdx >= 0 ? (item.candidates[item.selectedIdx]?.Unit || '') : '';
  }

  /** SP đang chọn có đơn vị khác ĐVT hóa đơn không (chỉ cảnh báo khi cả 2 đều có) */
  unitMismatch(item: PurchaseMatchReviewItem): boolean {
    if (item.selectedIdx < 0) return false;
    const inv = this.invoiceUnitNorm(item);
    const sel = this.unitOf(item.candidates[item.selectedIdx]);
    return !!inv && !!sel && inv !== sel;
  }

  scoreClass(score: number): string {
    if (score >= 80) return 'pmr-score--high';
    if (score >= 40) return 'pmr-score--mid';
    return 'pmr-score--low';
  }

  private selectedScore(item: PurchaseMatchReviewItem): number {
    if (item.selectedIdx < 0) return -1;
    const p = item.candidates[item.selectedIdx];
    return p ? this.scoreOf(item, p) : -1;
  }

  statusClass(item: PurchaseMatchReviewItem): string {
    const s = this.selectedScore(item);
    if (s < 0) return 'pmr-status--none';
    if (s >= 80) return 'pmr-status--ok';
    return 'pmr-status--warn';
  }

  statusIcon(item: PurchaseMatchReviewItem): string {
    const s = this.selectedScore(item);
    if (s < 0) return 'help_outline';
    if (s >= 80) return 'check_circle';
    return 'warning_amber';
  }

  statusLabel(item: PurchaseMatchReviewItem): string {
    const s = this.selectedScore(item);
    if (s < 0) return 'Chưa chọn';
    if (s >= 80) return 'Khớp tốt';
    return 'Cần kiểm tra';
  }

  async searchProduct(idx: number): Promise<void> {
    const term = (this.searchTexts[idx] || '').trim();
    if (term.length < 2) return;

    this.searching[idx] = true;
    try {
      const results = await this.purchaseOrderService.searchProducts(term);
      const existingIds = new Set(this.items[idx].candidates.map(c => c.Id));
      this.searchResults[idx] = (results || []).filter(p => !existingIds.has(p.Id)).slice(0, 10);
    } catch (error) {
      logError('[PurchaseMatchReview] search error:', error);
      this.searchResults[idx] = [];
    } finally {
      this.searching[idx] = false;
      this.searched[idx] = true;
    }
  }

  selectSearchResult(idx: number, item: PurchaseMatchReviewItem, product: KiotVietPurchaseProduct): void {
    item.candidates.push(product);
    item.selectedIdx = item.candidates.length - 1;
    log('[PurchaseMatchReview] chọn SP:', product.Code, product.ProductName);
    setTimeout(() => {
      this.searchTexts[idx] = '';
      this.searchResults[idx] = [];
      this.searched[idx] = false;
    });
  }

  confirm(): void {
    const result: PurchaseMatchReviewResult = new Map();
    this.items.forEach(item => {
      const product = item.selectedIdx >= 0 ? item.candidates[item.selectedIdx] : null;
      result.set(item.lineIndex, product || null);
    });
    this.dialogRef.close(result);
  }
}
