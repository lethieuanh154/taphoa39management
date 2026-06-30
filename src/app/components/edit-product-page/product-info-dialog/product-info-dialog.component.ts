import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ProductInfoDialogData {
  product: any;
}

interface InfoField {
  key: string;
  value: string;
}

@Component({
  selector: 'app-product-info-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <div class="product-info-dialog" [class.clone]="isClone">
      <div class="dialog-header">
        <mat-icon class="info-icon">info</mat-icon>
        <h2>Thông tin sản phẩm</h2>
        <span class="type-badge" [class.clone]="isClone">{{ isClone ? 'Clone' : 'Original' }}</span>
      </div>

      <div class="dialog-summary">
        <div class="img-wrapper" *ngIf="data.product?.Image">
          <img [src]="data.product.Image" [alt]="data.product?.Name" class="product-img" />
        </div>
        <div class="summary-text">
          <div class="summary-name">{{ data.product?.Name || data.product?.FullName || '—' }}</div>
          <div class="summary-code">{{ data.product?.Code || '—' }}</div>
        </div>
      </div>

      <div class="dialog-content">
        <div class="info-row" *ngFor="let field of fields">
          <span class="label">{{ field.key }}</span>
          <span class="value">{{ field.value }}</span>
        </div>
        <p class="empty-text" *ngIf="fields.length === 0">Không có thông tin.</p>
      </div>

      <div class="dialog-actions">
        <button mat-raised-button color="primary" (click)="onClose()">
          <mat-icon>close</mat-icon>
          Đóng
        </button>
      </div>
    </div>
  `,
  styles: [`
    .product-info-dialog {
      padding: 16px;
      min-width: 360px;
      background: #e3f2fd;
    }

    .product-info-dialog.clone {
      background: #fff2e5;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .dialog-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: #333;
      flex: 1;
    }

    .info-icon {
      color: #1976d2;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .type-badge {
      font-size: 12px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 12px;
      background: #e3f2fd;
      color: #1976d2;
    }

    .type-badge.clone {
      background: #f3e5f5;
      color: #7c4dff;
    }

    .dialog-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #f5f5f5;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .img-wrapper {
      width: 56px;
      height: 56px;
      flex-shrink: 0;
    }

    .product-img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      border-radius: 6px;
      background: #fff;
    }

    .summary-name {
      font-weight: 600;
      color: #333;
    }

    .summary-code {
      font-family: monospace;
      font-weight: 600;
      color: #1976d2;
      margin-top: 4px;
    }

    .dialog-content {
      max-height: 50vh;
      overflow-y: auto;
      border: 1px solid #eee;
      border-radius: 8px;
    }

    .info-row {
      display: flex;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid #f0f0f0;
    }

    .info-row:last-child {
      border-bottom: none;
    }

    .info-row:nth-child(even) {
      background: #fafafa;
    }

    .label {
      font-weight: 500;
      color: #666;
      min-width: 160px;
      word-break: break-word;
    }

    .value {
      color: #333;
      flex: 1;
      word-break: break-word;
    }

    .empty-text {
      padding: 12px;
      margin: 0;
      color: #999;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 20px;
    }

    .dialog-actions mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }
  `]
})
export class ProductInfoDialogComponent {
  fields: InfoField[] = [];
  isClone = false;

  constructor(
    public dialogRef: MatDialogRef<ProductInfoDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ProductInfoDialogData
  ) {
    this.isClone = this.data?.product?.isClone === true || this.data?.product?.isClone === 'true';
    this.fields = this.buildFields(this.data?.product);
  }

  /**
   * Build a flat list of all product fields (MasterUnit only).
   * Skips runtime-only helpers (_-prefixed) and function values.
   */
  private buildFields(product: any): InfoField[] {
    if (!product) return [];
    return Object.keys(product)
      .filter(key => !key.startsWith('_') && typeof product[key] !== 'function')
      .sort((a, b) => a.localeCompare(b))
      .map(key => ({ key, value: this.formatValue(product[key]) }));
  }

  private formatValue(value: any): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
