import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatchResult } from '../../../services/fuzzy-match.service';
import { ProductService } from '../../../services/product.service';

export interface MatchReviewItem {
  itemIndex: number;
  description: string;
  candidates: MatchResult[];
  selectedIdx: number;
  invoiceUnit?: string;
  wantRename?: boolean;
  wantRenameUnit?: boolean;
}

export interface MatchReviewResult {
  matches: Map<number, MatchResult>;
  renames: Map<number, string>;                              // itemIndex → newName
  unitRenames: Map<number, { oldUnit: string; newUnit: string }>; // itemIndex → unit change
}

@Component({
  selector: 'app-match-review-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatSelectModule, MatFormFieldModule, MatIconModule],
  template: `
    <h2 mat-dialog-title style="font-size:15px;padding:14px 20px 0">
      Xác nhận sản phẩm — {{ items.length }} mục cần kiểm tra
    </h2>
    <mat-dialog-content style="min-width:480px;max-width:600px;padding:8px 20px 4px;max-height:65vh;overflow-y:auto">
      <div *ngFor="let item of items; let i = index"
           style="margin-bottom:14px;padding-bottom:14px;border-bottom:1px solid #eee">
        <div style="font-size:11px;color:#888;margin-bottom:3px">{{ i + 1 }}. Hóa đơn:</div>
        <div style="font-size:13px;font-weight:500;margin-bottom:6px;color:#333">{{ item.description }}</div>
        <mat-form-field appearance="outline" style="width:100%;font-size:13px">
          <mat-select [(ngModel)]="item.selectedIdx" (ngModelChange)="onSelectChange(item)">
            <mat-option *ngFor="let c of item.candidates; let j = index" [value]="j">
              <span style="user-select:text">[{{ c.product?.Code }}] {{ c.product?.Name || c.product?.FullName }}{{ c.score > 0 ? ' — ' + (c.score * 100).toFixed(0) + '%' : '' }}</span>
            </mat-option>
          </mat-select>
        </mat-form-field>

        <!-- Manual product search -->
        <div style="display:flex;gap:4px;align-items:center;margin-top:-4px">
          <input type="text"
                 placeholder="Tìm mã/tên SP..."
                 [(ngModel)]="searchTexts[i]"
                 (keydown.enter)="searchProduct(i)"
                 style="flex:1;padding:5px 8px;border:1px solid #ccc;border-radius:4px;font-size:12px;outline:none">
          <button mat-icon-button (click)="searchProduct(i)"
                  style="width:30px;height:30px;line-height:30px">
            <mat-icon style="font-size:16px;width:16px;height:16px">search</mat-icon>
          </button>
        </div>
        <div *ngIf="searchResults[i]?.length"
             style="max-height:140px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:4px;margin-top:3px;background:#fafafa">
          <div *ngFor="let sr of searchResults[i]"
               (click)="selectSearchResult(i, item, sr)"
               style="padding:5px 8px;font-size:12px;cursor:pointer;border-bottom:1px solid #f0f0f0"
               onmouseenter="this.style.background='#e3f2fd'" onmouseleave="this.style.background='transparent'">
            <span style="color:#1565c0;font-weight:500">[{{ sr.product?.Code }}]</span> {{ sr.product?.Name }}
            <span *ngIf="sr.product?.Unit" style="color:#888;margin-left:4px">({{ sr.product?.Unit }})</span>
          </div>
        </div>

        <!-- Suggest product rename -->
        <div *ngIf="getProductName(item) !== item.description"
             style="margin-top:8px;display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fff3e0;border-radius:4px;border:1px solid #ffe0b2">
          <mat-checkbox [(ngModel)]="item.wantRename" color="primary"></mat-checkbox>
          <span style="font-size:12px;color:#e65100">
            Đổi tên SP thành <strong>"{{ item.description }}"</strong>?
          </span>
        </div>

        <!-- Suggest unit rename -->
        <div *ngIf="showUnitRename(item)"
             style="margin-top:6px;display:flex;align-items:center;gap:8px;padding:6px 10px;background:#e8f5e9;border-radius:4px;border:1px solid #a5d6a7">
          <mat-checkbox [(ngModel)]="item.wantRenameUnit" color="accent"></mat-checkbox>
          <span style="font-size:12px;color:#2e7d32">
            Đổi đơn vị <strong>"{{ getProductUnit(item) }}"</strong> → <strong>"{{ item.invoiceUnit }}"</strong>?
          </span>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end" style="padding:8px 16px">
      <button mat-button mat-dialog-close>Hủy</button>
      <button mat-raised-button color="primary" (click)="confirm()">Xác nhận ({{ items.length }})</button>
    </mat-dialog-actions>
  `,
})
export class MatchReviewDialogComponent implements OnInit {
  private data = inject(MAT_DIALOG_DATA) as { items: MatchReviewItem[] };
  private dialogRef = inject(MatDialogRef<MatchReviewDialogComponent>);
  private productService = inject(ProductService);

