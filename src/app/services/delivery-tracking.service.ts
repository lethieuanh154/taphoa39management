import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable, BehaviorSubject } from 'rxjs';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDocs,
  onSnapshot, query, where, writeBatch,
  Firestore, Unsubscribe
} from 'firebase/firestore';
import { environment } from '../../environments/environment';
import { DeliveryTrackingDoc, DeliveryStatus, DeliveryRoute } from '../models/delivery.model';

const COLLECTION = 'deliveryTracking';

@Injectable({ providedIn: 'root' })
export class DeliveryTrackingService implements OnDestroy {
  private firebaseApp: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private unsubscribes: Unsubscribe[] = [];

  constructor() {
    this.initFirestore();
  }

  private initFirestore(): void {
    try {
      const config = (environment as any).firebaseChat;
      console.log('[DeliveryTracking-Mgmt] config:', config ? `projectId=${config.projectId}` : 'MISSING');
      if (!config?.projectId) return;

      const appName = 'delivery-tracking';
      const existing = getApps().find(app => app.name === appName);
      this.firebaseApp = existing || initializeApp(config, appName);
      this.db = getFirestore(this.firebaseApp);
      console.log('[DeliveryTracking-Mgmt] Firestore init OK, db:', !!this.db);
    } catch (e) {
      console.error('[DeliveryTracking-Mgmt] Init error:', e);
    }
  }

  /** Publish tracking docs for all orders in a route (batch write) */
  async publishRouteTracking(route: DeliveryRoute, routePolyline: [number, number][]): Promise<void> {
    console.log('[DeliveryTracking-Mgmt] publishRouteTracking called, db:', !!this.db, 'routeId:', route?.id, 'orders:', route?.orders?.length, 'polyline pts:', routePolyline?.length);
    if (!this.db) {
      console.error('[DeliveryTracking-Mgmt] ABORTED — db is null');
      return;
    }
    const batch = writeBatch(this.db);
    const colRef = collection(this.db, COLLECTION);

    for (const order of route.orders) {
      const docRef = doc(colRef, order.orderId);
      const trackingDoc: DeliveryTrackingDoc = {
        routeId: route.id,
        orderId: order.orderId,
        status: order.status,
        driverName: route.driverName,
        estimatedArrival: order.estimatedArrival,
        sequence: order.sequence,
        totalOrders: route.orders.length,
        routePolyline,
        storeLat: environment.storeLat,
        storeLng: environment.storeLng,
        customerLat: order.lat,
        customerLng: order.lng,
        updatedAt: new Date().toISOString()
      };
      console.log('[DeliveryTracking-Mgmt] batch.set:', order.orderId, 'lat:', order.lat, 'lng:', order.lng, 'status:', order.status);
      batch.set(docRef, trackingDoc);
    }
    try {
      await batch.commit();
      console.log('[DeliveryTracking-Mgmt] batch.commit OK — published', route.orders.length, 'docs');
    } catch (e) {
      console.error('[DeliveryTracking-Mgmt] batch.commit FAILED:', e);
    }
  }

  /** Update single order status */
  async updateOrderStatus(
    orderId: string,
    status: DeliveryStatus,
    extras?: { driverLat?: number; driverLng?: number }
  ): Promise<void> {
    if (!this.db) return;
    const docRef = doc(this.db, COLLECTION, orderId);
    const updates: any = {
      status,
      updatedAt: new Date().toISOString()
    };
    if (extras?.driverLat != null) updates.driverLat = extras.driverLat;
    if (extras?.driverLng != null) updates.driverLng = extras.driverLng;
    await setDoc(docRef, updates, { merge: true });
  }

  /** Listen to all tracking docs for a route */
  listenToRouteTracking(routeId: string): Observable<DeliveryTrackingDoc[]> {
    const subject = new BehaviorSubject<DeliveryTrackingDoc[]>([]);
    if (!this.db) return subject.asObservable();

    const colRef = collection(this.db, COLLECTION);
    const q = query(colRef, where('routeId', '==', routeId));

    const unsub = onSnapshot(q, snapshot => {
      const docs = snapshot.docs.map(d => d.data() as DeliveryTrackingDoc);
      subject.next(docs);
    }, err => {
      console.error('[DeliveryTracking] Route listen error:', err);
    });

    this.unsubscribes.push(unsub);
    return subject.asObservable();
  }

  /** Listen to single order tracking (for customer in DatHang) */
  listenToOrderTracking(orderId: string): Observable<DeliveryTrackingDoc | null> {
    const subject = new BehaviorSubject<DeliveryTrackingDoc | null>(null);
    if (!this.db) return subject.asObservable();

    const docRef = doc(this.db, COLLECTION, orderId);
    const unsub = onSnapshot(docRef, snapshot => {
      if (snapshot.exists()) {
        subject.next(snapshot.data() as DeliveryTrackingDoc);
      } else {
        subject.next(null);
      }
    }, err => {
      console.error('[DeliveryTracking] Order listen error:', err);
    });

    this.unsubscribes.push(unsub);
    return subject.asObservable();
  }

  /** Cleanup tracking docs for completed route */
  async clearTracking(routeId: string): Promise<void> {
    if (!this.db) return;
    const colRef = collection(this.db, COLLECTION);
    const q = query(colRef, where('routeId', '==', routeId));
    const snapshot = await getDocs(q);
    const batch = writeBatch(this.db);
    snapshot.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  /** Disconnect all listeners */
  disconnectAll(): void {
    this.unsubscribes.forEach(unsub => unsub());
    this.unsubscribes = [];
  }

  ngOnDestroy(): void {
    this.disconnectAll();
  }
}
