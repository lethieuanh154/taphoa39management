import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subject, BehaviorSubject, Subscription } from 'rxjs';
import { skip, distinctUntilChanged } from 'rxjs/operators';
import { io, Socket } from 'socket.io-client';
import { BackendUrlService } from './backend-url.service';

/**
 * Interface for product update from WebSocket
 */
export interface ProductWebSocketUpdate {
  Id: number;
  OnHand?: number;
  OnHandNV?: number;
  BasePrice?: number;
  Cost?: number;
  Code?: string;
  Name?: string;
  FullName?: string;
  ProductName?: string;
  Description?: string;
  NormalizedName?: string;
  NormalizedCode?: string;
  ModifiedDate?: string;
  [key: string]: any;
}

/**
 * Interface for WebSocket message payload
 */
export interface ProductsUpdatedPayload {
  products: ProductWebSocketUpdate[];
  timestamp: string;
  count: number;
}

/**
 * Interface for merged products WebSocket payload
 */
export interface MergedProductsUpdatedPayload {
  items: any[];
  count: number;
  lastModified: string;
  modifiedBy: string;
}

/**
 * WebSocket Realtime Service - Hybrid Solution
 *
 * Replaces Firestore onSnapshot with WebSocket for realtime sync.
 * Benefits:
 * - No Firestore reads for realtime updates
 * - Full product data sent immediately (no need to fetch)
 * - Initial Sync on connect to catch missed updates
 *
 * Flow:
 * 1. Client connects to WebSocket
 * 2. Server sends last update (Initial Sync)
 * 3. Client receives realtime updates via 'products_updated' event
 * 4. Client updates IndexedDB and UI
 */
@Injectable({
  providedIn: 'root'
})
export class WebSocketRealtimeService implements OnDestroy {
  private backendUrlService = inject(BackendUrlService);
  private socket: Socket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 2000; // ms
  private urlChangeSub: Subscription | null = null;

  // Subjects for emitting updates
  private productUpdates$ = new Subject<ProductWebSocketUpdate[]>();
  private productsAdded$ = new Subject<ProductWebSocketUpdate[]>();
  private mergedProductsUpdated$ = new Subject<MergedProductsUpdatedPayload>();
  private promotionsUpdated$ = new Subject<{ action: string; promotionId?: string }>();
  private connectionStatus$ = new BehaviorSubject<'connected' | 'disconnected' | 'connecting'>('disconnected');

  // Last sync timestamp for Initial Sync
  private readonly LAST_WS_SYNC_KEY = 'wsLastSyncTime';

  constructor() {
    console.log('🔌 [WebSocketRealtime] Service initialized');

    // Reconnect WebSocket when backend URL changes (failover)
    this.urlChangeSub = this.backendUrlService.getUrlChanges$().pipe(
      skip(1),
      distinctUntilChanged()
    ).subscribe((newUrl) => {
      console.log('🔄 [WebSocketRealtime] Backend URL changed, reconnecting to:', newUrl);
      this.reconnect();
    });
  }

  /**
   * Connect to WebSocket server
   */
  connect(): void {
    if (this.socket?.connected) {
      console.log('ℹ️ [WebSocketRealtime] Already connected');
      return;
    }

    this.connectionStatus$.next('connecting');
    console.log('🔄 [WebSocketRealtime] Connecting to WebSocket...');

    const wsUrl = this.backendUrlService.getActiveUrl();
    const namespace = '/api/websocket/products';

    this.socket = io(`${wsUrl}${namespace}`, {
      transports: ['polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay,
      timeout: 10000
    });

    this.setupEventListeners();
  }

  /**
   * Setup WebSocket event listeners
   */
  private setupEventListeners(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('✅ [WebSocketRealtime] Connected to server');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.connectionStatus$.next('connected');

      // Request Initial Sync - catch up on missed updates
      this.requestInitialSync();
    });

    this.socket.on('disconnect', (reason) => {
      console.log(`🔌 [WebSocketRealtime] Disconnected: ${reason}`);
      this.isConnected = false;
      this.connectionStatus$.next('disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('❌ [WebSocketRealtime] Connection error:', error.message);
      this.reconnectAttempts++;

      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('❌ [WebSocketRealtime] Max reconnect attempts reached');
      }
    });

    // Product update events
    this.socket.on('products_updated', (payload: ProductsUpdatedPayload) => {
      this.handleProductsUpdated(payload);
    });

    // NEW: Products added event (for clone products, new products)
    this.socket.on('products_added', (payload: ProductsUpdatedPayload) => {
      this.handleProductsAdded(payload);
    });

    // Merged products updated event (real-time sync between machines)
    this.socket.on('merged_products_updated', (payload: MergedProductsUpdatedPayload) => {
      console.log(`📦 [WebSocketRealtime] Merged products updated: ${payload.count} items`);
      this.mergedProductsUpdated$.next(payload);
    });

