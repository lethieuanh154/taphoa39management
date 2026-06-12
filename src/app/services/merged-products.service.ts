import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, Subscription, firstValueFrom } from 'rxjs';
import { MergedProductItem } from '../models/merged-product.model';
import { CartItem } from '../models/cart-item.model';
import { InvoiceTab } from '../models/invoice.model';
import { environment } from '../../environments/environment';
import { WebSocketRealtimeService, MergedProductsUpdatedPayload } from './websocket-realtime.service';
import { IndexedDBService } from './indexed-db.service';
import { AutoMergeHistoryEntry } from '../components/merged-product-page/merged-product-page.component';

// Auto-merge history DB (shared with merged-product-page)
const TOP_PRODUCTS_DB_NAME = 'TopProductsDailyDB';
const TOP_PRODUCTS_DB_VERSION = 2;
const AUTO_MERGE_HISTORY_STORE = 'auto_merge_history';

const STORAGE_KEY = 'merged_products';
const STOCK_STATUS_STORAGE_KEY = 'merged_products_stock_status';
const AUDIT_LAST_DATE_KEY = 'merged_products_audit_last_date';
const AUDIT_DB_NAME = 'MergedProductsAuditDB';
const AUDIT_DB_VERSION = 1;
const AUDIT_STORE_NAME = 'audit';

// Offline pending queue constants
const PENDING_DB_NAME = 'MergedProductsPendingDB';
const PENDING_DB_VERSION = 1;
const PENDING_STORE_NAME = 'pending_ops';
const PENDING_RETRY_INTERVAL = 30_000; // 30s auto-retry

interface SyncResponse {
  success: boolean;
  items?: MergedProductItem[];
  count?: number;
  lastModified?: string;
  error?: string;
}

export interface StockStatus {
  kvOnHand: number;
  requiredQty: number;
  sufficient: boolean;
}

export interface AuditRecord {
  id: string;
  mergedItemId: string;
  invoiceId: string;
  productIds: number[];
  action: 'checked-out' | 'deleted' | 'updated';
  actionBy: string;
  actionAt: string;
  kvInvoiceId?: string;
}

export interface PendingOperation {
  id: string;
  type: 'add' | 'remove' | 'atomic-update' | 'full-replace' | 'clear';
  payload: any;
  createdAt: string;
  retryCount: number;
}

/**
 * Service quản lý "Các Sản Phẩm Gộp"
 * Lưu trữ các products gốc (KiotViet) được tách ra khi checkout với GỘP=ON
 * Hỗ trợ sync real-time qua WebSocket giữa các máy
 */
@Injectable({
  providedIn: 'root'
})
export class MergedProductsService {
  private itemsSubject = new BehaviorSubject<MergedProductItem[]>([]);
  public items$: Observable<MergedProductItem[]> = this.itemsSubject.asObservable();

  // Sync state
  private syncingSubject = new BehaviorSubject<boolean>(false);
  public syncing$ = this.syncingSubject.asObservable();
  private lastSyncTime: string | null = null;

  // Stock status cache (persists across dialog open/close)
  private stockStatusMap = new Map<number, StockStatus>();

  // Shared state (thay thế MAT_DIALOG_DATA cho merged-product-page)
  private groupedProductsSubject = new BehaviorSubject<Record<number, any[]>>({});
  public groupedProducts$ = this.groupedProductsSubject.asObservable();

  private currentUserEmailSubject = new BehaviorSubject<string>('');

  private refreshProductsNeededSubject = new BehaviorSubject<boolean>(false);
  public refreshProductsNeeded$ = this.refreshProductsNeededSubject.asObservable();

  private readonly apiUrl = `${environment.domainUrl}/api/firebase/merged-products`;
  private readonly auditApiUrl = `${environment.domainUrl}/api/merged-products-audit`;

  // Flag to prevent re-processing our own WebSocket echoes
  private ignoreWsCount = 0;

  // Flag to block WebSocket updates during fullSync
  private isSyncingFull = false;

  // Flag to block WebSocket updates while dialog is open (user is actively managing items)
  private isDialogOpen = false;

  // Queue WebSocket updates received while dialog is open, apply on close
  private pendingWsPayload: MergedProductsUpdatedPayload | null = null;

  private wsSubscription: Subscription | null = null;

  // Offline pending queue
  private pendingCountSubject = new BehaviorSubject<number>(0);
  public pendingCount$ = this.pendingCountSubject.asObservable();
  private pendingRetryTimer: any = null;
  private isProcessingPending = false;

  constructor(
    private http: HttpClient,
    private webSocketRealtimeService: WebSocketRealtimeService,
    private indexedDBService: IndexedDBService
  ) {
    this.loadFromStorage();
    this.loadStockStatusFromStorage();
    this.subscribeToWebSocket();
    this.checkAndClearOldAudit();
    this.initPendingQueue();
  }

