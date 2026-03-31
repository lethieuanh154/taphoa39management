import { Component, ElementRef, Inject, Input, ViewChild, OnInit, Optional } from '@angular/core';
import { InvoiceTab } from '../../models/invoice.model';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TimeZoneService } from '../../services/time-zone.service';

@Component({
  selector: 'app-order-detail',
  templateUrl: './order-detail.component.html',
  styleUrl: './order-detail.component.css',
  standalone: true,
  imports: [CommonModule]
})
export class OrderDetailComponent implements OnInit {
  @Input() order!: InvoiceTab;
  constructor(
    @Optional() @Inject(MAT_DIALOG_DATA) public data: { order: InvoiceTab } | null = null,
    @Optional() public dialogRef: MatDialogRef<OrderDetailComponent> | null = null,
    private timeZoneService: TimeZoneService,
  ) { }

  ngOnInit() {
    // Nếu được mở như dialog, sử dụng data từ dialog
    if (this.data && this.data.order) {
      this.order = this.data.order;
    }
  }
  @ViewChild('printSection', { static: false }) printSection!: ElementRef;
  getHtmlContent(): string {
    return this.printSection?.nativeElement?.innerHTML || '';
  }

  formatVietnameseDate(): string {
    const now = new Date();
    const vnNow = this.timeZoneService.formatVietnamISOString(now);
    const d = new Date(vnNow);
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const year = d.getFullYear();

    return `Ngày ${day} tháng ${month} năm ${year}`;
  }
  getTotalDiscount(): number {
    if (!this.order || !this.order.cartItems) return 0;
    return this.order.cartItems
      .filter(item => item.unitPriceSaleOff > 0)
      .reduce((sum, item) => sum + item.unitPriceSaleOff * item.quantity, 0);
  }

  getItemsSubtotal(): number {
    if (!this.order?.cartItems?.length) return 0;
    return this.order.cartItems.reduce((sum: number, item: any) => {
      if (item.isGift) return sum;
      const saleOff = item.unitPriceSaleOff || 0;
      const unitPrice = (item.product?.BasePrice || 0) - saleOff;
      return sum + unitPrice * (item.quantity || 0);
    }, 0);
  }

  getQrImageUrl(): string {
    if (!this.order) {
      return 'https://img.vietqr.io/image/TPB-69586928888-qr_only.png';
    }

    const subtotal = this.getItemsSubtotal();
    const discount = Number(this.order.discountAmount) || 0;
    const amount = Math.max(subtotal - discount, 0);

    const addInfo = encodeURIComponent('Tap hoa 39 cam on quy khach');
    const amountParam = encodeURIComponent(amount.toFixed(0));

    return `https://img.vietqr.io/image/TPB-69586928888-qr_only.png?amount=${amountParam}&addInfo=${addInfo}`;
  }

  getProductAttributeValue(index: number): string {
    if (!this.order || !Array.isArray(this.order.cartItems)) {
      return '';
    }

    const item = this.order.cartItems[index] as any;
    const attribute = item?.product?.ProductAttributes?.[0]?.Value;
    return typeof attribute === 'string' ? attribute : '';
  }
  
}