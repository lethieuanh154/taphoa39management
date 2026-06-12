import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Promotion } from '../models/promotion.model';
import { IndexedDBService } from './indexed-db.service';
import { SALES_DB_NAME, SALES_DB_VERSION } from './sales-db.config';

@Injectable({
  providedIn: 'root'
})
export class PromotionService {
  private get baseUrl(): string {
    return `${environment.domainUrl}/api/firebase/promotions`;
  }

  private dbName = SALES_DB_NAME;
  private dbVersion = SALES_DB_VERSION;
  private storeName = 'promotions';

  constructor(
    private http: HttpClient,
    private indexedDBService: IndexedDBService
  ) {}

  private async ensureStore(): Promise<void> {
    await this.indexedDBService.initSalesDB();
  }

  // ── API methods ──

  getAllPromotions(includeDisabled = true): Observable<Promotion[]> {
    return this.http.get<Promotion[]>(
      `${this.baseUrl}?include_disabled=${includeDisabled}`
    );
  }

  getActivePromotions(): Observable<Promotion[]> {
    return this.http.get<Promotion[]>(`${this.baseUrl}/active`);
  }

  getPromotion(id: string): Observable<Promotion> {
    return this.http.get<Promotion>(`${this.baseUrl}/${id}`);
  }

  getPromotionsForProduct(productId: string): Observable<Promotion[]> {
    return this.http.get<Promotion[]>(`${this.baseUrl}/by-product/${productId}`);
  }

  createPromotion(data: Partial<Promotion>): Observable<any> {
    return this.http.post(this.baseUrl, data);
  }

  updatePromotion(id: string, data: Partial<Promotion>): Observable<any> {
    return this.http.put(`${this.baseUrl}/${id}`, data);
  }

  deletePromotion(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/${id}`);
  }

  togglePromotion(id: string, enabled: boolean): Observable<any> {
    return this.http.put(`${this.baseUrl}/${id}/toggle`, { isEnabled: enabled });
  }

  // ── IndexedDB cache methods ──

  /** Lưu danh sách promotions vào IndexedDB cache */
  async cachePromotions(promos: Promotion[]): Promise<void> {
    try {
      await this.ensureStore();
      await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
      if (promos.length > 0) {
        await this.indexedDBService.putMany<Promotion>(this.dbName, this.dbVersion, this.storeName, promos);
      }
    } catch (e) {
      console.error('Failed to cache promotions to IndexedDB:', e);
    }
  }

  /** Đọc promotions từ IndexedDB cache */
  async getCachedPromotions(): Promise<Promotion[]> {
    try {
      await this.ensureStore();
      return await this.indexedDBService.getAll<Promotion>(this.dbName, this.dbVersion, this.storeName);
    } catch (e) {
      console.error('Failed to read cached promotions:', e);
      return [];
    }
  }

  /** Clear cache */
  async clearCache(): Promise<void> {
    try {
      await this.ensureStore();
      await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
    } catch (e) {
      console.error('Failed to clear promotions cache:', e);
    }
  }
}
