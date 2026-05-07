import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { OrderService } from '../../services/order.service';
import { DeliveryRouteService } from '../../services/delivery-route.service';
import { DeliveryTrackingService } from '../../services/delivery-tracking.service';
import { DeliveryMapComponent } from './delivery-map.component';
import { DeliveryOrder, DeliveryRoute, DeliveryStatus } from '../../models/delivery.model';

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Chờ giao',
  picking: 'Đang lấy hàng',
  picked: 'Đã lấy hàng',
  in_transit: 'Đang đi',
  arrived: 'Đã đến',
  delivered: 'Đã giao',
  failed: 'Thất bại'
};

const STATUS_FLOW: DeliveryStatus[] = ['pending', 'picking', 'picked', 'in_transit', 'arrived', 'delivered'];

@Component({
  selector: 'app-delivery-route-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, DeliveryMapComponent],
  templateUrl: './delivery-route-page.component.html',
  styleUrls: ['./delivery-route-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DeliveryRoutePageComponent implements OnInit, OnDestroy {
  @ViewChild(DeliveryMapComponent) mapComponent!: DeliveryMapComponent;

  selectedDate = '';
  driverName = '';
  startTime = '09:00';
  orders: DeliveryOrder[] = [];
  route: DeliveryRoute | null = null;
  isLoading = false;
  activeOrderIndex = -1;
  isRouteActive = false;

  readonly statusLabels = STATUS_LABELS;
  private destroy$ = new Subject<void>();

  constructor(
    private orderService: OrderService,
    private routeService: DeliveryRouteService,
    private trackingService: DeliveryTrackingService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const today = new Date();
    this.selectedDate = today.toISOString().split('T')[0];
    this.driverName = localStorage.getItem('delivery_driver_name') || '';

    // Listen for real-time order updates
    this.orderService.orderCreated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (!this.isRouteActive) this.loadOrders();
    });
    this.orderService.orderUpdated$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      if (!this.isRouteActive) this.loadOrders();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.trackingService.disconnectAll();
  }

  get totalDistance(): number {
    return this.route?.totalDistanceKm ?? this.routeService.totalRouteDistance(this.orders);
  }

  get totalDuration(): number {
    return this.route?.estimatedDurationMinutes ?? 0;
  }

  get deliveredCount(): number {
    return this.orders.filter(o => o.status === 'delivered').length;
  }

  get allDelivered(): boolean {
    return this.orders.length > 0 && this.orders.every(o => o.status === 'delivered');
  }

  async loadOrders(): Promise<void> {
    if (!this.selectedDate) return;
    this.isLoading = true;
    this.cdr.markForCheck();

    try {
      const date = new Date(this.selectedDate);
      let rawOrders = await this.orderService.getOrdersByDeliveryDateFromDB(date);

      if (!rawOrders.length) {
        const apiOrders = await firstValueFrom(
          this.orderService.getOrdersByDeliveryDateFromAPI(this.selectedDate)
        );
        for (const order of apiOrders) {
          await this.orderService.addOrderToDB(order);
        }
        rawOrders = apiOrders;
      }

      this.orders = this.routeService.ordersToDeliveryOrders(
        rawOrders.filter(o => o.wantDelivery && o.status !== 'canceled')
      );
      this.route = null;
      this.isRouteActive = false;
      this.activeOrderIndex = -1;
    } catch (e) {
      console.error('Load orders error:', e);
    }

    this.isLoading = false;
    this.cdr.markForCheck();
  }

  onDateChange(): void {
    this.loadOrders();
  }

  onDriverNameChange(): void {
    localStorage.setItem('delivery_driver_name', this.driverName);
  }

  optimizeRoute(): void {
    if (!this.orders.length) return;
    this.orders = this.routeService.optimizeRoute(this.orders);
    this.route = this.routeService.buildRoute(
      this.orders, this.selectedDate, this.driverName, this.startTime
    );
    this.orders = this.route.orders;
    this.cdr.markForCheck();
  }

  onDrop(event: CdkDragDrop<DeliveryOrder[]>): void {
    if (this.isRouteActive) return;
    moveItemInArray(this.orders, event.previousIndex, event.currentIndex);
    // Recalc sequences and distances
    this.orders = this.routeService.optimizeRoute(
      // Pass through with forced order (skip NN, just recalc distances)
      this.orders.map((o, i) => ({ ...o, sequence: i + 1 }))
    );
    if (this.route) {
      this.route = { ...this.route, orders: this.orders, optimized: false };
    }
    this.cdr.markForCheck();
  }

  async startDelivery(): Promise<void> {
    if (!this.orders.length || !this.driverName.trim()) return;

    if (!this.route) {
      this.optimizeRoute();
    }
    this.route = { ...this.route!, status: 'active' };
    this.isRouteActive = true;
    this.activeOrderIndex = 0;

    // Publish tracking docs to Firestore
    const polyline = this.mapComponent?.getRoutePolyline() || [];
    await this.trackingService.publishRouteTracking(this.route, polyline);

    this.cdr.markForCheck();
  }

  async advanceStatus(index: number): Promise<void> {
    const order = this.orders[index];
    const currentIdx = STATUS_FLOW.indexOf(order.status);
    if (currentIdx < 0 || currentIdx >= STATUS_FLOW.length - 1) return;

    const nextStatus = STATUS_FLOW[currentIdx + 1];
    this.orders = this.orders.map((o, i) =>
      i === index ? { ...o, status: nextStatus } : o
    );

    // Update active index to first non-delivered order
    this.activeOrderIndex = this.orders.findIndex(o => o.status !== 'delivered');

    // Update Firestore tracking
    await this.trackingService.updateOrderStatus(order.orderId, nextStatus);

    // Check if all delivered
    if (this.allDelivered && this.route) {
      this.route = { ...this.route, status: 'completed' };
      this.isRouteActive = false;
    }

    this.cdr.markForCheck();
  }

  markFailed(index: number): void {
    this.orders = this.orders.map((o, i) =>
      i === index ? { ...o, status: 'failed' as DeliveryStatus } : o
    );
    this.trackingService.updateOrderStatus(this.orders[index].orderId, 'failed');
    this.cdr.markForCheck();
  }

  selectOrder(index: number): void {
    this.activeOrderIndex = index;
    this.cdr.markForCheck();
  }

  getNextStatusLabel(status: DeliveryStatus): string {
    const idx = STATUS_FLOW.indexOf(status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return '';
    return STATUS_LABELS[STATUS_FLOW[idx + 1]];
  }

  async completeRoute(): Promise<void> {
    if (this.route) {
      await this.trackingService.clearTracking(this.route.id);
      this.route = { ...this.route, status: 'completed' };
      this.isRouteActive = false;
      this.cdr.markForCheck();
    }
  }

  formatPrice(n: number): string {
    return n.toLocaleString('vi-VN');
  }
}