    // Promotions updated event (create/update/delete/toggle from another machine)
    this.socket.on('promotions_updated', (payload: { action: string; promotionId?: string }) => {
      console.log(`🎁 [WebSocketRealtime] Promotions updated: ${payload?.action} ${payload?.promotionId || ''}`);
      this.promotionsUpdated$.next(payload);
    });

    // Legacy event for backward compatibility
    this.socket.on('products_onhand_updated', (ids: string[]) => {
      console.log(`📦 [WebSocketRealtime] Legacy event: ${ids.length} product IDs`);
      // This event only has IDs, new 'products_updated' event has full data
    });

    // Initial sync response (last update when client was offline)
    this.socket.on('notify', (payload: any) => {
      console.log('📥 [WebSocketRealtime] Initial sync notification:', payload);
      if (payload?.products) {
        this.handleProductsUpdated(payload);
      }
    });
  }

  /**
   * Request Initial Sync from server
   * Server will send last update if client missed it while offline
   */
  private requestInitialSync(): void {
    const lastSync = this.getLastSyncTime();
    console.log(`🔄 [WebSocketRealtime] Requesting Initial Sync (last sync: ${lastSync || 'never'})`);

    // The server automatically sends last notify on connect via BaseNamespace.on_connect
    // No need to explicitly request - it's already handled
  }

  /**
   * Handle products_updated event from server
   */
  private handleProductsUpdated(payload: ProductsUpdatedPayload): void {
    if (!payload?.products || payload.products.length === 0) {
      return;
    }

    console.log(`📦 [WebSocketRealtime] Received ${payload.count} product updates at ${payload.timestamp}`);

    // Log sample for debugging
    const sample = payload.products.slice(0, 3);
    console.log('🔍 [WebSocketRealtime] Sample updates:', sample.map(p => ({
      Id: p.Id,
      OnHand: p.OnHand,
      OnHandNV: p.OnHandNV
    })));

    // Save last sync time
    this.saveLastSyncTime(payload.timestamp);

    // Emit updates to subscribers
    this.productUpdates$.next(payload.products);
  }

  /**
   * Handle products_added event from server (new products, clone products)
   */
  private handleProductsAdded(payload: ProductsUpdatedPayload): void {
    if (!payload?.products || payload.products.length === 0) {
      return;
    }

    console.log(`🆕 [WebSocketRealtime] Received ${payload.count} NEW products at ${payload.timestamp}`);

    // Log sample for debugging
    const sample = payload.products.slice(0, 3);
    console.log('🔍 [WebSocketRealtime] New products sample:', sample.map(p => ({
      Id: p.Id,
      Code: p['Code'],
      Name: p['Name'],
      isClone: p['isClone']
    })));

    // Save last sync time
    this.saveLastSyncTime(payload.timestamp);

    // Emit to subscribers - these are NEW products to be ADDED to IndexedDB
    this.productsAdded$.next(payload.products);
  }

  /**
   * Get last sync timestamp from localStorage
   */
  getLastSyncTime(): string | null {
    return localStorage.getItem(this.LAST_WS_SYNC_KEY);
  }

  /**
   * Save last sync timestamp to localStorage
   */
  private saveLastSyncTime(timestamp: string): void {
    localStorage.setItem(this.LAST_WS_SYNC_KEY, timestamp);
  }

  /**
   * Clear last sync time
   */
  clearLastSyncTime(): void {
    localStorage.removeItem(this.LAST_WS_SYNC_KEY);
  }

  /**
   * Get observable for product updates
   */
  getProductUpdates$() {
    return this.productUpdates$.asObservable();
  }

  /**
   * Get observable for newly added products (clone, new products)
   */
  getProductsAdded$() {
    return this.productsAdded$.asObservable();
  }

  /**
   * Get observable for merged products updates (real-time sync between machines)
   */
  getMergedProductsUpdated$() {
    return this.mergedProductsUpdated$.asObservable();
  }

  /**
   * Get observable for promotions updates (create/update/delete/toggle)
   */
  getPromotionsUpdated$() {
    return this.promotionsUpdated$.asObservable();
  }

  /**
   * Get observable for connection status
   */
  getConnectionStatus$() {
    return this.connectionStatus$.asObservable();
  }

  /**
   * Check if currently connected
   */
  isCurrentlyConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.connectionStatus$.next('disconnected');
      console.log('🛑 [WebSocketRealtime] Disconnected');
    }
  }

  /**
   * Reconnect to WebSocket server
   */
  reconnect(): void {
    this.disconnect();
    setTimeout(() => {
      this.connect();
    }, 1000);
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.urlChangeSub?.unsubscribe();
    this.productUpdates$.complete();
    this.productsAdded$.complete();
    this.mergedProductsUpdated$.complete();
    this.connectionStatus$.complete();
  }
}
