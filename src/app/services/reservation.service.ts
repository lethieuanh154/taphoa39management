import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/** Mot don dang giu mot san pham cu the. */
export interface ReservationOrderRef {
  orderId: string;
  customerName: string;
  customerPhone: string;
  quantity: number;
  createdAt: string;
  expiresAt: string;
}

/** San pham dang bi don online giu, kem cac don giu no. */
export interface ReservedProduct {
  productId: string;
  code: string;
  name: string;
  totalReserved: number;
  orders: ReservationOrderRef[];
}

export interface ReservationItem {
  productId: string;
  code: string;
  name: string;
  quantity: number;
}

export interface Reservation {
  orderId: string;
  customerName: string;
  customerPhone: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'expired';
  releasedAt: string | null;
  releaseReason: string | null;
  items: ReservationItem[];
  isExpired?: boolean;
}

/** Ly do nha hang da giu. `checked` = don da thanh hoa don. */
export type ReleaseReason = 'checked' | 'canceled' | 'edited';

/**
 * Giu hang cho don dat online tu DatHang.
 *
 * KHONG dung toi OnHand: so giu hang nam o collection rieng `product_reservations`,
 * vi OnHand bi sync KiotViet ghi de moi lan full reload buoi sang.
 * Xem TapHoa39BackEnd/docs/RESERVATION.md.
 */
@Injectable({ providedIn: 'root' })
export class ReservationService {
  private http = inject(HttpClient);
  private readonly apiUrl = `${environment.domainUrl}/api/reservations`;

  /** Cache map giu hang - tranh goi lai lien tuc khi quet nhieu ma lien tiep. */
  private stockMapCache: Record<string, number> | null = null;
  private stockMapAt = 0;
  private readonly STOCK_MAP_TTL_MS = 30_000;

  /**
   * {productId: so luong dang giu}. Dung de chan thanh toan hang da co don dat.
   * Loi mang -> tra {} (khong chan ban hang vi loi ky thuat).
   */
  async getStockMap(forceRefresh = false): Promise<Record<string, number>> {
    const fresh = Date.now() - this.stockMapAt < this.STOCK_MAP_TTL_MS;
    if (!forceRefresh && this.stockMapCache && fresh) {
      return this.stockMapCache;
    }
    try {
      const res = await firstValueFrom(
        this.http.get<{ reserved: Record<string, number> }>(`${this.apiUrl}/stock-map`)
      );
      this.stockMapCache = res?.reserved || {};
      this.stockMapAt = Date.now();
      return this.stockMapCache;
    } catch (err) {
      console.error('[Reservation] Khong lay duoc stock-map:', err);
      return {};
    }
  }

  /** So luong dang giu cua 1 san pham (doc tu cache neu con han). */
  async getReservedFor(productId: number | string): Promise<number> {
    const map = await this.getStockMap();
    return map[String(productId)] || 0;
  }

  /** Danh sach san pham dang bi giu, gom theo san pham - cho trang quan ly. */
  async getByProduct(): Promise<ReservedProduct[]> {
    const res = await firstValueFrom(
      this.http.get<{ products: ReservedProduct[] }>(`${this.apiUrl}/by-product`)
    );
    return res?.products || [];
  }

  /** Danh sach ban giu hang theo don. */
  async getActive(includeExpired = false): Promise<Reservation[]> {
    const res = await firstValueFrom(
      this.http.get<{ reservations: Reservation[] }>(
        `${this.apiUrl}/active`,
        { params: { includeExpired: String(includeExpired) } }
      )
    );
    return res?.reservations || [];
  }

  /**
   * Nha hang da giu cua 1 don.
   * BAT BUOC goi khi don thanh hoa don (`checked`), neu khong ton kho bi tru HAI LAN:
   * mot lan boi hoa don, mot lan boi ban giu hang con song.
   */
  async release(orderId: string, reason: ReleaseReason): Promise<boolean> {
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean }>(`${this.apiUrl}/release`, { orderId, reason })
      );
      this.invalidateStockMap();
      return !!res?.success;
    } catch (err) {
      console.error(`[Reservation] Nha hang giu cho don ${orderId} that bai:`, err);
      return false;
    }
  }

  /** Danh dau cac ban giu hang qua 24h + set don tuong ung thanh 'expired'. */
  async expireOverdue(): Promise<{ count: number; ordersUpdated: number }> {
    const res = await firstValueFrom(
      this.http.post<{ count: number; ordersUpdated: number }>(`${this.apiUrl}/expire-overdue`, {})
    );
    this.invalidateStockMap();
    return { count: res?.count || 0, ordersUpdated: res?.ordersUpdated || 0 };
  }

  invalidateStockMap(): void {
    this.stockMapCache = null;
    this.stockMapAt = 0;
  }
}
