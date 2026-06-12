import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { IndexedDBService } from '../../../services/indexed-db.service';
import { FuzzyMatchService } from '../../../services/fuzzy-match.service';
import { SALES_DB_NAME, SALES_DB_VERSION } from '../../../services/sales-db.config';
import { environment } from '../../../../environments/environment';

export interface InvoiceProductMapping {
  id: string;                      // `${supplierTaxCode}|${normalizedDescription}`
  supplierTaxCode: string;
  invoiceDescription: string;      // current/latest
  normalizedDescription: string;
  productCode: string;
  productName: string;
  unit: string;
  lastSeen: string;
  createdAt: string;
  previousDescriptions: string[];
}

const STORE = 'invoiceProductMappings';
const API_URL = `${environment.domainUrl}/api/v2/product-mappings`;

@Injectable({ providedIn: 'root' })
export class InvoiceProductMappingService {
  private idb = inject(IndexedDBService);
  private http = inject(HttpClient);
  private fuzzy = inject(FuzzyMatchService);

  normalize(text: string): string {
    return this.fuzzy.normalize(text);
  }

  buildId(supplierTaxCode: string, normalizedDescription: string): string {
    return `${supplierTaxCode}|${normalizedDescription}`;
  }

  /**
   * Get all cached mappings for a supplier.
   * IDB first → if empty, fetch from backend and cache.
   */
  async getMappingsForSupplier(supplierTaxCode: string): Promise<InvoiceProductMapping[]> {
    try {
      const all = await this.idb.getAll<InvoiceProductMapping>(SALES_DB_NAME, SALES_DB_VERSION, STORE);
      const cached = all.filter(m => m.supplierTaxCode === supplierTaxCode);
      if (cached.length > 0) return cached;
    } catch { /* ignore */ }

    // Fetch from backend
    return this.syncFromBackend(supplierTaxCode);
  }

  /**
   * Fetch from backend and persist to IDB.
   */
  async syncFromBackend(supplierTaxCode: string): Promise<InvoiceProductMapping[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; mappings: InvoiceProductMapping[] }>(
          `${API_URL}?supplierTaxCode=${encodeURIComponent(supplierTaxCode)}`
        )
      );
      if (res.success && res.mappings?.length) {
        await this.idb.putMany(SALES_DB_NAME, SALES_DB_VERSION, STORE, res.mappings);
        return res.mappings;
      }
    } catch (e) {
      console.error('[InvoiceProductMapping] syncFromBackend error:', e);
    }
    return [];
  }

  /**
   * Save confirmed matches as mappings (fire-and-forget).
   */
  saveMappings(mappings: InvoiceProductMapping[]): void {
    if (!mappings.length) return;

    const now = new Date().toISOString();
    const withDates = mappings.map(m => ({
      ...m,
      lastSeen: now,
      createdAt: m.createdAt || now,
      previousDescriptions: m.previousDescriptions || [],
    }));

    // Save to IDB
    this.idb.putMany(SALES_DB_NAME, SALES_DB_VERSION, STORE, withDates)
      .catch(e => console.error('[InvoiceProductMapping] IDB save error:', e));

    // Save to backend
    this.http.post<{ success: boolean; saved: number }>(API_URL, withDates)
      .subscribe({ error: e => console.error('[InvoiceProductMapping] BE save error:', e) });
  }

  /**
   * Apply a rename: update IDB entry and notify backend.
   */
  updateRename(oldId: string, newDescription: string, supplierTaxCode: string): void {
    const normalizedNew = this.normalize(newDescription);
    const newId = this.buildId(supplierTaxCode, normalizedNew);

    // Update IDB: read old, delete, write new
    this.idb.getByKey<InvoiceProductMapping>(SALES_DB_NAME, SALES_DB_VERSION, STORE, oldId)
      .then(async existing => {
        if (!existing) return;
        const prev = existing.previousDescriptions || [];
        if (existing.invoiceDescription && !prev.includes(existing.invoiceDescription)) {
          prev.push(existing.invoiceDescription);
        }
        const updated: InvoiceProductMapping = {
          ...existing,
          id: newId,
          invoiceDescription: newDescription,
          normalizedDescription: normalizedNew,
          previousDescriptions: prev,
          lastSeen: new Date().toISOString(),
        };
        await this.idb.delete(SALES_DB_NAME, SALES_DB_VERSION, STORE, oldId);
        await this.idb.put(SALES_DB_NAME, SALES_DB_VERSION, STORE, updated);
      })
      .catch(e => console.error('[InvoiceProductMapping] IDB rename error:', e));

    // Notify backend
    this.http.put(`${API_URL}/rename`, {
      id: oldId,
      newDescription,
      normalizedNew,
    }).subscribe({ error: e => console.error('[InvoiceProductMapping] BE rename error:', e) });
  }

  /**
   * Update unit in cached mapping when user confirms unit change.
   */
  updateUnit(mappingId: string, newUnit: string): void {
    this.idb.getByKey<InvoiceProductMapping>(SALES_DB_NAME, SALES_DB_VERSION, STORE, mappingId)
      .then(async existing => {
        if (!existing) return;
        const updated: InvoiceProductMapping = {
          ...existing,
          unit: newUnit,
          lastSeen: new Date().toISOString(),
        };
        await this.idb.put(SALES_DB_NAME, SALES_DB_VERSION, STORE, updated);
      })
      .catch(e => console.error('[InvoiceProductMapping] IDB unit update error:', e));

    this.http.put(`${API_URL}/unit`, { id: mappingId, newUnit })
      .subscribe({ error: e => console.error('[InvoiceProductMapping] BE unit update error:', e) });
  }
}
