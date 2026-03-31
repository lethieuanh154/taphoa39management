import { Injectable, OnDestroy } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore, collection, onSnapshot, query, orderBy,
  Firestore, Unsubscribe
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

/**
 * Real-time order sync via Firestore onSnapshot.
 *
 * BanHang (Render) and DatHang (VN server) run on different servers,
 * so WebSocket events don't reach across. Instead, both backends write
 * notification docs to the shared `taphoa39khachhang` Firestore project
 * (`orderNotifications` collection), and this service listens via onSnapshot.
 *
 * Pattern follows ChatService (chat-bubble).
 */
@Injectable({
  providedIn: 'root'
})
export class OrderWebSocketService implements OnDestroy {
  private firebaseApp: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private unsubscribe: Unsubscribe | null = null;
  private isListening = false;
  private isInitialSnapshot = true;
  private knownDocIds = new Set<string>();

  private orderCreatedSubject = new Subject<any>();
  private orderUpdatedSubject = new Subject<any>();
  private orderDeletedSubject = new Subject<string>();
  private connectionStatus$ = new BehaviorSubject<'connected' | 'disconnected' | 'connecting'>('disconnected');

  public orderCreated$ = this.orderCreatedSubject.asObservable();
  public orderUpdated$ = this.orderUpdatedSubject.asObservable();
  public orderDeleted$ = this.orderDeletedSubject.asObservable();

  constructor() {
    this.initFirestore();
  }

  private initFirestore(): void {
    try {
      const config = (environment as any).firebaseChat;
      if (!config?.projectId) {
        console.warn('[OrderRealtime] firebaseChat config not found');
        return;
      }

      const appName = 'order-realtime';
      const existing = getApps().find(app => app.name === appName);
      this.firebaseApp = existing || initializeApp(config, appName);
      this.db = getFirestore(this.firebaseApp);
    } catch (error) {
      console.error('[OrderRealtime] Failed to init Firestore:', error);
    }
  }

  connect(): void {
    if (this.isListening) return;
    if (!this.db) {
      console.warn('[OrderRealtime] Firestore not initialized, cannot listen');
      return;
    }

    this.connectionStatus$.next('connecting');
    this.isInitialSnapshot = true;
    this.knownDocIds.clear();

    const notifRef = collection(this.db, 'orderNotifications');
    const q = query(notifRef, orderBy('timestamp', 'desc'));

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      if (this.isInitialSnapshot) {
        // Mark all existing docs as known, don't process them
        this.isInitialSnapshot = false;
        snapshot.docs.forEach(doc => this.knownDocIds.add(doc.id));
        this.isListening = true;
        this.connectionStatus$.next('connected');
        console.log(`[OrderRealtime] Connected, ${snapshot.docs.length} existing notifications skipped`);
        return;
      }

      // Process only new docs
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added' && !this.knownDocIds.has(change.doc.id)) {
          this.knownDocIds.add(change.doc.id);
          const data = change.doc.data();
          const action = data['action'];
          const order = data['order'];
          const orderId = data['orderId'];

          console.log(`[OrderRealtime] ${action}: ${orderId}`);

          if (action === 'created' && order) {
            this.orderCreatedSubject.next(order);
          } else if (action === 'updated' && order) {
            this.orderUpdatedSubject.next(order);
          } else if (action === 'deleted' && orderId) {
            this.orderDeletedSubject.next(orderId);
          }
        }
      });
    }, (error) => {
      console.error('[OrderRealtime] onSnapshot error:', error);
      this.isListening = false;
      this.connectionStatus$.next('disconnected');
    });
  }

  isCurrentlyConnected(): boolean {
    return this.isListening;
  }

  getConnectionStatus$() {
    return this.connectionStatus$.asObservable();
  }

  disconnect(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.isListening = false;
    this.isInitialSnapshot = true;
    this.knownDocIds.clear();
    this.connectionStatus$.next('disconnected');
  }

  ngOnDestroy(): void {
    this.disconnect();
    this.orderCreatedSubject.complete();
    this.orderUpdatedSubject.complete();
    this.orderDeletedSubject.complete();
    this.connectionStatus$.complete();
  }
}
