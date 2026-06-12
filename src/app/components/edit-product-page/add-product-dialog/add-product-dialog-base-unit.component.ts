import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-base-unit-dialog',
  template: `
    <div class="unit-dialog">
      <div class="dialog-header">
        <h2 class="dialog-title">
          <mat-icon>star</mat-icon>
          Thêm đơn vị cơ bản
        </h2>
      </div>

      <div class="dialog-content">
        <div class="info-box">
          <mat-icon>info</mat-icon>
          <span>Đơn vị cơ bản là đơn vị nhỏ nhất để tính hàng hóa</span>
        </div>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tên đơn vị cơ bản</mat-label>
          <input matInput [(ngModel)]="name" placeholder="Ví dụ: Chai, Hộp, Cái..." />
          <mat-icon matPrefix>label</mat-icon>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Giá bán</mat-label>
          <input matInput type="number" [(ngModel)]="price" placeholder="0" />
          <mat-icon matPrefix>sell</mat-icon>
          <span matSuffix>₫</span>
        </mat-form-field>
      </div>

      <div class="actions">
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
export class BaseUnitDialogComponent implements OnInit {
  name = '';
  price: number | null = null;

  constructor(
    private dialogRef: MatDialogRef<BaseUnitDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { defaultPrice?: number }
  ) {}

  ngOnInit(): void {
    if (this.data?.defaultPrice) {
      this.price = this.data.defaultPrice;
    }
  }

  save() {
    if (!this.name) {
      return;
    }
    this.dialogRef.close({ saved: true, name: this.name, price: this.price });
  }

  cancel() {
    this.dialogRef.close({ saved: false });
  }
}