  /**
   * Subscribe vào WebSocket event để nhận real-time updates từ máy khác
   */
  private subscribeToWebSocket(): void {
    this.wsSubscription = this.webSocketRealtimeService.getMergedProductsUpdated$().subscribe(
      (payload: MergedProductsUpdatedPayload) => {
        // Skip our own echoed updates
        if (this.ignoreWsCount > 0) {
          this.ignoreWsCount--;
          console.log(`ℹ️ [MergedProducts] Ignored own WebSocket echo (remaining: ${this.ignoreWsCount})`);
          return;
        }

        // Block WebSocket updates during fullSync to prevent race condition
        if (this.isSyncingFull) {
          console.log('ℹ️ [MergedProducts] Ignored WebSocket update during fullSync');
          return;
        }

        // Block WebSocket updates during auto-merge from main-page
        if (this.isAutoMerging) {
          console.log('ℹ️ [MergedProducts] Ignored WebSocket update during auto-merge');
          return;
        }

        // Smart merge when dialog is open:
        // - If remote has FEWER items (items removed/processed by other machine) → apply immediately
        // - If remote has MORE or SAME items → queue (user may be actively editing)
        if (this.isDialogOpen) {
          const remoteItems = payload.items || [];
          const localCount = this.itemsSubject.value.length;
          if (remoteItems.length < localCount) {
            // Items were removed by another machine → apply immediately so user sees fresh state
            console.log(`📥 [MergedProducts] Dialog open but applying WS update: remote ${remoteItems.length} < local ${localCount} (items removed by ${payload.modifiedBy})`);
            this.ensureMergedIds(remoteItems);
            this.itemsSubject.next(remoteItems);
            this.saveToStorageOnly();
            this.lastSyncTime = payload.lastModified;
          } else {
            this.pendingWsPayload = payload; // Keep only latest
            console.log('ℹ️ [MergedProducts] Queued WebSocket update while dialog is open');
          }
          return;
        }

        console.log(`📥 [MergedProducts] Real-time update received: ${payload.count} items from ${payload.modifiedBy}`);

        const remoteItems = payload.items || [];
        const localCount = this.itemsSubject.value.length;

        // Safety guard: nếu remote gửi 0 items nhưng local đang có nhiều items,
        // log cảnh báo để debug (vẫn apply vì remote là source of truth)
        if (remoteItems.length === 0 && localCount > 0) {
          console.warn(`⚠️ [MergedProducts] WebSocket cleared ${localCount} local items (remote sent 0 items from ${payload.modifiedBy})`);
        }

        // Replace local data with remote data (remote is source of truth)
        this.ensureMergedIds(remoteItems);
        this.itemsSubject.next(remoteItems);
        this.saveToStorageOnly(); // Save to localStorage without triggering push
        this.lastSyncTime = payload.lastModified;
      }
    );
  }

