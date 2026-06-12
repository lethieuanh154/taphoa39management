import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap, catchError, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ProductChangeHistory,
  ProductChangeRecord,
  FIELD_LABELS,
  TRACKED_FIELDS,
  TrackedField,
  HistoryTag
} from '../models/product-history.model';

const API_URL = `${environment.domainUrl}/api/product-history`;

@Injectable({
  providedIn: 'root'
})
export class ProductHistoryService {
  // Cache local để hiển thị nhanh, nhưng source of truth là API
  private cache: Map<number, ProductChangeRecord[]> = new Map();

  constructor(private http: HttpClient) {}

  /**
   * Lấy records từ API (đồng bộ giữa các máy)
   */
  getRecordsFromApi(productId: number): Observable<ProductChangeRecord[]> {
    return this.http.get<ProductChangeHistory>(`${API_URL}/${productId}`).pipe(
      map(data => {
        const records = (data.records || []) as ProductChangeRecord[];
        // Sort newest first
        records.sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        this.cache.set(productId, records);
        return records;
      }),
      catchError(err => {
        console.error('Error fetching product history from API:', err);
        return of(this.cache.get(productId) || []);
      })
    );
  }

  /**
   * Lấy records từ cache (cho hiển thị nhanh - fallback)
   */
  getRecords(productId: number): ProductChangeRecord[] {
    return this.cache.get(productId) || [];
  }

  /**
   * Check if a field is tracked
   */
  isTrackedField(field: string): field is TrackedField {
    return TRACKED_FIELDS.includes(field as TrackedField);
  }

  /**
   * Record a change - lưu lên API
   */
  recordChange(
    productId: number,
    productCode: string,
    productName: string,
    field: TrackedField,
    oldValue: string | number,
    newValue: string | number,
    changedBy?: string,
    tag?: HistoryTag
  ): void {
    if (oldValue === newValue) return;

    const record: ProductChangeRecord = {
      timestamp: new Date().toISOString(),
      field,
      fieldLabel: FIELD_LABELS[field] || field,
      oldValue,
      newValue,
      changedBy,
      ...(tag ? { tag } : {})
    };

    // Update local cache immediately
    const cached = this.cache.get(productId) || [];
    cached.unshift(record);
    this.cache.set(productId, cached);

    // Gửi lên API
    this.http.post(`${API_URL}/${productId}`, {
      productCode,
      productName,
      records: [record]
    }).pipe(
      catchError(err => {
        console.error('Error saving product history to API:', err);
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Record multiple changes at once
   */
  recordChanges(
    productId: number,
    productCode: string,
    productName: string,
    changes: { field: TrackedField; oldValue: string | number; newValue: string | number }[],
    changedBy?: string,
    tag?: HistoryTag
  ): void {
    const now = new Date().toISOString();
    const records: ProductChangeRecord[] = [];

    for (const change of changes) {
      if (change.oldValue === change.newValue) continue;
      records.push({
        timestamp: now,
        field: change.field,
        fieldLabel: FIELD_LABELS[change.field] || change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        changedBy,
        ...(tag ? { tag } : {})
      });
    }

    if (records.length === 0) return;

    // Update local cache immediately
    const cached = this.cache.get(productId) || [];
    this.cache.set(productId, [...records, ...cached]);

    // Gửi lên API
    this.http.post(`${API_URL}/${productId}`, {
      productCode,
      productName,
      records
    }).pipe(
      catchError(err => {
        console.error('Error saving product history to API:', err);
        return of(null);
      })
    ).subscribe();
  }

  /**
   * Compare two product states and record differences
   */
  compareAndRecord(
    productId: number,
    productCode: string,
    productName: string,
    oldProduct: any,
    newProduct: any,
    changedBy?: string,
    tag?: HistoryTag
  ): void {
    const changes: { field: TrackedField; oldValue: string | number; newValue: string | number }[] = [];

    for (const field of TRACKED_FIELDS) {
      const oldValue = this.normalizeValue(oldProduct[field]);
      const newValue = this.normalizeValue(newProduct[field]);

      if (oldValue !== newValue) {
        changes.push({ field, oldValue, newValue });
      }
    }

    if (changes.length > 0) {
      this.recordChanges(productId, productCode, productName, changes, changedBy, tag);
    }
  }

  private normalizeValue(value: any): string | number {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') return value;
    return String(value);
  }

  /**
   * Clear history - xóa trên API
   */
  clearHistory(productId: number): Observable<any> {
    this.cache.delete(productId);
    return this.http.delete(`${API_URL}/${productId}`).pipe(
      catchError(err => {
        console.error('Error clearing product history:', err);
        return of(null);
      })
    );
  }
}
