import { Component, Inject, Input, OnInit, OnDestroy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialog, MatDialogModule } from '@angular/material/dialog';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { OrderService } from '../../services/order.service';
import { TimeZoneService } from '../../services/time-zone.service';
import { ConfirmPopupComponent } from '../confirm-popup/confirm-popup.component';
import { Subscription, firstValueFrom } from 'rxjs';
import { InvoiceTab } from '../../models/invoice.model';

@Component({
  selector: 'app-order-detail',
  templateUrl: './view-selected-order.component.html',
  styleUrls: ['./view-selected-order.component.css'],
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDialogModule]
})
export class ViewSwlectedOrderDialogComponent implements OnInit, OnDestroy {
  isDeleting = false;
  isProcessing = false;
  lastUpdateTime: Date | null = null;
  private subscriptions: Subscription[] = [];

  constructor(
    public dialogRef: MatDialogRef<ViewSwlectedOrderDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { order: InvoiceTab },
    private orderService: OrderService,
    private timeZoneService: TimeZoneService,
    private dialog: MatDialog,
  ) { }

  ngOnInit() {
    this.setupRealTimeSubscriptions();
    this.lastUpdateTime = new Date();
  }

  ngOnDestroy() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
  }

  // WebSocket initialization removed; server no longer supports websockets.

  private setupRealTimeSubscriptions(): void {
    const updatedSub = this.orderService.orderUpdated$.subscribe(order => {
      if (order.id === this.data.order.id) {
        this.handleOrderUpdate(order);
      }
    });
    const deletedSub = this.orderService.orderDeleted$.subscribe(orderId => {
      if (orderId === this.data.order.id) {
        this.handleOrderDeleted(orderId);
      }
    });
    this.subscriptions.push(updatedSub, deletedSub);
  }

  close() {
    this.dialogRef.close();
  }

  getTotalPrice(): number {
    return this.data.order.totalPrice;
  }

  getTotalQuantity(): number {
    return this.data.order.totalQuantity;
  }

  getItemsSubtotal(): number {
    if (!this.data.order.cartItems?.length) return 0;
    return this.data.order.cartItems.reduce((sum: number, item: any) =>
      sum + ((item.totalPrice as number) || (item.unitPrice || 0) * (item.quantity || 0)), 0);
  }

  getDebt(): number {
    // Order chưa thanh toán → Nợ = totalPrice (số tiền cần trả)
    const customerPaid = this.data.order.customerPaid || 0;
    return this.data.order.totalPrice - customerPaid;
  }

  formatVnd(amount: number): string {
    return amount != null ? amount.toLocaleString('en-US') + ' ₫' : '';
  }

  async refreshOrderData(): Promise<void> {
    try {
      const updatedOrder = await this.orderService.getOrderFromDBById(this.data.order.id);
      if (updatedOrder) {
        this.data.order = updatedOrder;
        this.lastUpdateTime = new Date();
      }
    } catch (error) {
      // handle error
    }
  }

  getConnectionStatus(): string {
    return 'Polling / Manual sync';
  }

  getLastUpdateTime(): string {
    if (this.lastUpdateTime) {
      return this.lastUpdateTime.toLocaleTimeString('vi-VN');
    }
    return 'Never';
  }

  handleOrderUpdate(updatedOrder: any): void {
    this.data.order = updatedOrder;
    this.lastUpdateTime = new Date();
  }

  handleOrderDeleted(orderId: string): void {
    this.dialogRef.close(true); // true indicates deletion
  }

  // Delete order method
  async deleteOrder() {
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: `Bạn có chắc chắn muốn xóa đơn hàng ${this.data.order.id}?` }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result === true) {
        try {
          // Delete from IndexedDB
          await this.orderService.deleteOrderFromDB(this.data.order.id);
          
          // Delete from Firestore
          await firstValueFrom(this.orderService.deleteOrderToFirestore(this.data.order.id));
          
          // Notify via WebSocket
          await this.orderService.notifyOrderDeleted(this.data.order.id);
          
          // Close dialog with deletion result
          this.dialogRef.close(true);
          console.log(`✅ Order ${this.data.order.id} has been deleted`);
        } catch (error) {
          console.error('❌ Error deleting order:', error);
        }
      }
    });
  }

  getHtmlContent(): string | null {
    // Try to get the HTML content for printing
    const el = document.querySelector('mat-dialog-content');
    return el ? el.innerHTML : null;
  }

  getStatusText(status: string | undefined): string {
    switch (status) {
      case 'pending':
        return 'Chờ xử lý';
      case 'checked':
        return 'Đã xử lý';
      case 'canceled':
        return 'Đã hủy';
      default:
        return 'Chờ xử lý';
    }
  }
}
