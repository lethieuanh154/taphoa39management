import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

export interface UnitRenameCandidate {
  itemIndex: number;
  productCode: string;
  productName: string;
  oldUnit: string;        // product's current unit
  newUnit: string;        // unit from invoice/mapping
  mappingId: string;
  score: number;          // fuzzy match score (0-1)
  confirmed: boolean;
}

export interface UnitRenameConfirmResult {
  confirmed: UnitRenameCandidate[];
  rejected: UnitRenameCandidate[];
}

@Component({
  selector: 'app-unit-rename-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatIconModule, FormsModule],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <div class="header-content">
          <mat-icon>swap_horiz</mat-icon>
          <div>
            <h2>Gợi Ý Đổi Đơn Vị</h2>
            <span class="subtitle">Đơn vị trên hóa đơn khác với đơn vị sản phẩm hiện tại</span>
          </div>
        </div>
      </div>

      <div class="dialog-content">
        <div class="candidate-row" *ngFor="let c of candidates">
          <mat-checkbox [(ngModel)]="c.confirmed" color="primary"></mat-checkbox>
          <div class="candidate-info">
            <div class="candidate-top">
              <div class="units">
                <span class="old-unit">{{ c.oldUnit }}</span>
                <mat-icon class="arrow">arrow_forward</mat-icon>
                <span class="new-unit">{{ c.newUnit }}</span>
              </div>
              <div class="product-ref">
                <mat-icon>inventory_2</mat-icon>
                <span>{{ c.productName }} ({{ c.productCode }})</span>
              </div>
              <span class="score-ref" *ngIf="c.score < 1">{{ (c.score * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <span class="hint">
          <mat-icon>info_outline</mat-icon>
          Tick = đổi đơn vị. Bỏ tick = giữ nguyên.
        </span>
        <div class="actions">
          <button mat-button (click)="onClose()">Hủy</button>
          <button mat-flat-button color="primary" (click)="onConfirm()">Xác Nhận</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .dialog-container {
      display: flex; flex-direction: column; background: #fff;
    }
    .dialog-header {
      padding: 14px 20px;
      background: linear-gradient(135deg, #1b5e20 0%, #43a047 100%);
      color: white;
    }
    .header-content { display: flex; align-items: center; gap: 10px; }
    .header-content mat-icon { font-size: 28px; width: 28px; height: 28px; }
    .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
    .subtitle { font-size: 11px; opacity: 0.85; }
    .dialog-content { padding: 12px 16px; overflow: hidden; }
    .candidate-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 12px; margin-bottom: 6px;
      background: #e8f5e9; border-radius: 8px; border: 1px solid #a5d6a7;
      overflow: hidden;
    }
    .candidate-info { flex: 1; min-width: 0; overflow: hidden; }
    .candidate-top { display: flex; align-items: center; gap: 10px; overflow: hidden; }
    .units { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .old-unit { color: #b71c1c; font-weight: 500; font-size: 13px; text-decoration: line-through; }
    .new-unit { color: #1b5e20; font-weight: 600; font-size: 13px; }
    .arrow { color: #666; font-size: 16px; width: 16px; height: 16px; }
    .product-ref { display: flex; align-items: center; gap: 4px; color: #555; font-size: 12px; min-width: 0; overflow: hidden; }
    .product-ref mat-icon { font-size: 15px; width: 15px; height: 15px; color: #7986cb; flex-shrink: 0; }
    .product-ref span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .score-ref { color: #888; font-size: 11px; margin-left: 4px; flex-shrink: 0; }
    .dialog-footer {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 16px; background: #fafafa; border-top: 1px solid #e0e0e0;
    }
    .hint { display: flex; align-items: center; gap: 4px; color: #757575; font-size: 11px; }
    .hint mat-icon { font-size: 15px; width: 15px; height: 15px; }
    .actions { display: flex; gap: 8px; }
  `]
})
export class UnitRenameConfirmDialogComponent {
  candidates: UnitRenameCandidate[];

  constructor(
    private dialogRef: MatDialogRef<UnitRenameConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { candidates: UnitRenameCandidate[] }
  ) {
    this.candidates = data.candidates.map(c => ({ ...c, confirmed: true }));
  }

  onConfirm(): void {
    const result: UnitRenameConfirmResult = {
      confirmed: this.candidates.filter(c => c.confirmed),
      rejected: this.candidates.filter(c => !c.confirmed),
    };
    this.dialogRef.close(result);
  }

  onClose(): void {
    this.dialogRef.close(null);
  }
}
