import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ProductHistoryService } from '../../../services/product-history.service';
import { ProductChangeRecord, FIELD_LABELS, HistoryTag, HISTORY_TAG_LABELS } from '../../../models/product-history.model';

export interface ProductHistoryDialogData {
  productId: number;
  productCode: string;
  productName: string;
}

@Component({
  selector: 'app-product-history-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './product-history-dialog.component.html',
  styleUrls: ['./product-history-dialog.component.css']
})
export class ProductHistoryDialogComponent implements OnInit {
  records: ProductChangeRecord[] = [];
  groupedRecords: { date: string; records: ProductChangeRecord[] }[] = [];
  isLoading = false;

  constructor(
    private dialogRef: MatDialogRef<ProductHistoryDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: ProductHistoryDialogData,
    private historyService: ProductHistoryService
  ) {}

  ngOnInit(): void {
    this.loadRecords();
  }

  loadRecords(): void {
    this.isLoading = true;
    this.historyService.getRecordsFromApi(this.data.productId).subscribe({
      next: (records) => {
        this.records = records;
        this.groupByDate();
        this.isLoading = false;
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  private groupByDate(): void {
    const groups = new Map<string, ProductChangeRecord[]>();

    for (const record of this.records) {
      const date = this.formatDate(record.timestamp);
      if (!groups.has(date)) {
        groups.set(date, []);
      }
      groups.get(date)!.push(record);
    }

    this.groupedRecords = Array.from(groups.entries()).map(([date, records]) => ({
      date,
      records
    }));
  }

  formatDate(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  formatTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  formatValue(value: string | number, field: string): string {
    if (field === 'BasePrice' || field === 'Cost') {
      const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
      return num.toLocaleString('vi-VN') + 'đ';
    }
    if (field === 'OnHandNV') {
      const num = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
      return num.toLocaleString('vi-VN');
    }
    return String(value);
  }

  getFieldIcon(field: string): string {
    switch (field) {
      case 'Code': return 'qr_code';
      case 'Name': return 'label';
      case 'BasePrice': return 'sell';
      case 'Cost': return 'payments';
      case 'OnHandNV': return 'inventory';
      default: return 'edit';
    }
  }

  getFieldClass(field: string): string {
    switch (field) {
      case 'Code': return 'field-code';
      case 'Name': return 'field-name';
      case 'BasePrice': return 'field-price';
      case 'Cost': return 'field-cost';
      case 'OnHandNV': return 'field-stock';
      default: return '';
    }
  }

  isIncrease(record: ProductChangeRecord): boolean {
    if (typeof record.oldValue === 'number' && typeof record.newValue === 'number') {
      return record.newValue > record.oldValue;
    }
    return false;
  }

  isDecrease(record: ProductChangeRecord): boolean {
    if (typeof record.oldValue === 'number' && typeof record.newValue === 'number') {
      return record.newValue < record.oldValue;
    }
    return false;
  }

  getTagLabel(tag: HistoryTag): string {
    return HISTORY_TAG_LABELS[tag] || tag;
  }

  clearHistory(): void {
    if (confirm('Bạn có chắc muốn xóa toàn bộ lịch sử thay đổi của sản phẩm này?')) {
      this.historyService.clearHistory(this.data.productId).subscribe(() => {
        this.records = [];
        this.groupedRecords = [];
      });
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
