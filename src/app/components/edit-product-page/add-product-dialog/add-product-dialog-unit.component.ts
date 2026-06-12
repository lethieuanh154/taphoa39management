import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-unit-dialog',
  template: `
    <div class="unit-dialog">
      <div class="dialog-header">
        <h2 class="dialog-title">
          <mat-icon>straighten</mat-icon>
          Thêm đơn vị tính
        </h2>
      </div>

      <div class="dialog-content">
        <div class="info-box" *ngIf="data?.baseName">
          <mat-icon>star</mat-icon>
          <span>Đơn vị cơ bản: <strong>{{ data.baseName }}</strong></span>
        </div>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tên đơn vị</mat-label>
          <input matInput [(ngModel)]="name" placeholder="Ví dụ: Lốc, Thùng, Kiện..." />
          <mat-icon matPrefix>label</mat-icon>
          <mat-error *ngIf="showErrors && !name">Vui lòng nhập tên đơn vị</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Quy đổi</mat-label>
          <input matInput type="number" [(ngModel)]="conversionValue" placeholder="1" min="1" />
          <mat-icon matPrefix>calculate</mat-icon>
          <span matSuffix *ngIf="data?.baseName">{{ data.baseName }}</span>
          <mat-error *ngIf="showErrors && !conversionValue">Vui lòng nhập giá trị quy đổi</mat-error>
        </mat-form-field>

        <div class="conversionValue-example" *ngIf="conversionValue && conversionValue > 0 && data?.baseName && name">
          <mat-icon>info</mat-icon>
          <span>1 {{ name }} = {{ conversionValue }} {{ data.baseName }}</span>
        </div>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Giá bán</mat-label>
          <input matInput type="number" [(ngModel)]="price" placeholder="0" />
          <mat-icon matPrefix>sell</mat-icon>
          <span matSuffix>₫</span>
        </mat-form-field>
      </div>

      <div class="actions">
        <button mat-stroked-button (click)="cancel()">
          Hủy
        </button>
        <span class="spacer"></span>
        <button mat-raised-button color="primary" (click)="save()">
          <mat-icon>check</mat-icon>
          Xong
        </button>
      </div>
    </div>
  `,
  styles: [`
    .unit-dialog {
      min-width: 380px;
      padding: 0;
    }
    .dialog-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 8px ;
      margin-bottom: 12px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .dialog-title {
      margin: 0;
      font-size: 13px;
      font-weight: 600;
      color: white;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dialog-title mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }
    .dialog-content {
      padding: 0 4px;
    }
    .info-box {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 8px;
      margin-bottom: 12px;
      background: #e3f2fd;
      border-left: 3px solid #2196f3;
      border-radius: 4px;
      font-size: 11px;
      color: #1565c0;
    }
    .info-box mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #2196f3;
      flex-shrink: 0;
    }
    .full-width {
      width: 100%;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .actions {
      display: flex;
      align-items: center;
    }
    .actions button {
      font-size: 12px;
    }
    .spacer {
      flex: 1;
    }
  `],
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule]
})
export class UnitDialogComponent {
  name = '';
  conversionValue: number | null = 1;
  price: number | null = null;
  showErrors = false;

  constructor(private dialogRef: MatDialogRef<UnitDialogComponent>, @Inject(MAT_DIALOG_DATA) public data: any) {}

  save() {
    this.showErrors = true;
    if (!this.name || !this.conversionValue || this.conversionValue <= 0) {
      console.warn('⚠️ [UnitDialog] Validation failed:', { name: this.name, conversionValue: this.conversionValue });
      return;
    }
    console.log('✅ [UnitDialog] Saving unit:', { name: this.name, conversionValue: this.conversionValue, price: this.price });
    this.dialogRef.close({ saved: true, name: this.name, conversionValue: this.conversionValue, price: this.price });
  }

  cancel() {
    this.dialogRef.close({ saved: false });
  }
}
