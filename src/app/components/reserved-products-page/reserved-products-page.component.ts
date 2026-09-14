import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ReservationService, ReservedProduct } from '../../services/reservation.service';

/**
 * Tong hop mat hang dang bi don dat online (DatHang) giu cho.
 * Chi doc + don don qua han; khong sua don o day.
 */
@Component({
  selector: 'app-reserved-products-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSnackBarModule
  ],
  templateUrl: './reserved-products-page.component.html',
  styleUrls: ['./reserved-products-page.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReservedProductsPageComponent implements OnInit {
  private reservationService = inject(ReservationService);
  private snackBar = inject(MatSnackBar);
  private cdr = inject(ChangeDetectorRef);

  products: ReservedProduct[] = [];
  filtered: ReservedProduct[] = [];
  searchTerm = '';
  isLoading = false;
  isExpiring = false;
  errorMessage = '';
  expandedId: string | null = null;

  /** Duoi nguong nay coi la sap het han -> to do de nhan vien uu tien xu ly. */
  private readonly SOON_MS = 2 * 60 * 60 * 1000;

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();
    try {
      this.products = await this.reservationService.getByProduct();
      this.applyFilter();
    } catch (err) {
      console.error('[ReservedProducts] Load that bai:', err);
      this.errorMessage = 'Không tải được danh sách hàng đang giữ.';
      this.products = [];
      this.filtered = [];
    }
    this.isLoading = false;
    this.cdr.markForCheck();
  }

  applyFilter(): void {
    const term = this.searchTerm.trim().toLowerCase();
    this.filtered = !term
      ? [...this.products]
      : this.products.filter(p =>
          (p.name || '').toLowerCase().includes(term) ||
          (p.code || '').toLowerCase().includes(term) ||
          p.orders.some(o =>
            (o.customerName || '').toLowerCase().includes(term) ||
            (o.customerPhone || '').includes(term) ||
            (o.orderId || '').toLowerCase().includes(term)
          )
        );
    this.cdr.markForCheck();
  }

  toggleExpand(productId: string): void {
    this.expandedId = this.expandedId === productId ? null : productId;
    this.cdr.markForCheck();
  }

  async expireOverdue(): Promise<void> {
    if (this.isExpiring) return;
    this.isExpiring = true;
    this.cdr.markForCheck();
    try {
      const res = await this.reservationService.expireOverdue();
      this.snackBar.open(
        res.count > 0
          ? `Đã giải phóng ${res.count} đơn quá hạn (${res.ordersUpdated} đơn chuyển sang hết hạn)`
          : 'Không có đơn nào quá hạn',
        'Đóng',
        { duration: 4000 }
      );
      await this.load();
    } catch (err) {
      console.error('[ReservedProducts] Don don qua han that bai:', err);
      this.snackBar.open('Không dọn được đơn quá hạn', 'Đóng', { duration: 4000 });
    }
    this.isExpiring = false;
    this.cdr.markForCheck();
  }

  get totalOrders(): number {
    const ids = new Set<string>();
    for (const p of this.filtered) {
      for (const o of p.orders) ids.add(o.orderId);
    }
    return ids.size;
  }

  get totalQuantity(): number {
    return this.filtered.reduce((sum, p) => sum + (p.totalReserved || 0), 0);
  }

  /** Con lai bao lau truoc khi ban giu hang het han. */
  remainingLabel(expiresAt: string): string {
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (isNaN(ms)) return '—';
    if (ms <= 0) return 'Đã hết hạn';
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return hours > 0 ? `Còn ${hours}h${minutes.toString().padStart(2, '0')}` : `Còn ${minutes} phút`;
  }

  isExpiringSoon(expiresAt: string): boolean {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return !isNaN(ms) && ms > 0 && ms <= this.SOON_MS;
  }

  isExpired(expiresAt: string): boolean {
    const ms = new Date(expiresAt).getTime() - Date.now();
    return !isNaN(ms) && ms <= 0;
  }

  /** SP co bat ky don nao sap het han -> danh dau ca dong. */
  hasUrgentOrder(p: ReservedProduct): boolean {
    return p.orders.some(o => this.isExpiringSoon(o.expiresAt) || this.isExpired(o.expiresAt));
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('vi-VN', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  trackByProduct(_index: number, p: ReservedProduct): string {
    return p.productId;
  }

  trackByOrder(_index: number, o: { orderId: string }): string {
    return o.orderId;
  }
}
