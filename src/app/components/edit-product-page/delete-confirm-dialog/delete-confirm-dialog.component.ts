import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface DeleteConfirmDialogData {
  productCode: string;
  productName: string;
}

@Component({
  selector: 'app-delete-confirm-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <div class="delete-confirm-dialog">
      <div class="dialog-header">
        <mat-icon class="warning-icon">warning</mat-icon>
        <h2>Xác nhận xóa sản phẩm</h2>
      </div>

      <div class="dialog-content">
        <p>Bạn có chắc chắn muốn xóa sản phẩm này?</p>
        <div class="product-info">
          <div class="info-row">
            <span class="label">Mã hàng:</span>
            <span class="value code">{{ data.productCode }}</span>
          </div>
          <div class="info-row">
            <span class="label">Tên hàng:</span>
            <span class="value name">{{ data.productName }}</span>
          </div>
        </div>
        <p class="warning-text">
          <mat-icon>info</mat-icon>
          Thao tác này sẽ xóa sản phẩm khỏi Firebase và IndexedDB (bao gồm cả các đơn vị con).
        </p>
      </div>

      <div class="dialog-actions">
        <button mat-button class="cancel-btn" (click)="onCancel()">
          <mat-icon>close</mat-icon>
          Hủy
        </button>
        <button mat-raised-button class="delete-btn" color="warn" (click)="onConfirm()">
          <mat-icon>delete</mat-icon>
          Xóa
        </button>
      </div>
    </div>
  `,
  styles: [`
    .delete-confirm-dialog {
      padding: 16px;
      min-width: 350px;
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
    }

    .warning-icon {
      color: #f44336;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .dialog-content p {
      margin: 0 0 12px 0;
      color: #555;
    }

    .product-info {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .info-row {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
    }

    .info-row:last-child {
      margin-bottom: 0;
    }

    .label {
      font-weight: 500;
      color: #666;
      min-width: 70px;
    }

    .value {
      color: #333;
    }

    .value.code {
      font-family: monospace;
      font-weight: 600;
      color: #1976d2;
    }

    .value.name {
      font-weight: 500;
    }

    .warning-text {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      color: #f57c00;
      background: #fff3e0;
      padding: 8px 12px;
      border-radius: 4px;
      margin-top: 12px;
    }

    .warning-text mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 20px;
    }

    .cancel-btn {
      color: #666;
    }

    .delete-btn {
      background-color: #f44336;
    }

    .cancel-btn mat-icon,
    .delete-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }
  `]
})
export class DeleteConfirmDialogComponent {
  constructor(
    public dialogRef: MatDialogRef<DeleteConfirmDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: DeleteConfirmDialogData
  ) {}

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
