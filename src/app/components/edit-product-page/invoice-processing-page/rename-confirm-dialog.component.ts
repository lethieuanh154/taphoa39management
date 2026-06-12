import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

export interface RenameCandidate {
  itemIndex: number;
  newDescription: string;
  oldDescription: string;
  productCode: string;
  productName: string;
  existingMappingId: string;
  confirmed: boolean;
}

export interface RenameConfirmResult {
  confirmed: RenameCandidate[];   // treat as rename
  rejected: RenameCandidate[];    // treat as new product
}

@Component({
  selector: 'app-rename-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatIconModule, FormsModule],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <div class="header-content">
          <mat-icon>find_replace</mat-icon>
          <div>
            <h2>Phát Hiện Đổi Tên Sản Phẩm</h2>
            <span class="subtitle">Xác nhận các sản phẩm bên dưới có phải đổi tên không</span>
          </div>
        </div>
      </div>

      <div class="dialog-content">
        <div class="candidate-row" *ngFor="let c of candidates">
          <mat-checkbox [(ngModel)]="c.confirmed" color="primary"></mat-checkbox>
          <div class="candidate-info">
            <div class="names">
              <span class="old-name">{{ c.oldDescription }}</span>
              <mat-icon class="arrow">arrow_forward</mat-icon>
              <span class="new-name">{{ c.newDescription }}</span>
            </div>
            <div class="product-ref">
              <mat-icon>inventory_2</mat-icon>
              <span>{{ c.productName }} ({{ c.productCode }})</span>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <span class="hint">
          <mat-icon>info_outline</mat-icon>
          Tick = cùng sản phẩm, đổi tên. Bỏ tick = sản phẩm mới.
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
    .dialog-container { display: flex; flex-direction: column; background: #fff; margin: -24px; }
    .dialog-header {
      padding: 16px 24px;
      background: linear-gradient(135deg, #e65100 0%, #ff8f00 100%);
      color: white;
    }
    .header-content { display: flex; align-items: center; gap: 12px; }
    .header-content mat-icon { font-size: 32px; width: 32px; height: 32px; }
    .dialog-header h2 { margin: 0; font-size: 18px; font-weight: 600; }
    .subtitle { font-size: 12px; opacity: 0.85; }
    .dialog-content { padding: 16px 24px; max-height: 360px; overflow-y: auto; }
    .candidate-row {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px; margin-bottom: 8px;
      background: #fff8e1; border-radius: 8px; border: 1px solid #ffe082;
    }
    .candidate-info { flex: 1; }
    .names { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .old-name { color: #b71c1c; font-weight: 500; font-size: 14px; text-decoration: line-through; }
    .new-name { color: #1b5e20; font-weight: 600; font-size: 14px; }
    .arrow { color: #666; font-size: 18px; width: 18px; height: 18px; }
    .product-ref { display: flex; align-items: center; gap: 6px; color: #555; font-size: 12px; }
    .product-ref mat-icon { font-size: 16px; width: 16px; height: 16px; color: #7986cb; }
    .dialog-footer {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 24px; background: #fafafa; border-top: 1px solid #e0e0e0;
    }
    .hint { display: flex; align-items: center; gap: 6px; color: #757575; font-size: 12px; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .actions { display: flex; gap: 8px; }
  `]
})
export class RenameConfirmDialogComponent {
  candidates: RenameCandidate[];

  constructor(
    private dialogRef: MatDialogRef<RenameConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { candidates: RenameCandidate[] }
  ) {
    this.candidates = data.candidates.map(c => ({ ...c, confirmed: true }));
  }

  onConfirm(): void {
    const result: RenameConfirmResult = {
      confirmed: this.candidates.filter(c => c.confirmed),
      rejected: this.candidates.filter(c => !c.confirmed),
    };
    this.dialogRef.close(result);
  }

  onClose(): void {
    this.dialogRef.close(null);
  }
}
