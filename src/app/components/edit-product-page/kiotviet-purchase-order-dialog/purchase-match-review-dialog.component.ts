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
    <h2 mat-dialog-title style="font-size:15px;padding:14px 20px 0">
      Xác nhận sản phẩm KiotViet — {{ items.length }} mục cần kiểm tra
    </h2>
    <mat-dialog-content style="min-width:520px;max-width:640px;padding:8px 20px 4px;max-height:65vh;overflow-y:auto">
      <div *ngFor="let item of items; let i = index"
           style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #eee">
        <div style="font-size:11px;color:#888;margin-bottom:3px">{{ i + 1 }}. Hóa đơn:</div>
        <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:#333">
          {{ item.description }}
          <span *ngIf="item.invoiceUnit" style="color:#888;font-weight:400">({{ item.invoiceUnit }})</span>
        </div>

        <mat-form-field appearance="outline" style="width:100%;font-size:13px">
          <mat-select [(ngModel)]="item.selectedIdx">
            <mat-option [value]="-1">
              <span style="color:#d32f2f">— Bỏ qua dòng này —</span>
            </mat-option>
            <mat-option *ngFor="let c of item.candidates; let j = index" [value]="j">
              <span style="user-select:text">
                [{{ c.Code }}] {{ c.Name }} — {{ scoreOf(item, c) }}%
              </span>
            </mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Tìm SP thủ công trên KiotViet -->
        <div style="margin-top:-4px">
          <input type="text"
                 placeholder="Tìm mã/tên SP trên KiotViet (Enter để tìm)..."
                 [(ngModel)]="searchTexts[i]"
                 (keyup.enter)="searchProduct(i)"
                 [matAutocomplete]="auto"
                 style="width:100%;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;outline:none;box-sizing:border-box">
          <mat-autocomplete #auto="matAutocomplete" (optionSelected)="selectSearchResult(i, item, $event.option.value)">
            <mat-option *ngFor="let sr of searchResults[i]" [value]="sr"
                        style="font-size:12px;line-height:1.4;height:auto;padding:6px 8px">
              <span style="color:#1565c0;font-weight:500">[{{ sr.Code }}]</span> {{ sr.Name }}
            </mat-option>
          </mat-autocomplete>
          <div *ngIf="searching[i]" style="font-size:11px;color:#888;margin-top:2px">Đang tìm trên KiotViet...</div>
          <div *ngIf="!searching[i] && searched[i] && !searchResults[i].length"
               style="font-size:11px;color:#d32f2f;margin-top:2px">Không tìm thấy sản phẩm</div>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" style="padding:8px 16px">
      <button mat-button mat-dialog-close>Hủy</button>
      <button mat-raised-button color="primary" (click)="confirm()">Xác nhận ({{ items.length }})</button>
    </mat-dialog-actions>
  `,
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

  /** % giống nhau giữa tên trên hóa đơn và tên SP KiotViet */
  scoreOf(item: PurchaseMatchReviewItem, product: KiotVietPurchaseProduct): number {
    return Math.round(this.purchaseOrderService.similarity(item.description, product.ProductName) * 100);
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
