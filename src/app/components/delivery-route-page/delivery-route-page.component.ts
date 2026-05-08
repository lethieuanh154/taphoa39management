import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { Subject, firstValueFrom, takeUntil } from 'rxjs';
import { OrderService } from '../../services/order.service';
import { DeliveryRouteService } from '../../services/delivery-route.service';
import { DeliveryTrackingService } from '../../services/delivery-tracking.service';
import { EmployeeService, Employee } from '../../services/employee.service';
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
  driverSuggestions: Employee[] = [];
  showDriverDropdown = false;

  readonly statusLabels = STATUS_LABELS;
  private destroy$ = new Subject<void>();
  private watchId: number | null = null;

  constructor(
    private orderService: OrderService,
    private routeService: DeliveryRouteService,
    private trackingService: DeliveryTrackingService,
    private employeeService: EmployeeService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const today = new Date();
    const y = today.getFullYear();
    const mo = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    this.selectedDate = `${y}-${mo}-${d}`;
    this.driverName = localStorage.getItem('delivery_driver_name') || '';
    this.loadState();
    this.employeeService.loadEmployeesWithSync();

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
    this.stopGpsTracking();
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
      console.log(`[Delivery] DB match "${this.selectedDate}":`, rawOrders.length, rawOrders.map(o => ({ id: o.id, desiredDeliveryDate: o.desiredDeliveryDate, wantDelivery: o.wantDelivery, lat: o.lat, lng: o.lng, status: o.status })));

      if (!rawOrders.length) {
        const apiOrders = await firstValueFrom(
          this.orderService.getOrdersByDeliveryDateFromAPI(this.selectedDate)
        );
        console.log(`[Delivery] API fallback:`, apiOrders.length);
        for (const order of apiOrders) {
          await this.orderService.addOrderToDB(order);
        }
        rawOrders = apiOrders;
      }

      const filtered = rawOrders.filter(o => o.wantDelivery && o.status !== 'canceled');
      console.log(`[Delivery] After wantDelivery filter:`, filtered.length, filtered.map(o => ({ id: o.id, totalPrice: o.totalPrice })));
      this.orders = this.routeService.ordersToDeliveryOrders(filtered);
      console.log(`[Delivery] Final orders:`, this.orders.length, this.orders.map(o => ({ id: o.orderId, totalPrice: o.totalPrice })));
      this.route = null;
      this.isRouteActive = false;
      this.activeOrderIndex = -1;
      this.saveState();
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
    this.showDriverDropdown = false;
  }

  onDriverInput(): void {
    const term = this.driverName.toLowerCase().trim();
    const employees = this.employeeService.getActiveEmployees();
    this.driverSuggestions = term
      ? employees.filter(e => e.hoTen.toLowerCase().includes(term))
      : employees;
    this.showDriverDropdown = this.driverSuggestions.length > 0;
    this.cdr.markForCheck();
  }

  onDriverFocus(): void {
    this.driverSuggestions = this.employeeService.getActiveEmployees();
    this.showDriverDropdown = this.driverSuggestions.length > 0;
    this.cdr.markForCheck();
  }

  selectDriver(emp: Employee): void {
    this.driverName = emp.hoTen;
    this.showDriverDropdown = false;
    localStorage.setItem('delivery_driver_name', this.driverName);
    this.cdr.markForCheck();
  }

  hideDriverDropdown(): void {
    setTimeout(() => {
      this.showDriverDropdown = false;
      this.cdr.markForCheck();
    }, 200);
  }

  get totalOrdersPrice(): number {
    return this.orders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
  }

  async optimizeRoute(): Promise<void> {
    if (!this.orders.length) return;
    this.isLoading = true;
    this.cdr.markForCheck();
    this.orders = await this.routeService.optimizeRoute(this.orders);
    this.route = this.routeService.buildRoute(
      this.orders, this.selectedDate, this.driverName, this.startTime
    );
    this.orders = this.route.orders;
    this.isLoading = false;
    this.saveState();
    this.cdr.markForCheck();
  }

  onDrop(event: CdkDragDrop<DeliveryOrder[]>): void {
    if (this.isRouteActive) return;
    moveItemInArray(this.orders, event.previousIndex, event.currentIndex);
    this.orders = this.routeService.recalcOrder(
      this.orders.map((o, i) => ({ ...o, sequence: i + 1 }))
    );
    if (this.route) {
      this.route = { ...this.route, orders: this.orders, optimized: false };
    }
    this.saveState();
    this.cdr.markForCheck();
  }

  async startDelivery(): Promise<void> {
    if (!this.orders.length || !this.driverName.trim()) return;

    if (!this.route) {
      await this.optimizeRoute();
    }
    this.route = { ...this.route!, orders: this.orders, status: 'active' };
    this.isRouteActive = true;
    this.activeOrderIndex = 0;

    const polyline = this.mapComponent?.getRoutePolyline() || [];
    await this.trackingService.publishRouteTracking(this.route, polyline);
    this.startGpsTracking();

    this.saveState();
    this.cdr.markForCheck();
  }

  async markDelivered(index: number): Promise<void> {
    const order = this.orders[index];
    this.orders = this.orders.map((o, i) =>
      i === index ? { ...o, status: 'delivered' as DeliveryStatus } : o
    );
    this.activeOrderIndex = this.orders.findIndex(o => o.status !== 'delivered');
    await this.trackingService.updateOrderStatus(order.orderId, 'delivered');
    firstValueFrom(this.orderService.updateOrderToFirestore(order.orderId, { status: 'checked' })).catch(() => {});
    const raw = await this.orderService.getOrderFromDBById(order.orderId);
    if (raw) await this.orderService.updateOrderInDB({ ...raw, status: 'checked' });
    if (this.allDelivered && this.route) {
      this.route = { ...this.route, status: 'completed' };
      this.isRouteActive = false;
      this.stopGpsTracking();
    }
    this.saveState();
    this.cdr.markForCheck();
  }

  async markFailed(index: number): Promise<void> {
    const orderId = this.orders[index].orderId;
    this.orders = this.orders.map((o, i) =>
      i === index ? { ...o, status: 'failed' as DeliveryStatus } : o
    );
    this.trackingService.updateOrderStatus(orderId, 'failed');
    firstValueFrom(this.orderService.updateOrderToFirestore(orderId, { status: 'canceled' })).catch(() => {});
    const raw = await this.orderService.getOrderFromDBById(orderId);
    if (raw) await this.orderService.updateOrderInDB({ ...raw, status: 'canceled' });
    this.saveState();
    this.cdr.markForCheck();
  }

  removeOrder(index: number): void {
    this.orders = this.orders
      .filter((_, i) => i !== index)
      .map((o, i) => ({ ...o, sequence: i + 1 }));
    if (this.route) this.route = { ...this.route, orders: this.orders };
    this.saveState();
    this.cdr.markForCheck();
  }

  selectOrder(index: number): void {
    this.activeOrderIndex = index;
    this.cdr.markForCheck();
  }

  async completeRoute(): Promise<void> {
    if (this.route) {
      await this.trackingService.clearTracking(this.route.id);
      this.route = { ...this.route, status: 'completed' };
      this.isRouteActive = false;
      this.stopGpsTracking();
      this.cdr.markForCheck();
    }
  }

  private startGpsTracking(): void {
    if (!navigator.geolocation || this.watchId !== null) return;
    this.watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        if (this.activeOrderIndex < 0) return;
        const activeOrder = this.orders[this.activeOrderIndex];
        if (activeOrder && activeOrder.status !== 'delivered' && activeOrder.status !== 'failed') {
          this.trackingService.updateOrderStatus(activeOrder.orderId, activeOrder.status, {
            driverLat: coords.latitude, driverLng: coords.longitude
          });
        }
      },
      (err) => console.warn('[GPS]', err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }

  private stopGpsTracking(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem('delivery_route_state', JSON.stringify({
        selectedDate: this.selectedDate,
        driverName: this.driverName,
        startTime: this.startTime,
        orders: this.orders,
        route: this.route,
        isRouteActive: this.isRouteActive,
        activeOrderIndex: this.activeOrderIndex
      }));
    } catch {}
  }

  private loadState(): void {
    try {
      const raw = localStorage.getItem('delivery_route_state');
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.selectedDate) this.selectedDate = s.selectedDate;
      if (s.driverName) this.driverName = s.driverName;
      if (s.startTime) this.startTime = s.startTime;
      if (s.orders?.length) {
        this.orders = s.orders;
        this.route = s.route ?? null;
        this.isRouteActive = s.isRouteActive ?? false;
        this.activeOrderIndex = s.activeOrderIndex ?? -1;
      }
    } catch {}
  }

  formatPrice(n: number): string {
    return n.toLocaleString('vi-VN');
  }
}