  /**
   * Load items từ localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const items = JSON.parse(stored) as MergedProductItem[];
        this.ensureMergedIds(items);
        this.itemsSubject.next(items);
      }
    } catch (err) {
      console.error('❌ Error loading merged products from storage:', err);
      this.itemsSubject.next([]);
    }
  }

  /**
   * Save items to localStorage only (no push to server)
   */
  private saveToStorageOnly(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.itemsSubject.value));
    } catch (err) {
      console.error('❌ Error saving merged products to storage:', err);
    }
  }

  /**
   * Save items to localStorage only (no Firebase push).
   * Use atomic methods (pushAddToFirebase, pushRemoveToFirebase, pushAtomicUpdate) instead.
   */
  private saveToStorage(): void {
    this.saveToStorageOnly();
  }

  // ============= ATOMIC FIREBASE OPERATIONS =============
  // These read current Firestore state on the server, preventing stale overwrites

  /**
   * Atomic add: POST single item to backend /add endpoint.
   * Backend reads current Firestore list, appends item, saves back.
   * Prevents stale local state from overwriting other machines' changes.
   */
  private async pushAddToFirebase(item: MergedProductItem): Promise<void> {
    const payload = { item, modifiedBy: 'auto-sync' };
    this.ignoreWsCount++;
    try {
      await firstValueFrom(
        this.http.post<SyncResponse>(`${this.apiUrl}/add`, payload)
      );
      console.log(`✅ [MergedProducts] Atomic add: ${item.id}`);
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Atomic add failed, queuing offline:', err);
      await this.addToPendingQueue({
        id: `pending_add_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: 'add',
        payload,
        createdAt: new Date().toISOString(),
        retryCount: 0
      });
    }
  }

  /**
   * Atomic remove: POST item IDs to backend /remove endpoint.
   * Backend reads current Firestore list, filters out IDs, saves back.
   */
  private async pushRemoveToFirebase(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const payload = { itemIds, modifiedBy: 'auto-sync' };
    this.ignoreWsCount++;
    try {
      await firstValueFrom(
        this.http.post<SyncResponse>(`${this.apiUrl}/remove`, payload)
      );
      console.log(`✅ [MergedProducts] Atomic remove: ${itemIds.length} items`);
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Atomic remove failed, queuing offline:', err);
      await this.addToPendingQueue({
        id: `pending_remove_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: 'remove',
        payload,
        createdAt: new Date().toISOString(),
        retryCount: 0
      });
    }
  }

  /**
   * Atomic update: remove some items + update others in one Firestore operation.
   * Used after KiotViet checkout where some items are fully removed and others partially updated.
   */
  async pushAtomicUpdate(removeIds: string[], updates: MergedProductItem[]): Promise<void> {
    if (removeIds.length === 0 && updates.length === 0) return;
    const payload = { removeIds, updates, modifiedBy: 'auto-sync' };
    this.ignoreWsCount++;
    try {
      await firstValueFrom(
        this.http.post<SyncResponse>(`${this.apiUrl}/atomic-update`, payload)
      );
      console.log(`✅ [MergedProducts] Atomic update: removed ${removeIds.length}, updated ${updates.length}`);
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Atomic update failed, queuing offline:', err);
      await this.addToPendingQueue({
        id: `pending_atomic_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: 'atomic-update',
        payload,
        createdAt: new Date().toISOString(),
        retryCount: 0
      });
    }
  }

  /**
   * Full replace push (legacy fallback). Use sparingly — prefer atomic operations.
   */
  private async pushFullReplace(): Promise<void> {
    this.ignoreWsCount++;
    try {
      const items = this.itemsSubject.value;
      await firstValueFrom(
        this.http.post<SyncResponse>(this.apiUrl, {
          items,
          modifiedBy: 'auto-sync'
        })
      );
      console.log(`✅ [MergedProducts] Full replace push: ${items.length} items`);
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Full replace push failed:', err);
    }
  }

  /**
   * Push current items to Firebase immediately (no debounce).
   * Dùng cho critical operations (sau khi checkout KiotViet thành công)
   * để đảm bảo các máy khác nhận được update ngay lập tức.
   * @deprecated Prefer pushAtomicUpdate for checkout operations
   */
  async pushToFirebaseImmediate(): Promise<void> {
    console.log('📤 [MergedProducts] IMMEDIATE push to Firebase...');
    const items = this.itemsSubject.value;
    this.ignoreWsCount++;

    try {
      await firstValueFrom(
        this.http.post<SyncResponse>(this.apiUrl, {
          items,
          modifiedBy: 'auto-sync'
        })
      );
      console.log(`✅ [MergedProducts] Immediate push done: ${items.length} items synced to Firebase`);
    } catch (err) {
      console.error('❌ [MergedProducts] Immediate push to Firebase FAILED:', err);
      throw err; // Re-throw so caller knows and can show error
    }
  }

  /**
   * Get current items
   */
  getItems(): MergedProductItem[] {
    return this.itemsSubject.value;
  }

  /**
   * Re-emit current items to trigger subscribers (e.g. after in-place mutation).
   * Optionally pass a new items array to replace current state.
   */
  refreshLocalItems(items?: MergedProductItem[]): void {
    this.itemsSubject.next(items ? [...items] : [...this.itemsSubject.value]);
    this.saveToStorageOnly();
  }

  /**
   * Block/unblock WebSocket updates while merged-products dialog is open.
   * Prevents remote updates from changing the list while user is actively managing items.
   * On close: auto-sync from Firebase to ensure local state is fresh.
   */
  // --- Shared state getters/setters (cho merged-product-page) ---

  setGroupedProducts(gp: Record<number, any[]>): void {
    this.groupedProductsSubject.next(gp);
  }

  getGroupedProducts(): Record<number, any[]> {
    return this.groupedProductsSubject.getValue();
  }

  setCurrentUserEmail(email: string): void {
    this.currentUserEmailSubject.next(email);
  }

  getCurrentUserEmail(): string {
    return this.currentUserEmailSubject.getValue();
  }

  triggerRefreshProducts(): void {
    this.refreshProductsNeededSubject.next(true);
  }

  clearRefreshProducts(): void {
    this.refreshProductsNeededSubject.next(false);
  }

  setDialogOpen(open: boolean): void {
    this.isDialogOpen = open;
    if (open) {
      console.log('🔒 [MergedProducts] Dialog opened - WebSocket updates queued');
    } else {
      console.log('🔓 [MergedProducts] Dialog closed - syncing from Firebase...');
      // Apply queued WebSocket update if any, otherwise pull from Firebase
      if (this.pendingWsPayload) {
        const payload = this.pendingWsPayload;
        this.pendingWsPayload = null;
        console.log(`📥 [MergedProducts] Applying queued WebSocket update: ${payload.count} items`);
        const remoteItems = payload.items || [];
        this.ensureMergedIds(remoteItems);
        this.itemsSubject.next(remoteItems);
        this.saveToStorageOnly();
        this.lastSyncTime = payload.lastModified;
      } else {
        // Auto-sync from Firebase when dialog closes to pick up changes from other machines
        this.backgroundSync();
      }
    }
  }

  /**
   * Background sync: pull from Firebase without blocking UI.
   * Used to refresh local state after dialog closes.
   */
  private async backgroundSync(): Promise<void> {
    try {
      const pullResponse = await firstValueFrom(
        this.http.get<SyncResponse>(this.apiUrl)
      );
      const remoteItems = pullResponse.success ? (pullResponse.items || []) : [];
      this.ensureMergedIds(remoteItems);
      this.itemsSubject.next(remoteItems);
      this.saveToStorageOnly();
      this.lastSyncTime = pullResponse.lastModified || new Date().toISOString();
      console.log(`✅ [MergedProducts] Background sync: ${remoteItems.length} items from Firebase`);
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Background sync failed:', err);
    }
  }

  /**
   * Get item count
   */
  getCount(): number {
    return this.itemsSubject.value.length;
  }

  /**
   * Get total cart items count across all merged items
   */
  getTotalCartItemsCount(): number {
    return this.itemsSubject.value.reduce((sum, item) => sum + item.cartItems.length, 0);
  }

  /**
   * Get total merged quantity per MasterUnitId in MASTER UNITS across all merged items.
   * Key = MasterUnitId (or product.Id for master products).
   * Value = total qty converted to master units (qty * ConversionValue).
   * Used to calculate effective OnHand = physical OnHand - merged qty.
   */
  getMergedQuantitiesMap(): Map<number, number> {
    const result = new Map<number, number>();
    const itemsCount = this.itemsSubject.value.length;
    console.log('🔷 [getMergedQuantitiesMap] itemsSubject count:', itemsCount);
    for (const item of this.itemsSubject.value) {
      console.log('🔷 [getMergedQuantitiesMap] mergedItem:', {
        id: item.id,
        invoiceId: item.invoiceId,
        cartItemsCount: item.cartItems?.length
      });
      for (const ci of item.cartItems) {
        const product = ci.product;
        if (!product?.Id) continue;
        const masterUnitId = product.MasterUnitId || product.Id;
        const conversionValue = Number(product.ConversionValue) || 1;
        const masterQty = (ci.quantity || 0) * conversionValue;
        console.log('🔷 [getMergedQuantitiesMap] cartItem:', {
          productName: product.Name,
          productId: product.Id,
          masterUnitId: product.MasterUnitId,
          resolvedMasterUnitId: masterUnitId,
          unit: product.Unit,
          qty: ci.quantity,
          conversionValue,
          masterQty
        });
        result.set(masterUnitId, (result.get(masterUnitId) || 0) + masterQty);
      }
    }
    console.log('🔷 [getMergedQuantitiesMap] result:', Array.from(result.entries()));
    return result;
  }

  /**
   * Generate unique _mergedId for a cart item
   */
  private generateMergedId(productId: number | undefined): string {
    return `${productId || 0}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * Deep copy cart items with _mergedId for ID-based removal
   */
  private deepCopyCartItems(cartItems: CartItem[]): CartItem[] {
    return cartItems.map(item => ({
      ...item,
      product: item.product ? { ...item.product } : null as any,
      _mergedId: this.generateMergedId(item.product?.Id)
    }));
  }

  /**
   * Ensure all cart items in merged items have _mergedId.
   * Needed after loading from Firebase/WebSocket/localStorage where _mergedId may be lost.
   */
  private ensureMergedIds(items: MergedProductItem[]): void {
    for (const item of items) {
      for (const ci of item.cartItems) {
        if (!(ci as any)._mergedId) {
          (ci as any)._mergedId = this.generateMergedId(ci.product?.Id);
        }
      }
    }
  }

  /**
   * Add invoiceKV (products gốc) vào danh sách gộp
   * Được gọi khi checkout với GỘP=ON
   * Uses atomic /add endpoint to prevent stale overwrites
   */
  /**
   * Add a pre-built MergedProductItem directly (used by auto-merge)
   */
  addMergedItem(item: MergedProductItem): void {
    const currentItems = [...this.itemsSubject.value, item];
    this.itemsSubject.next(currentItems);
    this.saveToStorage();
    this.pushAddToFirebase(item);

    console.log('✅ Added merged item:', {
      id: item.id,
      invoiceName: item.invoiceName,
      cartItemsCount: item.cartItems.length,
      totalPrice: item.totalPrice
    });
  }

  addInvoiceKV(invoiceKV: InvoiceTab, originalInvoice: InvoiceTab): void {
    const newItem: MergedProductItem = {
      id: `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      invoiceId: originalInvoice.id,
      invoiceName: originalInvoice.id,
      cartItems: this.deepCopyCartItems(invoiceKV.cartItems),
      customer: originalInvoice.customer ? { ...originalInvoice.customer } : null,
      totalPrice: invoiceKV.totalPrice,
      discountAmount: invoiceKV.discountAmount,
      createdDate: new Date().toISOString(),
      note: originalInvoice.note || '',
      isBankTransfer: originalInvoice.isBankTransfer === true
    };

    // Update local state
    const currentItems = [...this.itemsSubject.value, newItem];
    this.itemsSubject.next(currentItems);
    this.saveToStorage();

    // Atomic add to Firebase (reads current Firestore state, appends item)
    this.pushAddToFirebase(newItem);

    console.log('✅ Added invoiceKV to merged products:', {
      id: newItem.id,
      invoiceName: newItem.invoiceName,
      cartItemsCount: newItem.cartItems.length,
      totalPrice: newItem.totalPrice,
      isBankTransfer: newItem.isBankTransfer
    });
  }

  /**
   * Remove an item by ID (atomic: uses /remove endpoint on Firestore)
   */
  removeItem(itemId: string): void {
    const currentItems = this.itemsSubject.value.filter(item => item.id !== itemId);
    this.itemsSubject.next(currentItems);
    this.saveToStorage();
    this.pushRemoveToFirebase([itemId]);
  }

  /**
   * Remove multiple items by IDs (atomic: uses /remove endpoint on Firestore)
   */
  removeItems(itemIds: string[]): void {
    const idSet = new Set(itemIds);
    const currentItems = this.itemsSubject.value.filter(item => !idSet.has(item.id));
    this.itemsSubject.next(currentItems);
    this.saveToStorage();
    this.pushRemoveToFirebase(itemIds);
  }

  /**
   * Remove all merged items that belong to a specific invoice
   * Called when an invoice is deleted to cascade-remove its merged products
   * Uses atomic /remove endpoint on Firestore
   */
  removeItemsByInvoiceId(invoiceId: string): void {
    const currentItems = this.itemsSubject.value;
    const removedIds = currentItems.filter(item => item.invoiceId === invoiceId).map(item => item.id);
    const filtered = currentItems.filter(item => item.invoiceId !== invoiceId);
    if (removedIds.length > 0) {
      console.log(`🗑️ [MergedProducts] Removed ${removedIds.length} merged items for invoice ${invoiceId}`);
      this.itemsSubject.next(filtered);
      this.saveToStorage();
      this.pushRemoveToFirebase(removedIds);
    }
  }

  /**
   * Check if there are merged items for a specific invoice
   */
  hasItemsForInvoice(invoiceId: string): boolean {
    return this.itemsSubject.value.some(item => item.invoiceId === invoiceId);
  }

  /**
   * Update merged items for a specific invoice after invoice edit.
   * Removes old merged items and adds new KV cart items.
   * If newKvCartItems is empty, just removes old items.
   */
  updateItemsForInvoice(invoiceId: string, newKvCartItems: CartItem[], updatedInvoice: InvoiceTab): void {
    const currentItems = this.itemsSubject.value;
    const hadItems = currentItems.some(item => item.invoiceId === invoiceId);

    if (!hadItems && newKvCartItems.length === 0) {
      return; // Nothing to do
    }

    // Log audit for old items being updated
    const oldItems = currentItems.filter(item => item.invoiceId === invoiceId);
    if (oldItems.length > 0) {
      this.logAudit('updated', oldItems);
    }

    // Collect IDs of old items to remove
    const oldItemIds = currentItems.filter(item => item.invoiceId === invoiceId).map(item => item.id);

    // Remove old merged items for this invoice
    const filtered = currentItems.filter(item => item.invoiceId !== invoiceId);

    // Add new merged item if there are KV cart items
    let newItem: MergedProductItem | null = null;
    if (newKvCartItems.length > 0) {
      newItem = {
        id: `merged_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        invoiceId: invoiceId,
        invoiceName: invoiceId,
        cartItems: this.deepCopyCartItems(newKvCartItems),
        customer: updatedInvoice.customer ? { ...updatedInvoice.customer } : null,
        totalPrice: newKvCartItems.reduce((sum, ci) => sum + (ci.totalPrice || 0), 0),
        discountAmount: 0,
        createdDate: new Date().toISOString(),
        note: updatedInvoice.note || ''
      };
      filtered.push(newItem);
      console.log(`🔄 [MergedProducts] Updated merged items for invoice ${invoiceId}: ${newKvCartItems.length} KV items`);
    } else if (hadItems) {
      console.log(`🗑️ [MergedProducts] Removed all merged items for invoice ${invoiceId} (no KV items in updated invoice)`);
    }

    this.itemsSubject.next(filtered);
    this.saveToStorage();

    // Atomic: remove old items + add new item on Firestore
    if (oldItemIds.length > 0) {
      this.pushRemoveToFirebase(oldItemIds);
    }
    if (newItem) {
      this.pushAddToFirebase(newItem);
    }
  }

  /**
   * Remove specific cart items from merged items by _mergedId.
   * Used after successfully sending to KiotViet or manual deletion.
   * Returns { removedItemIds, updatedItems } for caller to use with pushAtomicUpdate.
   */
  removeCartItemsByMergedIds(removals: { itemId: string; mergedIds: string[] }[]): {
    removedItemIds: string[];
    updatedItems: MergedProductItem[];
  } {
    const currentItems = [...this.itemsSubject.value];
    const removedItemIds: string[] = [];
    const updatedItems: MergedProductItem[] = [];

    // Collect items for audit before removal
    const auditItems: MergedProductItem[] = [];

    for (const removal of removals) {
      const itemIndex = currentItems.findIndex(item => item.id === removal.itemId);
      if (itemIndex === -1) continue;

      const item = currentItems[itemIndex];
      const mergedIdSet = new Set(removal.mergedIds);

      // Collect removed cart items for audit
      const removedCartItems = item.cartItems.filter(ci => mergedIdSet.has((ci as any)._mergedId));
      if (removedCartItems.length > 0) {
        auditItems.push({
          ...item,
          cartItems: removedCartItems
        });
      }

      // Filter out cart items by _mergedId (safe, no index issues)
      item.cartItems = item.cartItems.filter(ci => !mergedIdSet.has((ci as any)._mergedId));

      // Recalculate totals
      item.totalPrice = item.cartItems.reduce((sum, ci) => sum + (ci.totalPrice || 0), 0);

      // Track fully removed vs partially updated items
      if (item.cartItems.length === 0) {
        removedItemIds.push(item.id);
        currentItems.splice(itemIndex, 1);
      } else {
        updatedItems.push(item);
      }
    }

    this.itemsSubject.next(currentItems);
    this.saveToStorage();

    // Log audit for deleted items
    if (auditItems.length > 0) {
      this.logAudit('deleted', auditItems);
    }

    return { removedItemIds, updatedItems };
  }

  /**
   * @deprecated Use removeCartItemsByMergedIds instead. Kept for backward compatibility.
   * Returns { removedItemIds, updatedItems } for caller to use with pushAtomicUpdate.
   */
  removeCartItems(removals: { itemId: string; cartItemIndices: number[] }[]): {
    removedItemIds: string[];
    updatedItems: MergedProductItem[];
  } {
    const currentItems = [...this.itemsSubject.value];
    const removedItemIds: string[] = [];
    const updatedItems: MergedProductItem[] = [];

    for (const removal of removals) {
      const itemIndex = currentItems.findIndex(item => item.id === removal.itemId);
      if (itemIndex === -1) continue;

      const item = currentItems[itemIndex];
      // Remove cart items by indices (from highest to lowest to maintain indices)
      const sortedIndices = [...removal.cartItemIndices].sort((a, b) => b - a);
      for (const idx of sortedIndices) {
        if (idx >= 0 && idx < item.cartItems.length) {
          item.cartItems.splice(idx, 1);
        }
      }

      // Recalculate totals
      item.totalPrice = item.cartItems.reduce((sum, ci) => sum + (ci.totalPrice || 0), 0);

      if (item.cartItems.length === 0) {
        removedItemIds.push(item.id);
        currentItems.splice(itemIndex, 1);
      } else {
        updatedItems.push(item);
      }
    }

    this.itemsSubject.next(currentItems);
    this.saveToStorage();

    return { removedItemIds, updatedItems };
  }

  /**
   * Clear all items
   */
  clearAll(): void {
    this.itemsSubject.next([]);
    this.saveToStorage();
    // Use dedicated clear endpoint
    const payload = { modifiedBy: 'manual-clear' };
    this.ignoreWsCount++;
    this.http.post<SyncResponse>(`${this.apiUrl}/clear`, payload).subscribe({
      next: () => console.log('✅ [MergedProducts] Cleared all on Firebase'),
      error: (err) => {
        console.warn('⚠️ [MergedProducts] Clear on Firebase failed, queuing offline:', err);
        this.addToPendingQueue({
          id: `pending_clear_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          type: 'clear',
          payload,
          createdAt: new Date().toISOString(),
          retryCount: 0
        });
      }
    });
  }

  /**
   * Get all cart items flattened with their parent item info
   */
  getAllCartItemsFlattened(): { item: MergedProductItem; cartItem: CartItem; cartItemIndex: number }[] {
    const result: { item: MergedProductItem; cartItem: CartItem; cartItemIndex: number }[] = [];

    for (const item of this.itemsSubject.value) {
      item.cartItems.forEach((cartItem, index) => {
        result.push({ item, cartItem, cartItemIndex: index });
      });
    }

    return result;
  }

  // ============= STOCK STATUS CACHE =============

  /**
   * Load stock status from localStorage
   */
  private loadStockStatusFromStorage(): void {
    try {
      const stored = localStorage.getItem(STOCK_STATUS_STORAGE_KEY);
      if (stored) {
        const entries: [number, StockStatus][] = JSON.parse(stored);
        this.stockStatusMap = new Map(entries);
        console.log(`✅ Loaded ${this.stockStatusMap.size} stock status entries from storage`);
      }
    } catch (err) {
      console.error('❌ Error loading stock status from storage:', err);
      this.stockStatusMap = new Map();
    }
  }

  /**
   * Save stock status to localStorage
   */
  private saveStockStatusToStorage(): void {
    try {
      const entries = Array.from(this.stockStatusMap.entries());
      localStorage.setItem(STOCK_STATUS_STORAGE_KEY, JSON.stringify(entries));
    } catch (err) {
      console.error('❌ Error saving stock status to storage:', err);
    }
  }

  /**
   * Get the full stock status map
   */
  getStockStatusMap(): Map<number, StockStatus> {
    return this.stockStatusMap;
  }

  /**
   * Get stock status for a specific product
   */
  getStockStatus(productId: number | undefined): StockStatus | undefined {
    if (productId == null) return undefined;
    return this.stockStatusMap.get(productId);
  }

  /**
   * Update the full stock status map and persist
   */
  setStockStatusMap(map: Map<number, StockStatus>): void {
    this.stockStatusMap = map;
    this.saveStockStatusToStorage();
  }

  /**
   * Clear stock status cache
   */
  clearStockStatus(): void {
    this.stockStatusMap.clear();
    this.saveStockStatusToStorage();
  }

  // ============= SYNC METHODS =============

  // Flag to block WebSocket updates during auto-merge from main-page
  private isAutoMerging = false;

  setAutoMerging(value: boolean): void {
    this.isAutoMerging = value;
    console.log(`🔒 [MergedProducts] Auto-merging flag: ${value}`);
  }

  /**
   * Quick pull from Firebase only (no KiotViet stock check).
   * Used before auto-merge to ensure fresh data. ~100-300ms.
   */
  async quickPullFromFirebase(): Promise<MergedProductItem[]> {
    try {
      const res = await firstValueFrom(this.http.get<SyncResponse>(this.apiUrl));
      const items = res.success ? (res.items || []) : this.itemsSubject.value;
      this.ensureMergedIds(items);
      this.itemsSubject.next(items);
      this.saveToStorageOnly();
      console.log(`⚡ [quickPull] Loaded ${items.length} items from Firebase`);
      return items;
    } catch (err) {
      console.warn('⚠️ [quickPull] Failed, using local data:', err);
      return this.itemsSubject.value;
    }
  }

  /**
   * Full sync: Xóa local trước, sau đó load từ Firebase (Firebase là source of truth)
   * Dùng cho nút sync thủ công trong dialog
   */
  async fullSync(): Promise<{ success: boolean; message: string; count: number }> {
    if (this.syncingSubject.value) {
      return { success: false, message: 'Đang đồng bộ...', count: 0 };
    }

    this.syncingSubject.next(true);
    this.isSyncingFull = true; // Block WebSocket updates during sync

    try {
      const localCount = this.itemsSubject.value.length;
      console.log(`🔄 Full sync: Xóa ${localCount} local items → Load từ Firebase`);

      // Step 1: Xóa local trước
      this.itemsSubject.next([]);
      this.saveToStorageOnly();

      // Step 2: Pull from Firebase
      const pullResponse = await firstValueFrom(
        this.http.get<SyncResponse>(this.apiUrl)
      );

      const remoteItems = pullResponse.success ? (pullResponse.items || []) : [];

      // Sort by createdDate descending
      remoteItems.sort((a, b) =>
        new Date(b.createdDate).getTime() - new Date(a.createdDate).getTime()
      );

      // Step 3: Cập nhật local từ Firebase
      this.ensureMergedIds(remoteItems);
      this.itemsSubject.next(remoteItems);
      this.saveToStorageOnly();
      this.lastSyncTime = pullResponse.lastModified || new Date().toISOString();

      console.log(`✅ Full sync completed: ${remoteItems.length} items từ Firebase (local trước đó: ${localCount})`);
      return {
        success: true,
        message: `Đã đồng bộ ${remoteItems.length} sản phẩm gộp từ Firebase`,
        count: remoteItems.length
      };
    } catch (error: any) {
      console.error('❌ Error in full sync:', error);
      // Nếu lỗi, load lại từ localStorage (đã bị xóa nhưng có thể recover)
      this.loadFromStorage();
      return {
        success: false,
        message: `Lỗi đồng bộ: ${error.message || 'Unknown error'}`,
        count: 0
      };
    } finally {
      this.isSyncingFull = false; // Unblock WebSocket updates
      this.ignoreWsCount = 0; // Reset counter to ensure future WebSocket updates are received
      this.syncingSubject.next(false);
    }
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): string | null {
    return this.lastSyncTime;
  }

  /**
   * Check if currently syncing
   */
  isSyncing(): boolean {
    return this.syncingSubject.value;
  }

  // ============= OFFLINE PENDING QUEUE =============

  /**
   * Init pending queue: ensure DB exists, load count, start auto-retry
   */
  private async initPendingQueue(): Promise<void> {
    try {
      await this.ensurePendingDB();
      await this.refreshPendingCount();
      const count = this.pendingCountSubject.value;
      if (count > 0) {
        console.log(`📋 [MergedProducts] ${count} pending offline operations found, retrying...`);
        this.processPendingQueue();
      }
      // Start periodic retry
      this.pendingRetryTimer = setInterval(() => {
        if (this.pendingCountSubject.value > 0 && !this.isProcessingPending) {
          console.log('🔄 [MergedProducts] Auto-retrying pending operations...');
          this.processPendingQueue();
        }
      }, PENDING_RETRY_INTERVAL);
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Failed to init pending queue:', err);
    }
  }

  /**
   * Ensure pending IndexedDB database and store exist
   */
  private async ensurePendingDB(): Promise<void> {
    await this.indexedDBService.getDB(
      PENDING_DB_NAME, PENDING_DB_VERSION,
      (db) => {
        if (!db.objectStoreNames.contains(PENDING_STORE_NAME)) {
          db.createObjectStore(PENDING_STORE_NAME, { keyPath: 'id' });
        }
      }
    );
  }

  /**
   * Add a failed operation to pending queue in IndexedDB
   */
  private async addToPendingQueue(op: PendingOperation): Promise<void> {
    try {
      await this.ensurePendingDB();
      await this.indexedDBService.put(PENDING_DB_NAME, PENDING_DB_VERSION, PENDING_STORE_NAME, op);
      await this.refreshPendingCount();
      console.log(`📋 [MergedProducts] Queued offline op: ${op.type} (${op.id})`);
    } catch (err) {
      console.error('❌ [MergedProducts] Failed to queue offline op:', err);
    }
  }

  /**
   * Get all pending operations from IndexedDB
   */
  private async getPendingOps(): Promise<PendingOperation[]> {
    try {
      await this.ensurePendingDB();
      return await this.indexedDBService.getAll<PendingOperation>(
        PENDING_DB_NAME, PENDING_DB_VERSION, PENDING_STORE_NAME
      );
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Failed to read pending ops:', err);
      return [];
    }
  }

  /**
   * Remove a pending operation after successful retry
   */
  private async removePendingOp(id: string): Promise<void> {
    try {
      await this.indexedDBService.delete(PENDING_DB_NAME, PENDING_DB_VERSION, PENDING_STORE_NAME, id);
      await this.refreshPendingCount();
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Failed to remove pending op:', err);
    }
  }

  /**
   * Refresh pending count from IndexedDB
   */
  private async refreshPendingCount(): Promise<void> {
    try {
      const count = await this.indexedDBService.count(PENDING_DB_NAME, PENDING_DB_VERSION, PENDING_STORE_NAME);
      this.pendingCountSubject.next(count);
    } catch {
      // ignore
    }
  }

  /**
   * Process all pending operations in order (FIFO by createdAt).
   * Stops at first failure to maintain order.
   */
  async processPendingQueue(): Promise<void> {
    if (this.isProcessingPending) return;
    this.isProcessingPending = true;

    try {
      const ops = await this.getPendingOps();
      if (ops.length === 0) return;

      // Sort by createdAt ascending (oldest first)
      ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      for (const op of ops) {
        const success = await this.retrySingleOp(op);
        if (success) {
          await this.removePendingOp(op.id);
          console.log(`✅ [MergedProducts] Pending op succeeded: ${op.type} (${op.id})`);
        } else {
          // Update retry count
          op.retryCount++;
          if (op.retryCount > 20) {
            // Give up after 20 retries (~10 min)
            console.warn(`⚠️ [MergedProducts] Dropping pending op after 20 retries: ${op.type} (${op.id})`);
            await this.removePendingOp(op.id);
          } else {
            await this.indexedDBService.put(PENDING_DB_NAME, PENDING_DB_VERSION, PENDING_STORE_NAME, op);
          }
          // Stop processing on failure (maintain order)
          break;
        }
      }
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Error processing pending queue:', err);
    } finally {
      this.isProcessingPending = false;
      await this.refreshPendingCount();
    }
  }

  /**
   * Retry a single pending operation. Returns true if succeeded.
   */
  private async retrySingleOp(op: PendingOperation): Promise<boolean> {
    try {
      switch (op.type) {
        case 'add':
          this.ignoreWsCount++;
          await firstValueFrom(
            this.http.post<SyncResponse>(`${this.apiUrl}/add`, op.payload)
          );
          return true;

        case 'remove':
          this.ignoreWsCount++;
          await firstValueFrom(
            this.http.post<SyncResponse>(`${this.apiUrl}/remove`, op.payload)
          );
          return true;

        case 'atomic-update':
          this.ignoreWsCount++;
          await firstValueFrom(
            this.http.post<SyncResponse>(`${this.apiUrl}/atomic-update`, op.payload)
          );
          return true;

        case 'full-replace':
          this.ignoreWsCount++;
          await firstValueFrom(
            this.http.post<SyncResponse>(this.apiUrl, op.payload)
          );
          return true;

        case 'clear':
          this.ignoreWsCount++;
          await firstValueFrom(
            this.http.post<SyncResponse>(`${this.apiUrl}/clear`, op.payload)
          );
          return true;

        default:
          console.warn(`⚠️ [MergedProducts] Unknown pending op type: ${op.type}`);
          return true; // Remove unknown ops
      }
    } catch (err) {
      console.warn(`⚠️ [MergedProducts] Retry failed for ${op.type}:`, err);
      return false;
    }
  }

  /**
   * Get current pending operations count
   */
  getPendingCount(): number {
    return this.pendingCountSubject.value;
  }

  // ============= AUDIT / BACKUP SYSTEM =============

  /**
   * Log audit action (fire-and-forget to Firebase + save to IndexedDB)
   * Chỉ lưu IDs, không lưu full product data
   */
  logAudit(
    action: 'checked-out' | 'deleted' | 'updated',
    items: MergedProductItem[],
    kvInvoiceId?: string
  ): void {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const now = new Date().toISOString();

    const records: AuditRecord[] = items.map(item => ({
      id: `${item.id}_${now}`,
      mergedItemId: item.id,
      invoiceId: item.invoiceId,
      productIds: item.cartItems
        .map(ci => ci.product?.Id)
        .filter((id): id is number => id != null),
      action,
      actionBy: 'auto',
      actionAt: now,
      ...(kvInvoiceId ? { kvInvoiceId } : {})
    }));

    // Fire-and-forget to Firebase
    this.http.post(`${this.auditApiUrl}/log`, { date, records }).subscribe({
      next: () => console.log(`📝 [Audit] Logged ${records.length} ${action} records`),
      error: err => console.warn('⚠️ [Audit] Firebase log failed:', err)
    });

    // Also save to IndexedDB
    this.saveAuditToIndexedDB(records);
  }

  /**
   * Ensure audit IndexedDB database and store exist
   */
  private async ensureAuditDB(): Promise<void> {
    await this.indexedDBService.getDB(
      AUDIT_DB_NAME, AUDIT_DB_VERSION,
      (db) => {
        if (!db.objectStoreNames.contains(AUDIT_STORE_NAME)) {
          db.createObjectStore(AUDIT_STORE_NAME, { keyPath: 'id' });
        }
      }
    );
  }

  /**
   * Save audit records to IndexedDB
   */
  private async saveAuditToIndexedDB(records: AuditRecord[]): Promise<void> {
    try {
      await this.ensureAuditDB();
      for (const r of records) {
        await this.indexedDBService.put(AUDIT_DB_NAME, AUDIT_DB_VERSION, AUDIT_STORE_NAME, r);
      }
    } catch (err) {
      console.warn('⚠️ [Audit] IndexedDB save failed:', err);
    }
  }

  /**
   * Check and clear old audit data when date changes
   * Called on service init — clears IndexedDB audit if date is past
   */
  private checkAndClearOldAudit(): void {
    try {
      const today = new Date().toISOString().split('T')[0];
      const lastAuditDate = localStorage.getItem(AUDIT_LAST_DATE_KEY);
      if (lastAuditDate && lastAuditDate < today) {
        console.log(`🧹 [Audit] Clearing old audit data (last: ${lastAuditDate}, today: ${today})`);
        this.indexedDBService.clear(AUDIT_DB_NAME, AUDIT_DB_VERSION, AUDIT_STORE_NAME).catch(
          err => console.warn('⚠️ [Audit] Failed to clear old IndexedDB audit:', err)
        );
      }
      localStorage.setItem(AUDIT_LAST_DATE_KEY, today);
    } catch (err) {
      console.warn('⚠️ [Audit] Error checking old audit:', err);
    }
  }

  // ============= AUTO-MERGE BORROWED QTY =============

  /**
   * Init TopProductsDailyDB with auto_merge_history store.
   * Shared DB with merged-product-page component.
   */
  private async ensureAutoMergeHistoryDB(): Promise<void> {
    await this.indexedDBService.getDB(
      TOP_PRODUCTS_DB_NAME, TOP_PRODUCTS_DB_VERSION,
      (db: any) => {
        if (!db.objectStoreNames.contains('top_products')) {
          db.createObjectStore('top_products', { keyPath: 'productId' });
        }
        if (!db.objectStoreNames.contains(AUTO_MERGE_HISTORY_STORE)) {
          db.createObjectStore(AUTO_MERGE_HISTORY_STORE, { keyPath: 'id' });
        }
      }
    );
  }

  /**
   * Get unreturned borrowed quantities grouped by productId.
   * Only counts entries from top50/manual sources (not 'merged' — those are moves, not borrows).
   * Skips entries whose invoiceId is still in current merged list
   * (if still in merged list → not yet sent to KV → OnHand not yet decreased).
   */
  async getBorrowedQuantities(): Promise<Map<number, { qty: number; entries: AutoMergeHistoryEntry[] }>> {
    const result = new Map<number, { qty: number; entries: AutoMergeHistoryEntry[] }>();
    try {
      await this.ensureAutoMergeHistoryDB();
      const allEntries = await this.indexedDBService.getAll<AutoMergeHistoryEntry>(
        TOP_PRODUCTS_DB_NAME, TOP_PRODUCTS_DB_VERSION, AUTO_MERGE_HISTORY_STORE
      );

      // Get current merged item invoiceIds (items NOT yet sent to KV)
      const mergedInvoiceIds = new Set(this.itemsSubject.value.map(item => item.invoiceId));

      for (const entry of allEntries) {
        // Skip already returned
        if (entry.returned === true) continue;
        // Skip 'merged' source — those are products moved within merged list, not borrowed
        if (entry.source === 'merged') continue;
        // Skip entries whose merged item is still in the list (not yet sent to KV)
        if (mergedInvoiceIds.has(entry.invoiceId)) continue;

        const existing = result.get(entry.productId);
        if (existing) {
          existing.qty += entry.qtyTaken;
          existing.entries.push(entry);
        } else {
          result.set(entry.productId, { qty: entry.qtyTaken, entries: [entry] });
        }
      }

      // Sort entries by timestamp ascending (FIFO for return)
      for (const [, value] of result) {
        value.entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      }
    } catch (err) {
      console.warn('⚠️ [MergedProducts] Failed to get borrowed quantities:', err);
    }
    return result;
  }

  /**
   * Mark auto-merge history entries as returned in IndexedDB + push to Firestore.
   */
  async deleteHistoryEntries(entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return;
    try {
      await this.ensureAutoMergeHistoryDB();
      for (const id of entryIds) {
        await this.indexedDBService.delete(
          TOP_PRODUCTS_DB_NAME, TOP_PRODUCTS_DB_VERSION, AUTO_MERGE_HISTORY_STORE, id
        );
      }
      console.log(`✅ [MergedProducts] Deleted ${entryIds.length} history entries`);

      // Fire-and-forget push to Firestore
      this.http.delete(`${environment.domainUrl}/api/firebase/merged-products/history/delete`, {
        body: { entryIds, modifiedBy: this.getCurrentUserEmail() || 'auto-checkout' }
      }).subscribe({
        next: () => console.log('✅ [MergedProducts] Pushed history deletion to Firestore'),
        error: (err) => console.warn('⚠️ [MergedProducts] Failed to push history deletion:', err)
      });
    } catch (err) {
      console.error('❌ [MergedProducts] Failed to delete history entries:', err);
      throw err;
    }
  }

  async markHistoryReturned(entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return;
    try {
      await this.ensureAutoMergeHistoryDB();
      for (const id of entryIds) {
        const entry = await this.indexedDBService.getByKey<AutoMergeHistoryEntry>(
          TOP_PRODUCTS_DB_NAME, TOP_PRODUCTS_DB_VERSION, AUTO_MERGE_HISTORY_STORE, id
        );
        if (entry) {
          entry.returned = true;
          await this.indexedDBService.put(
            TOP_PRODUCTS_DB_NAME, TOP_PRODUCTS_DB_VERSION, AUTO_MERGE_HISTORY_STORE, entry
          );
        }
      }
      console.log(`✅ [MergedProducts] Marked ${entryIds.length} history entries as returned`);

      // Fire-and-forget push to Firestore
      this.http.post(`${environment.domainUrl}/api/firebase/merged-products/history/mark-returned`, {
        entryIds,
        modifiedBy: this.getCurrentUserEmail() || 'auto-checkout'
      }).subscribe({
        next: () => console.log('✅ [MergedProducts] Pushed returned status to Firestore'),
        error: (err) => console.warn('⚠️ [MergedProducts] Failed to push returned status:', err)
      });
    } catch (err) {
      console.error('❌ [MergedProducts] Failed to mark history returned:', err);
    }
  }
}