  private allProducts: any[] = [];
  searchTexts: string[] = [];
  searchResults: MatchResult[][] = [];

  get items(): MatchReviewItem[] { return this.data.items; }

  async ngOnInit(): Promise<void> {
    this.searchTexts = this.items.map(() => '');
    this.searchResults = this.items.map(() => []);
    this.allProducts = (await this.productService.getAllProductsFromIndexedDB()) || [];
  }

  searchProduct(idx: number): void {
    const text = (this.searchTexts[idx] || '').trim().toLowerCase();
    if (!text || text.length < 2) {
      this.searchResults[idx] = [];
      return;
    }
    const item = this.items[idx];
    const existingCodes = new Set(item.candidates.map(c => String(c.product?.Code || '')));
    const seenCodes = new Set<string>();
    this.searchResults[idx] = this.allProducts
      .filter(p => {
        const code = String(p.Code || '').toLowerCase();
        const name = String(p.Name || '').toLowerCase();
        if (!(code.includes(text) || name.includes(text))) return false;
        const codeKey = String(p.Code || '');
        if (existingCodes.has(codeKey) || seenCodes.has(codeKey)) return false;
        if (codeKey) seenCodes.add(codeKey);
        return true;
      })
      .slice(0, 8)
      .map(p => ({ product: p, score: 0 }));
  }

  selectSearchResult(idx: number, item: MatchReviewItem, result: MatchResult): void {
    item.candidates.push(result);
    item.selectedIdx = item.candidates.length - 1;
    item.wantRename = false;
    item.wantRenameUnit = false;
    this.searchTexts[idx] = '';
    this.searchResults[idx] = [];
  }

  getProductName(item: MatchReviewItem): string {
    return item.candidates[item.selectedIdx]?.product?.Name || '';
  }

  getProductUnit(item: MatchReviewItem): string {
    return item.candidates[item.selectedIdx]?.product?.Unit || '';
  }

  showUnitRename(item: MatchReviewItem): boolean {
    const pu = this.getProductUnit(item).toLowerCase().trim();
    const iu = (item.invoiceUnit || '').toLowerCase().trim();
    return !!pu && !!iu && pu !== iu;
  }

  onSelectChange(item: MatchReviewItem): void {
    item.wantRename = false;
    item.wantRenameUnit = false;
  }

  confirm(): void {
    const matches = new Map<number, MatchResult>();
    const renames = new Map<number, string>();
    const unitRenames = new Map<number, { oldUnit: string; newUnit: string }>();

    this.items.forEach(item => {
      const match = item.candidates[item.selectedIdx];
      matches.set(item.itemIndex, match);

      if (item.wantRename && this.getProductName(item) !== item.description) {
        renames.set(item.itemIndex, item.description);
      }

      if (item.wantRenameUnit && this.showUnitRename(item)) {
        unitRenames.set(item.itemIndex, {
          oldUnit: this.getProductUnit(item),
          newUnit: item.invoiceUnit!,
        });
      }
    });

    this.dialogRef.close({ matches, renames, unitRenames } as MatchReviewResult);
  }
}
