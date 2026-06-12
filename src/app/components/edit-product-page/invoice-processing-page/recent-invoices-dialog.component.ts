import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatRippleModule } from '@angular/material/core';

import { InvoiceServiceV2, RecentAiInvoice } from '../../../services/invoice.service.v2';

@Component({
  selector: 'app-recent-invoices-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatRippleModule
  ],
  template: `
    <div class="dialog-container">
      <!-- Header -->
      <div class="dialog-header">
        <div class="header-content">
          <div class="header-icon">
            <mat-icon>history</mat-icon>
          </div>
          <div class="header-text">
            <h2>Hóa Đơn Đã Xử Lý</h2>
            <span class="subtitle">Chọn hóa đơn để tải lại thông tin</span>
          </div>
        </div>
        <button mat-icon-button class="close-btn" (click)="onClose()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- Content -->
      <div class="dialog-content">
        <!-- Loading state -->
        <div class="loading-container" *ngIf="isLoading">
          <mat-spinner diameter="48"></mat-spinner>
          <span>Đang tải danh sách hóa đơn...</span>
        </div>

        <!-- Empty state -->
        <div class="empty-state" *ngIf="!isLoading && invoices.length === 0">
          <div class="empty-icon">
            <mat-icon>inbox</mat-icon>
          </div>
          <h3>Chưa có hóa đơn nào</h3>
          <p>Không có hóa đơn nào được xử lý trong 24 giờ qua</p>
        </div>

        <!-- Invoice list -->
        <div class="invoice-list" *ngIf="!isLoading && invoices.length > 0">
          <div class="invoice-card" *ngFor="let inv of invoices; let i = index"
               matRipple
               [class.selected]="selectedInvoice?.id === inv.id"
               (click)="onSelectCard(inv)">

            <!-- Card Header -->
            <div class="card-header">
              <div class="invoice-number">
                <span class="label">Số HĐ:</span>
                <span class="value">{{ inv.invoiceNo }}</span>
                <span class="symbol" *ngIf="inv.invoiceSymbol">{{ inv.invoiceSymbol }}</span>
              </div>
              <div class="invoice-date">
                <mat-icon>calendar_today</mat-icon>
                {{ inv.invoiceDate }}
              </div>
            </div>

            <!-- Card Body -->
            <div class="card-body">
              <div class="supplier-info">
                <mat-icon class="supplier-icon">store</mat-icon>
                <div class="supplier-details">
                  <span class="supplier-name" [matTooltip]="inv.supplierName">
                    {{ truncate(inv.supplierName, 40) }}
                  </span>
                  <span class="supplier-tax">MST: {{ inv.supplierTaxCode }}</span>
                </div>
              </div>
            </div>

            <!-- Card Footer -->
            <div class="card-footer">
              <div class="stats">
                <div class="stat-item">
                  <mat-icon>shopping_cart</mat-icon>
                  <span>{{ inv.items.length || 0 }} sản phẩm</span>
                </div>
                <div class="stat-item total">
                  <mat-icon>payments</mat-icon>
                  <span>{{ formatCurrency(inv.totalAmount) }}</span>
                </div>
              </div>
              <button mat-flat-button color="primary" class="select-btn"
                      (click)="onSelect(inv); $event.stopPropagation()">
                <mat-icon>check</mat-icon>
                Chọn
              </button>
            </div>

            <!-- Selection indicator -->
            <div class="selection-indicator" *ngIf="selectedInvoice?.id === inv.id">
              <mat-icon>check_circle</mat-icon>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="dialog-footer">
        <div class="footer-info">
          <mat-icon>info_outline</mat-icon>
          <span *ngIf="!isLoading">{{ invoices.length }} hóa đơn trong 24h qua</span>
        </div>
        <div class="footer-actions">
          <button mat-button (click)="onClose()">Đóng</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .dialog-container {
      display: flex;
      flex-direction: column;
      background: #fff;
      overflow: hidden;
      margin: -24px;
    }

    /* Header */
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      background: linear-gradient(135deg, #1a237e 0%, #3949ab 100%);
      color: white;
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .header-icon {
      width: 48px;
      height: 48px;
      background: rgba(255,255,255,0.15);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .header-icon mat-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .header-text h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
    }

    .header-text .subtitle {
      font-size: 13px;
      opacity: 0.85;
    }

    .close-btn {
      color: white;
      opacity: 0.8;
      transition: opacity 0.2s;
    }

    .close-btn:hover {
      opacity: 1;
    }

    /* Content */
    .dialog-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      background: #f5f5f5;
      min-height: 280px;
      max-height: 400px;
    }

    /* Loading */
    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 250px;
      gap: 20px;
      color: #666;
    }

    /* Empty State */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 250px;
      text-align: center;
    }

    .empty-icon {
      width: 80px;
      height: 80px;
      background: #e0e0e0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }

    .empty-icon mat-icon {
      font-size: 40px;
      width: 40px;
      height: 40px;
      color: #9e9e9e;
    }

    .empty-state h3 {
      margin: 0 0 8px 0;
      color: #424242;
      font-size: 18px;
    }

    .empty-state p {
      margin: 0;
      color: #757575;
      font-size: 14px;
    }

    /* Invoice List */
    .invoice-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Invoice Card */
    .invoice-card {
      background: white;
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s ease;
      border: 2px solid transparent;
      position: relative;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }

    .invoice-card:hover {
      border-color: #c5cae9;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transform: translateY(-2px);
    }

    .invoice-card.selected {
      border-color: #3949ab;
      background: #e8eaf6;
    }

    /* Card Header */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid #eee;
    }

    .invoice-number {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .invoice-number .label {
      color: #757575;
      font-size: 13px;
    }

    .invoice-number .value {
      font-weight: 700;
      font-size: 16px;
      color: #1a237e;
    }

    .invoice-number .symbol {
      background: #e3f2fd;
      color: #1565c0;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }

    .invoice-date {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #616161;
      font-size: 13px;
    }

    .invoice-date mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    /* Card Body */
    .card-body {
      margin-bottom: 12px;
    }

    .supplier-info {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .supplier-icon {
      color: #7986cb;
      font-size: 20px;
      width: 20px;
      height: 20px;
      margin-top: 2px;
    }

    .supplier-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .supplier-name {
      font-weight: 500;
      color: #333;
      font-size: 14px;
      line-height: 1.4;
    }

    .supplier-tax {
      color: #757575;
      font-size: 12px;
    }

    /* Card Footer */
    .card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 12px;
      border-top: 1px solid #eee;
    }

    .stats {
      display: flex;
      gap: 20px;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #616161;
      font-size: 13px;
    }

    .stat-item mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #9e9e9e;
    }

    .stat-item.total {
      font-weight: 600;
      color: #2e7d32;
    }

    .stat-item.total mat-icon {
      color: #43a047;
    }

    .select-btn {
      padding: 0 16px;
      height: 36px;
      font-size: 13px;
    }

    .select-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    /* Selection Indicator */
    .selection-indicator {
      position: absolute;
      top: 12px;
      right: 12px;
      color: #3949ab;
    }

    .selection-indicator mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    /* Footer */
    .dialog-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 24px;
      background: #fafafa;
      border-top: 1px solid #e0e0e0;
    }

    .footer-info {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #757575;
      font-size: 13px;
    }

    .footer-info mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .footer-actions {
      display: flex;
      gap: 8px;
    }

    /* Scrollbar styling */
    .dialog-content::-webkit-scrollbar {
      width: 6px;
    }

    .dialog-content::-webkit-scrollbar-track {
      background: #f0f0f0;
      border-radius: 3px;
    }

    .dialog-content::-webkit-scrollbar-thumb {
      background: #bdbdbd;
      border-radius: 3px;
    }

    .dialog-content::-webkit-scrollbar-thumb:hover {
      background: #9e9e9e;
    }
  `]
})
export class RecentInvoicesDialogComponent implements OnInit {
  invoices: RecentAiInvoice[] = [];
  isLoading = true;
  selectedInvoice: RecentAiInvoice | null = null;

  constructor(
    private dialogRef: MatDialogRef<RecentInvoicesDialogComponent>,
    private invoiceService: InvoiceServiceV2,
    @Inject(MAT_DIALOG_DATA) public data: { days?: number }
  ) {}

  ngOnInit(): void {
    this.loadRecentInvoices();
  }

  private loadRecentInvoices(): void {
    const days = this.data?.days || 1;

    this.invoiceService.getRecentAiInvoices(days).subscribe({
      next: (response) => {
        this.isLoading = false;
        if (response.success) {
          this.invoices = response.invoices;
        }
      },
      error: (error) => {
        this.isLoading = false;
        console.error('Error loading recent invoices:', error);
      }
    });
  }

  onSelectCard(invoice: RecentAiInvoice): void {
    this.selectedInvoice = invoice;
  }

  onSelect(invoice: RecentAiInvoice): void {
    this.dialogRef.close(invoice);
  }

  onClose(): void {
    this.dialogRef.close(null);
  }

  formatCurrency(value: number): string {
    if (value === undefined || value === null) return '0 đ';
    return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
  }

  truncate(text: string, maxLength: number): string {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}
