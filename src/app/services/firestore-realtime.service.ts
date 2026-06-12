import { Injectable, OnDestroy } from '@angular/core';
import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import {
  getFirestore,
  collection,
  onSnapshot,
  Firestore,
  Unsubscribe,
  QuerySnapshot,
  DocumentData
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { Subject } from 'rxjs';

/**
 * Interface cho product update từ Firestore realtime
 */
export interface ProductRealtimeUpdate {
  id: string;
  OnHand?: number;
  OnHandNV?: number;
  BasePrice?: number;
  Cost?: number;
  // Thêm các field khác nếu cần
  [key: string]: any;
}

/**
 * Service để lắng nghe realtime changes từ Firestore Products collection.
 * Sử dụng onSnapshot để nhận updates ngay lập tức khi có thay đổi.
 */
@Injectable({
  providedIn: 'root'
})
export class FirestoreRealtimeService implements OnDestroy {
  private productsApp: FirebaseApp | null = null;
  private productsDb: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private isListening = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // ms
  private isInitialLoad = true; // Flag để skip initial snapshot

  // Subject để emit product updates ra ngoài
  private productUpdates$ = new Subject<ProductRealtimeUpdate[]>();

  constructor() {
    this.initializeFirebaseProducts();
  }

  /**
   * Khởi tạo Firebase App riêng cho Products project
   */
  private initializeFirebaseProducts(): void {
    try {
      const config = environment.firebaseProducts;

      // Kiểm tra config có đầy đủ không
      if (!config || !config.projectId || !config.apiKey || config.apiKey.includes('xxxxx')) {
        console.warn('⚠️ [FirestoreRealtime] Firebase Products config chưa được cấu hình đầy đủ.');
        console.warn('   Vui lòng cập nhật apiKey, messagingSenderId, appId trong environment.ts');
        return;
      }

      // Kiểm tra xem app đã tồn tại chưa
      const appName = 'products-realtime';
      const existingApps = getApps();
      const existingApp = existingApps.find(app => app.name === appName);

      if (existingApp) {
        this.productsApp = existingApp;
        console.log('✅ [FirestoreRealtime] Reusing existing Firebase Products app');
      } else {
        this.productsApp = initializeApp(config, appName);
        console.log('✅ [FirestoreRealtime] Firebase Products app initialized');
      }

      this.productsDb = getFirestore(this.productsApp);
      console.log('✅ [FirestoreRealtime] Firestore Products connected');

    } catch (error) {
      console.error('❌ [FirestoreRealtime] Failed to initialize Firebase Products:', error);
    }
  }

  /**
   * Bắt đầu lắng nghe realtime changes từ products collection
   * Chỉ listen những products có LastModified trong 24h gần nhất để tiết kiệm reads
   * @param onUpdate Callback khi có product updates
   */
  startListening(onUpdate: (updates: ProductRealtimeUpdate[]) => void): void {
    if (this.isListening) {
      console.log('ℹ️ [FirestoreRealtime] Already listening to products');
      return;
    }

    if (!this.productsDb) {
      console.error('❌ [FirestoreRealtime] Firestore not initialized. Cannot start listening.');
      return;
    }

    try {
      const productsRef = collection(this.productsDb, 'products');

      // Listen toàn bộ collection, nhưng:
      // - Initial load sẽ được SKIP (không xử lý)
      // - Chỉ xử lý những thay đổi SAU initial load (type: 'modified')
      //
      // Về Firestore reads:
      // - Initial load: ~11,000 reads (1 lần duy nhất khi mở app)
      // - Sau đó: Chỉ 1 read cho mỗi document thay đổi
      // - Listener giữ connection, không đọc lại toàn bộ collection
      console.log('🔄 [FirestoreRealtime] Starting to listen for product changes (full collection)...');

      this.unsubscribe = onSnapshot(
        productsRef,
        { includeMetadataChanges: false }, // Chỉ lắng nghe server changes, không local
        (snapshot: QuerySnapshot<DocumentData>) => {
          this.handleSnapshot(snapshot, onUpdate);
        },
        (error) => {
          this.handleError(error, onUpdate);
        }
      );

      this.isListening = true;
      this.reconnectAttempts = 0;
      this.isInitialLoad = true; // Reset flag cho mỗi lần start listening
      console.log('✅ [FirestoreRealtime] Now listening for product changes (optimized query)');

    } catch (error) {
      console.error('❌ [FirestoreRealtime] Error starting listener:', error);
    }
  }

  /**
   * Xử lý snapshot từ Firestore
   */
  private handleSnapshot(
    snapshot: QuerySnapshot<DocumentData>,
    onUpdate: (updates: ProductRealtimeUpdate[]) => void
  ): void {
    // Skip initial load - chỉ xử lý những thay đổi SAU initial load
    if (this.isInitialLoad) {
      this.isInitialLoad = false;
      console.log(`📥 [FirestoreRealtime] Initial load completed: ${snapshot.size} products. Now listening for changes...`);
      return;
    }

    // Chỉ xử lý những documents thay đổi, không phải toàn bộ collection
    const changes = snapshot.docChanges();

    if (changes.length === 0) {
      return;
    }

    // Lọc ra những changes cần xử lý - CHỈ lấy 'modified' (không lấy 'added' vì đó là initial load)
    const updates: ProductRealtimeUpdate[] = [];

    for (const change of changes) {
      // Chỉ xử lý 'modified' - những document đã thay đổi
      // 'added' thường là từ initial load hoặc product mới (đã được xử lý ở luồng khác)
      if (change.type === 'modified') {
        const data = change.doc.data();
        updates.push({
          id: change.doc.id,
          OnHand: data['OnHand'],
          OnHandNV: data['OnHandNV'],
          BasePrice: data['BasePrice'],
          Cost: data['Cost'],
          Name: data['Name'],
          Code: data['Code'],
          FullName: data['FullName'],
          ...data
        });

        // Log all important fields for debugging
        console.log(`   🔄 [FirestoreRealtime] Product ${change.doc.id} modified:`, {
          OnHand: data['OnHand'],
          OnHandNV: data['OnHandNV'],
          Name: data['Name'],
          Code: data['Code'],
          BasePrice: data['BasePrice'],
          Cost: data['Cost']
        });
      }
    }

    if (updates.length > 0) {
      console.log(`📥 [FirestoreRealtime] Received ${updates.length} product updates (modified)`);

      // Emit updates
      this.productUpdates$.next(updates);
      onUpdate(updates);
    }
  }

  /**
   * Xử lý error và tự động reconnect
   */
  private handleError(
    error: any,
    onUpdate: (updates: ProductRealtimeUpdate[]) => void
  ): void {
    console.error('❌ [FirestoreRealtime] Listener error:', error);
    this.isListening = false;

    // Thử reconnect
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`🔄 [FirestoreRealtime] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

      setTimeout(() => {
        this.startListening(onUpdate);
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('❌ [FirestoreRealtime] Max reconnect attempts reached. Please refresh the page.');
    }
  }

  /**
   * Dừng lắng nghe
   */
  stopListening(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
      this.isListening = false;
      console.log('🛑 [FirestoreRealtime] Stopped listening for product changes');
    }
  }

  /**
   * Kiểm tra trạng thái listening
   */
  isCurrentlyListening(): boolean {
    return this.isListening;
  }

  /**
   * Observable để subscribe product updates
   */
  getProductUpdates$() {
    return this.productUpdates$.asObservable();
  }

  ngOnDestroy(): void {
    this.stopListening();
    this.productUpdates$.complete();
  }
}
