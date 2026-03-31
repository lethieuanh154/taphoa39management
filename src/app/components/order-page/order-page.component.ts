import { Component, OnInit, OnDestroy, ViewChild, ViewEncapsulation } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { OrderService } from '../../services/order.service';
import { TimeZoneService } from '../../services/time-zone.service';
import { VietnameseService } from '../../services/vietnamese.service';
import { Router } from '@angular/router';
import { ConfirmPopupComponent } from '../confirm-popup/confirm-popup.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, DateAdapter } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, firstValueFrom } from 'rxjs';
import { OrderDetailComponent } from '../order-detail/order-detail.component';
import { PrintService } from '../../services/print.service';
import { ViewSwlectedOrderDialogComponent } from './view-selected-order.component';
import { InvoiceTab } from '../../models/invoice.model';
@Component({
  selector: 'app-order-page',
  templateUrl: './order-page.component.html',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule
  ],
  styleUrls: ['./order-page.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class OrderPageComponent implements OnInit, OnDestroy {
  allOrders: any[] = [];
  filteredOrders: any[] = [];
  searchTerm = '';
  searchTermProduct = '';
  selectedDate: Date | null = null;
  selectedCustomer = '';
  customers: string[] = [];
  pageSize = 10;
  currentPage = 1;
  displayedColumns: string[] = ['id', 'customer', 'totalPrice', 'createdDate', 'pickupTime', 'deliveryTime', 'status', 'actions'];
  isLoading = false;
  lastSyncTime: Date | null = null;

  // Real-time subscriptions
  private subscriptions: Subscription[] = [];
  private isSyncing = false; // Flag to prevent multiple simultaneous syncs
  private syncDebounceTimer: any = null; // Debounce timer for sync operations

  constructor(
    private dialog: MatDialog,
    private orderService: OrderService,
    private timeZoneService: TimeZoneService,
    private vi: VietnameseService,
    private dateAdapter: DateAdapter<Date>,
    private printService: PrintService,
    private router: Router,
  ) {
    this.dateAdapter.setLocale('vi-VN');
  }

  async ngOnInit() {
    this.isLoading = true;
    try {
      // Connect WebSocket to receive real-time order updates
      await this.orderService.initializeWebSocket();

      // Load tất cả orders từ IndexedDB (không gọi API)
      const orders = await this.orderService.getAllOrdersFromDB();
      this.allOrders = orders || [];

      // Sắp xếp orders theo thời gian ngược lại (gần nhất lên đầu)
      this.allOrders.sort((a, b) => {
        if (!a.createdDate) return 1;
        if (!b.createdDate) return -1;
        return new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime();
      });

      this.filteredOrders = [...this.allOrders];
      this.customers = [...new Set(this.allOrders.map(order =>
        typeof order.customer === 'string' ? order.customer : order.customer?.Name ?? ''
      ))];
      this.applyFilters();

      // Setup real-time subscriptions
      this.setupRealTimeSubscriptions();
    } catch (err) {
      console.error('Error fetching orders:', err);
      this.allOrders = [];
      this.filteredOrders = [];
    } finally {
      this.isLoading = false;
    }
  }

  ngOnDestroy() {
    // Unsubscribe from all real-time events
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];

    // Clear any pending sync timers
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    // Disconnect WebSocket
    this.orderService.disconnectSocket();
  }


  @ViewChild(OrderDetailComponent, { static: false })
  OrderDetailComponent!: OrderDetailComponent;
  printOrder(order: InvoiceTab) {
    const dialogRef = this.dialog.open(OrderDetailComponent, {
      data: { order },
      width: '0px',
      height: '0px',
      panelClass: 'hidden-dialog',
      disableClose: true
    });

    dialogRef.afterOpened().subscribe(() => {
      const componentInstance = dialogRef.componentInstance;
      if (componentInstance) {
        const html = componentInstance.getHtmlContent();
        if (!html) {
          console.error('Không lấy được nội dung HTML hóa đơn!');
          dialogRef.close();
          return;
        }
        this.printService.printHtml(html);
        dialogRef.close();
      } else {
        console.error('Không thể lấy componentInstance của InvoiceDetailComponent!');
        dialogRef.close();
      }
    });
  }

  private async loadLastSyncTime(): Promise<void> {
    try {
      this.lastSyncTime = await this.orderService.getLastSyncTime() || null;
      console.log('📅 Last sync time loaded:', this.lastSyncTime);
    } catch (error) {
      console.error('❌ Error loading last sync time:', error);
    }
  }

  private setupRealTimeSubscriptions(): void {
    // Subscribe to order-specific events
    const createdSub = this.orderService.orderCreated$.subscribe(order => {
      console.log(`🆕 Real-time: Order created - ${order.id}`);
      this.handleOrderCreated(order);
    });

    const updatedSub = this.orderService.orderUpdated$.subscribe(order => {
      console.log(`🔄 Real-time: Order updated - ${order.id}`);
      this.handleOrderUpdated(order);
    });

    const deletedSub = this.orderService.orderDeleted$.subscribe(orderId => {
      console.log(`🗑️ Real-time: Order deleted - ${orderId}`);
      this.handleOrderDeleted(orderId);
    });

    const syncSub = this.orderService.syncCompleted$.subscribe(async () => {
      console.log('🔄 Real-time: Sync completed, updating last sync time...');
      this.isSyncing = false;
      await this.loadLastSyncTime();
    });

    this.subscriptions.push(createdSub, updatedSub, deletedSub, syncSub);
  }

  async fetchOrdersByDate() {
    this.isLoading = true;

    try {
      let orders: any[] = [];

      if (!this.selectedDate) {
        // Nếu không chọn ngày, hiển thị tất cả orders
        orders = await this.orderService.getAllOrdersFromDB();
      } else {
        // Nếu có chọn ngày, filter theo ngày
        orders = await this.orderService.getOrdersByDateFromDB(this.selectedDate);
      }

      this.allOrders = orders || [];

      // Sort orders to show the newest first
      this.allOrders.sort((a, b) => {
        if (!a.createdDate) return 1;
        if (!b.createdDate) return -1;
        return new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime();
      });

      this.filteredOrders = [...this.allOrders];
      this.customers = [...new Set(this.allOrders.map(order =>
        typeof order.customer === 'string' ? order.customer : order.customer?.Name ?? ''
      ))];
      this.applyFilters();

    } catch (err) {
      console.error('Error fetching orders from IndexedDB:', err);
      this.allOrders = [];
      this.filteredOrders = [];
    } finally {
      this.isLoading = false;
    }
  }

  private isOrderInSelectedDate(order: any): boolean {
    if (!this.selectedDate || !order.createdDate) return false;

    const orderDate = new Date(order.createdDate);
    // So sánh chỉ theo ngày/tháng/năm, bỏ qua giờ
    return orderDate.getDate() === this.selectedDate.getDate() &&
      orderDate.getMonth() === this.selectedDate.getMonth() &&
      orderDate.getFullYear() === this.selectedDate.getFullYear();
  }

  // Debounced sync method to prevent multiple rapid calls
  private async debouncedSync(): Promise<void> {
    if (this.syncDebounceTimer) {
      clearTimeout(this.syncDebounceTimer);
    }

    this.syncDebounceTimer = setTimeout(async () => {
      if (!this.isSyncing) {
        await this.performSync();
      }
    }, 1000); // 1 second debounce
  }

  // Actual sync method with proper locking
  private async performSync(): Promise<void> {
    if (this.isSyncing) {
      console.log('⚠️ Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;
    try {
      console.log('🔄 Starting sync with server...');

      await this.orderService.syncOrdersBetweenFirestoreAndIndexedDB();


      console.log('✅ Sync completed successfully');

      // Update last sync time
      await this.loadLastSyncTime();

      // Refresh data after sync
      await this.fetchOrdersByDate();

    } catch (error) {
      console.error('❌ Error during sync:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Real-time update methods
  async handleOrderCreated(order: any): Promise<void> {
    console.log(`🆕 Real-time: Processing order created - ${order.id}`);

    // Check if the order belongs to the current date
    if (this.selectedDate && this.isOrderInSelectedDate(order)) {
      // Add to local list if not already present
      const existingIndex = this.allOrders.findIndex(ord => ord.id === order.id);
      if (existingIndex === -1) {
        this.allOrders.unshift(order); // Add to beginning
        this.updateFilteredOrders();
        console.log(`✅ Order ${order.id} added to current view`);
      } else {
        console.log(`ℹ️ Order ${order.id} already exists in current view`);
      }
    } else {
      console.log(`ℹ️ Order ${order.id} does not belong to current date, skipping UI update`);
    }
  }

  async handleOrderUpdated(order: any): Promise<void> {
    console.log(`🔄 Real-time: Processing order updated - ${order.id}`);

    // Update in local list
    const existingIndex = this.allOrders.findIndex(ord => ord.id === order.id);
    if (existingIndex !== -1) {
      this.allOrders[existingIndex] = order;
      this.updateFilteredOrders();
      console.log(`✅ Order ${order.id} updated in current view`);
    } else {
      console.log(`ℹ️ Order ${order.id} not found in current view, may need to refresh`);
      await this.fetchOrdersByDate();
    }
  }

  async handleOrderDeleted(orderId: string): Promise<void> {
    console.log(`🗑️ Real-time: Processing order deleted - ${orderId}`);

    // Remove from local list
    const initialLength = this.allOrders.length;
    this.allOrders = this.allOrders.filter(ord => ord.id !== orderId);

    if (this.allOrders.length < initialLength) {
      this.updateFilteredOrders();
      console.log(`✅ Order ${orderId} removed from current view`);
    } else {
      console.log(`ℹ️ Order ${orderId} not found in current view`);
    }
  }

  private updateFilteredOrders(): void {
    this.filteredOrders = [...this.allOrders];
    this.applyFilters();
  }

  // Enhanced delete method with WebSocket notification
  async deleteOrdersByFilter() {
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: 'Bạn có chắc chắn muốn xóa tất cả đơn hàng đang hiển thị?' }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result === true) {
        this.isLoading = true;
        let successCount = 0;
        let errorCount = 0;

        // Delete each order in filteredOrders
        for (const order of this.filteredOrders) {
          try {
            // Delete from IndexedDB
            if (this.orderService.deleteOrderFromDB) {
              await this.orderService.deleteOrderFromDB(order.id);
            }
            console.log('Order deleted successfully from IndexedDB');

            // Delete from Firestore
            if (this.orderService.deleteOrderToFirestore) {
              await firstValueFrom(this.orderService.deleteOrderToFirestore(order.id));
            }
            console.info(`Successfully deleted from Firestore: ${order.id}`);

            // Notify other clients (REST/notify) if available
            if (this.orderService.notifyOrderDeleted) {
              await this.orderService.notifyOrderDeleted(order.id);
            }

            successCount++;
          } catch (error: any) {
            console.error('Error deleting order:', error);
            errorCount++;
          }
        }

        // Show summary
        if (successCount > 0) {
          console.log(`✅ Successfully deleted ${successCount} orders`);
        }
        if (errorCount > 0) {
          console.error(`❌ Failed to delete ${errorCount} orders`);
        }

        // Refresh the list
        this.fetchOrdersByDate();
      }
    });
  }

  // Manual sync method with proper locking
  async manualSync(): Promise<void> {
    if (this.isSyncing) {
      console.log('⚠️ Sync already in progress, please wait...');
      return;
    }

    if (this.isLoading) {
      console.log('⚠️ Component is loading, please wait...');
      return;
    }

    console.log('🔄 Manual sync requested...');
    this.isLoading = true;
    try {
      await this.performSync();
      console.log('✅ Manual sync completed successfully');
    } catch (error) {
      console.error('❌ Manual sync failed:', error);
    } finally {
      this.isLoading = false;
    }
  }

  getConnectionStatus(): string {
    return this.orderService.isWebSocketConnected() ? 'Real-time' : 'Offline';
  }

  // Method to trigger sync when needed
  async triggerSyncIfNeeded(): Promise<void> {
    if (!this.isSyncing && !this.isLoading) {
      console.log('🔄 Triggering sync (manual/periodic)...');
      await this.debouncedSync();
    }
  }

  // Check sync status for template
  isCurrentlySyncing(): boolean {
    return this.isSyncing;
  }

  // Get last sync time
  getLastSyncTime(): string {
    if (this.lastSyncTime) {
      const now = new Date();
      const diffMs = now.getTime() - this.lastSyncTime.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) {
        return 'Vừa xong';
      } else if (diffMins < 60) {
        return `${diffMins} phút trước`;
      } else if (diffHours < 24) {
        return `${diffHours} giờ trước`;
      } else if (diffDays < 7) {
        return `${diffDays} ngày trước`;
      } else {
        return this.lastSyncTime.toLocaleDateString('vi-VN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
    return 'Chưa đồng bộ';
  }

  // Filter and search methods
  onDateChange(event: any) {
    if (event.value) {
      this.selectedDate = new Date(event.value);
      this.selectedDate.setHours(0, 0, 0, 0);
    } else {
      this.selectedDate = null;
    }
    // Luôn fetch lại, dù có chọn ngày hay không
    this.fetchOrdersByDate();
  }

  clearFilters() {
    this.selectedDate = null;
    this.searchTerm = '';
    this.searchTermProduct = '';
    this.selectedCustomer = '';
    this.fetchOrdersByDate();
  }

  applyFilters() {
    this.filteredOrders = this.allOrders.filter(order => {
      const matchesSearch = this.searchTerm
        ? String(order.id).toLowerCase().includes(this.searchTerm.toLowerCase()) ||
        (typeof order.customer === 'string' ? order.customer : order.customer?.Name || '').toLowerCase().includes(this.searchTerm.toLowerCase())
        : true;
      const matchesProduct = this.checkProductFilter(order, this.searchTermProduct);
      const matchesCustomer = this.checkCustomerFilter(order);
      this.currentPage = 1;
      return matchesSearch && matchesCustomer && matchesProduct;
    });
  }

  private checkCustomerFilter(order: any): boolean {
    if (!this.selectedCustomer) {
      return true;
    }

    return typeof order.customer === 'string'
      ? order.customer === this.selectedCustomer
      : order.customer?.Name === this.selectedCustomer;
  }

  private checkProductFilter(order: any, searchTerm: string): boolean {
    if (!searchTerm || searchTerm.trim() === '') {
      return true;
    }

    if (!order.cartItems || order.cartItems.length === 0) {
      return false;
    }

    const queryTokens = this.vi.normalizeAndTokenize(searchTerm);
    const queryStr = queryTokens.join(' ').toLowerCase();
    const rawQuery = searchTerm.toLowerCase();

    return order.cartItems.some((item: any) => {
      if (!item.product || !item.product.Name) {
        return false;
      }

      const productName = item.product.Name;
      const productCode = item.product.Code || '';

      // Normalize product name
      const normalizedProductName = this.vi.normalizeAndTokenize(productName).join(' ').toLowerCase();

      // 1. Check if product name starts with search term (highest priority)
      if (normalizedProductName.startsWith(queryStr)) {
        return true;
      }

      // 2. Check if product name contains search term
      if (normalizedProductName.includes(queryStr) || productName.toLowerCase().includes(rawQuery)) {
        return true;
      }

      // 3. Check product code
      const productCodeLower = productCode.toLowerCase();

      // Check if query has format "XXXXXXX-X" (contains dash)
      if (rawQuery.includes('-')) {
        const baseQuery = rawQuery.split('-')[0];
        return productCodeLower === baseQuery;
      }

      return productCodeLower.includes(rawQuery);
    });
  }

  // Formatting methods
  formatPrice(price: number): string {
    return price ? price.toLocaleString('en-US') : '';
  }

  getStatusText(status: string | undefined): string {
    switch (status) {
      case 'pending':
        return 'Chờ xử lý';
      case 'checked':
        return 'Đã xử lý';
      case 'canceled':
        return 'Đã hủy';
      case 'edited':
        return 'Đã chỉnh sửa';
      default:
        return 'Chờ xử lý';
    }
  }

  formatDate(date: string | Date): string {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  formatDateShort(dateStr: string): string {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  // View order details
  viewOrder(order: any) {
    const dialogRef = this.dialog.open(ViewSwlectedOrderDialogComponent, {
      width: '600px',
      data: {
        order: order
      }
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result === true) {
        // Order was deleted
        this.allOrders = this.allOrders.filter(o => o.id !== order.id);
        this.applyFilters();
      }
    });
  }

  // Cancel order
  async cancelOrder(order: any) {
    const dialogRef = this.dialog.open(ConfirmPopupComponent, {
      width: '300px',
      data: { message: `Bạn có chắc chắn muốn hủy đơn hàng ${order.id}?` }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result === true) {
        this.isLoading = true;
        try {
          // Update order status to 'canceled'
          const updateData = { status: 'canceled' };

          // Update in IndexedDB
          const updatedOrder = await this.orderService.getOrderFromDBById(order.id);
          if (updatedOrder) {
            updatedOrder.status = 'canceled';
            await this.orderService.updateOrderInDB(updatedOrder);
          }

          // Notify via WebSocket
          await this.orderService.notifyOrderUpdated({ id: order.id, status: 'canceled' });

          // Update local list
          const orderIndex = this.allOrders.findIndex(o => o.id === order.id);
          if (orderIndex !== -1) {
            this.allOrders[orderIndex].status = 'canceled';
            this.updateFilteredOrders();
          }

          console.log(`✅ Order ${order.id} has been canceled`);
        } catch (error) {
          console.error('❌ Error canceling order:', error);
        } finally {
          this.isLoading = false;
        }
      }
    });
  }

  // Pagination methods
  get totalPages(): number {
    return Math.ceil(this.filteredOrders.length / this.pageSize);
  }

  get pagedOrders(): any[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredOrders.slice(start, start + this.pageSize);
  }

  goToPage(page: number) {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  nextPage() {
    if (this.currentPage < this.totalPages) {
      this.currentPage++;
    }
  }

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
    }
  }

  // Scroll handling for filter visibility
  lastScrollTop = 0;
  hideFilters = false;

  onScroll(event: Event) {
    const target = event.target as HTMLElement;
    const scrollTop = target.scrollTop;

    if (scrollTop > this.lastScrollTop + 10) {
      this.hideFilters = true;
    } else if (scrollTop < this.lastScrollTop - 10 || scrollTop === 0) {
      this.hideFilters = false;
    }

    this.lastScrollTop = scrollTop;
  }
}