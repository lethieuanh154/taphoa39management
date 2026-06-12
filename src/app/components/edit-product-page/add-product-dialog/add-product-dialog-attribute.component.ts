import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';

@Component({
  selector: 'app-attribute-dialog',
  template: `
    <div class="attribute-dialog">
      <div class="dialog-header">
        <h2 class="dialog-title">
          <mat-icon>settings</mat-icon>
          Thêm thuộc tính
        </h2>
      </div>

      <div class="dialog-content">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Tên thuộc tính</mat-label>
          <input matInput [(ngModel)]="attributeName" placeholder="Ví dụ: Màu sắc, Kích thước..." />
          <mat-icon matPrefix>label</mat-icon>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Giá trị</mat-label>
          <input
            matInput
            [(ngModel)]="currentValue"
            placeholder="Nhập giá trị và nhấn Enter hoặc dấu phẩy"
            (keydown)="onValueKeydown($event)"
          />
          <mat-icon matPrefix>list</mat-icon>
        </mat-form-field>

        <div class="values-container" *ngIf="values.length > 0">
          <mat-chip-set aria-label="Attribute values">
            <mat-chip *ngFor="let value of values; let i = index"
                      (removed)="removeValue(i)"
                      class="value-chip">
              {{ value }}
              <button matChipRemove>
                <mat-icon>cancel</mat-icon>
              </button>
            </mat-chip>
          </mat-chip-set>
        </div>

        <div class="hint-box" *ngIf="values.length === 0">
          <mat-icon>info</mat-icon>
          <span>Nhập giá trị và nhấn Enter hoặc dấu phẩy để thêm. Ví dụ: Đỏ, Xanh, Vàng</span>
        </div>
      </div>

      <div class="actions">
        <span class="spacer"></span>
        <button mat-raised-button color="primary" (click)="save()" [disabled]="!canSave()">
          <mat-icon>check</mat-icon>
          Xong
        </button>
      </div>
    </div>
  `,
  styles: [`
    .attribute-dialog {
      min-width: 380px;
      padding: 0;
    }
    .dialog-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 8px;
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
    .full-width {
      width: 100%;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .values-container {
      margin: 8px 0;
      padding: 8px;
      background: #f8f9fa;
      border-radius: 4px;
      border: 1px solid #e9ecef;
    }
    .value-chip {
      margin: 2px;
      font-size: 11px;
    }
    .hint-box {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px;
      margin-bottom: 12px;
      background: #e3f2fd;
      border-left: 3px solid #2196f3;
      border-radius: 4px;
      font-size: 11px;
      color: #1565c0;
    }
    .hint-box mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #2196f3;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .actions {
      display: flex;
      align-items: center;
      margin-top: 12px;
    }
    .actions button {
      font-size: 12px;
    }
    .spacer {
      flex: 1;
    }
  `],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule
  ]
})
export class AttributeDialogComponent {
  attributeName = '';
  currentValue = '';
  values: string[] = [];

  constructor(
    private dialogRef: MatDialogRef<AttributeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {
    if (data?.attributeName) {
      this.attributeName = data.attributeName;
    }
    if (data?.values && Array.isArray(data.values)) {
      this.values = [...data.values];
    }
  }

  onValueKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addCurrentValue();
    }
  }

  addCurrentValue() {
    const trimmed = this.currentValue.replace(/,/g, '').trim();
    if (trimmed && !this.values.includes(trimmed)) {
      this.values.push(trimmed);
      this.currentValue = '';
    }
  }

  removeValue(index: number) {
    if (index >= 0 && index < this.values.length) {
      this.values.splice(index, 1);
    }
  }

  canSave(): boolean {
    return this.attributeName.trim().length > 0 && this.values.length > 0;
  }

  save() {
    // Add current value if any before saving
    if (this.currentValue.trim()) {
      this.addCurrentValue();
    }

    if (!this.canSave()) return;

    this.dialogRef.close({
      saved: true,
      attributeName: this.attributeName.trim(),
      values: this.values
    });
  }

  cancel() {
    this.dialogRef.close({ saved: false });
  }
}
