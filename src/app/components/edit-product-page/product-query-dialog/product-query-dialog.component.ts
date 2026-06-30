import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { QueryCondition, QueryOperator } from '../services/product-edit.service';

export interface ProductQueryDialogData {
  fields: string[];
}

@Component({
  selector: 'app-product-query-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatAutocompleteModule
  ],
  template: `
    <div class="product-query-dialog">
      <div class="dialog-header">
        <mat-icon class="query-icon">filter_alt</mat-icon>
        <h2>Query nâng cao</h2>
      </div>
      <p class="dialog-hint">Tất cả điều kiện kết hợp <b>AND</b> · tối đa {{ limit }} kết quả</p>

      <div class="conditions">
        <div class="condition-row" *ngFor="let row of rows; let i = index">
          <mat-form-field class="field-input" appearance="outline">
            <mat-label>Field</mat-label>
            <input matInput [matAutocomplete]="auto" [(ngModel)]="row.field"
              placeholder="vd: Tax" />
            <mat-autocomplete #auto="matAutocomplete">
              <mat-option *ngFor="let f of filteredFieldsFor(row.field)" [value]="f">{{ f }}</mat-option>
            </mat-autocomplete>
          </mat-form-field>

          <mat-form-field class="op-input" appearance="outline">
            <mat-select [(ngModel)]="row.operator">
              <mat-option *ngFor="let op of operators" [value]="op.value">{{ op.label }}</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field class="value-input" appearance="outline">
            <mat-label>Giá trị</mat-label>
            <input matInput [(ngModel)]="row.value" placeholder="vd: 0" (keyup.enter)="runQuery()" />
          </mat-form-field>

          <button class="remove-row-btn" type="button" (click)="removeRow(i)"
            [disabled]="rows.length <= 1" matTooltip="Xóa điều kiện">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      </div>

      <button mat-button class="add-row-btn" type="button" (click)="addRow()">
        <mat-icon>add</mat-icon>
        Thêm điều kiện
      </button>

      <div class="limit-row">
        <mat-form-field class="limit-input" appearance="outline">
          <mat-label>Giới hạn</mat-label>
          <input matInput type="number" min="1" [(ngModel)]="limit" (keyup.enter)="runQuery()" />
        </mat-form-field>
        <span class="limit-hint">số kết quả tối đa</span>
      </div>

      <div class="dialog-actions">
        <button mat-button (click)="cancel()">Hủy</button>
        <button mat-raised-button color="primary" (click)="runQuery()" [disabled]="!hasValidCondition()">
          <mat-icon>search</mat-icon>
          Query
        </button>
      </div>
    </div>
  `,
  styles: [`
    .product-query-dialog {
      padding: 16px;
      min-width: 520px;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 4px;
    }

    .dialog-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 500;
      color: #333;
    }

    .query-icon {
      color: #1976d2;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .dialog-hint {
      margin: 0 0 12px 0;
      font-size: 12px;
      color: #777;
    }

    .conditions {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .condition-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .field-input {
      flex: 2;
    }

    .op-input {
      width: 80px;
      flex-shrink: 0;
    }

    .value-input {
      flex: 1.5;
    }

    .remove-row-btn {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: #9e9e9e;
      cursor: pointer;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .remove-row-btn:hover:not(:disabled) {
      background: #f5f5f5;
      color: #616161;
    }

    .remove-row-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .remove-row-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .add-row-btn {
      color: #1976d2;
      margin-top: 4px;
    }

    .limit-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .limit-input {
      width: 120px;
    }

    .limit-hint {
      font-size: 12px;
      color: #777;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-top: 16px;
    }

    .dialog-actions mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }
  `]
})
export class ProductQueryDialogComponent {
  limit = 10;
  fields: string[] = [];

  rows: { field: string; operator: QueryOperator; value: string }[] = [
    { field: '', operator: '=', value: '' }
  ];

  operators: { value: QueryOperator; label: string }[] = [
    { value: '=', label: '=' },
    { value: '!=', label: '≠' },
    { value: '>', label: '>' },
    { value: '<', label: '<' },
    { value: '>=', label: '≥' },
    { value: '<=', label: '≤' },
    { value: 'contains', label: 'chứa' }
  ];

  constructor(
    public dialogRef: MatDialogRef<ProductQueryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ProductQueryDialogData
  ) {
    this.fields = data?.fields || [];
  }

  filteredFieldsFor(text: string): string[] {
    const t = (text || '').toLowerCase().trim();
    const list = t ? this.fields.filter(f => f.toLowerCase().includes(t)) : this.fields;
    return list.slice(0, 50);
  }

  addRow(): void {
    this.rows.push({ field: '', operator: '=', value: '' });
  }

  removeRow(index: number): void {
    if (this.rows.length > 1) {
      this.rows.splice(index, 1);
    }
  }

  hasValidCondition(): boolean {
    return this.rows.some(r => !!r.field && r.field.trim() !== '');
  }

  runQuery(): void {
    if (!this.hasValidCondition()) return;
    const conditions: QueryCondition[] = this.rows
      .filter(r => !!r.field && r.field.trim() !== '')
      .map(r => ({ field: r.field.trim(), operator: r.operator, value: r.value }));
    let lim = Number(this.limit);
    if (!Number.isFinite(lim) || lim < 1) lim = 10;
    this.dialogRef.close({ conditions, limit: Math.floor(lim) });
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
