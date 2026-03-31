import { Injectable, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { catchError, firstValueFrom, Observable, of, Subject } from 'rxjs';
import { IndexedDBService } from './indexed-db.service';
import { FirebaseService } from './firebase.service';
import { TimeZoneService } from './time-zone.service';
import { OrderWebSocketService } from './order-websocket.service';

@Injectable({
  providedIn: 'root'
})
export class OrderService {
  private dbName = 'Orders';
  private dbVersion = 3; // Synchronized with CategoryService version
  private storeName = 'order';

  // Real-time event subjects
  private orderCreatedSubject = new Subject<any>();
  private orderUpdatedSubject = new Subject<any>();
  private orderDeletedSubject = new Subject<string>();
  private syncCompletedSubject = new Subject<void>();

  // Public observables
  public orderCreated$ = this.orderCreatedSubject.asObservable();
  public orderUpdated$ = this.orderUpdatedSubject.asObservable();
  public orderDeleted$ = this.orderDeletedSubject.asObservable();
  public syncCompleted$ = this.syncCompletedSubject.asObservable();

  private lastSyncTimestamp: Date | null = null;
  private syncInProgress = false;

  constructor(
    private http: HttpClient,
    private indexedDBService: IndexedDBService,
    private timeZoneService: TimeZoneService,
    private firebaseService: FirebaseService,
    private orderWebSocket: OrderWebSocketService
  ) {
    this.subscribeToWebSocketEvents();
  }

  private subscribeToWebSocketEvents(): void {
    this.orderWebSocket.orderCreated$.subscribe(order => {
      if (order) this.handleOrderCreated(order);
    });
    this.orderWebSocket.orderUpdated$.subscribe(order => {
      if (order) this.handleOrderUpdated(order);
    });
    this.orderWebSocket.orderDeleted$.subscribe(orderId => {
      if (orderId) this.handleOrderDeleted(orderId);
    });
  }


  async initDB(): Promise<void> {
    try {
      const upgradeFn = (db: any) => {
        if (!db.objectStoreNames.contains(this.storeName)) {
          const orders = db.createObjectStore('order', { keyPath: 'id' });
          orders.createIndex('name', 'name', { unique: false });
          orders.createIndex('TotalPrice', 'totalPrice', { unique: false });
          console.log(`✅ Đã tạo object store 'order' thành công`);
        }
       
      };

      await this.indexedDBService.getDB(this.dbName, this.dbVersion, upgradeFn);

      const stores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
      if (!stores.includes(this.storeName)) {
        console.warn(`⚠️ Object store '${this.storeName}' missing in DB '${this.dbName}', attempting upgrade`);
        await this.indexedDBService.closeDB(this.dbName);
        await this.indexedDBService.getDB(this.dbName, this.dbVersion + 1, upgradeFn);
      }

    } catch (error) {
      console.error('❌ Error initializing IndexedDB:', error);
    }
  }

  // CRUD for IndexedDB
  async getOrderFromDBById(id: string): Promise<any | undefined> {
    await this.initDB();
    return await this.indexedDBService.getByKey(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
  }

  async getAllOrdersFromDB(): Promise<any[]> {
    await this.initDB();
    return await this.indexedDBService.getAll(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  async addOrderToDB(order: any): Promise<void> {
    await this.initDB();
    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      this.storeName,
      order
    );
  }

  async updateOrderInDB(order: any): Promise<void> {
    await this.initDB();
    await this.indexedDBService.put(
      this.dbName,
      this.dbVersion,
      this.storeName,
      order
    );
  }

  async deleteOrderFromDB(id: string): Promise<void> {
    await this.initDB();
    await this.indexedDBService.delete(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
  }

  async clearAllOrdersFromDB(): Promise<void> {
    await this.initDB();
    await this.indexedDBService.clear(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  // API methods (TODO: update endpoints when backend is ready)
  addOrderToFirestore(orderData: any): Observable<any> {
    return this.http.post(`${environment.domainUrl}/api/firebase/add_order`, orderData);
  }

  updateOrderToFirestore(orderId: string, updates: any): Observable<any> {
    return this.http.put(`${environment.domainUrl}/api/firebase/update_order/${orderId}`, updates);
  }

  getAllOrdersFromFirestore(): Observable<any> {
    return this.http.get(`${environment.domainUrl}/api/firebase/orders`);
  }

  deleteOrderToFirestore(orderId: string): Observable<any> {
    return this.http.delete(`${environment.domainUrl}/api/firebase/orders/${orderId}`);
  }

  getOrderByIdFromFirestore(orderId: string): Observable<any> {
    return this.http.get(`${environment.domainUrl}/api/firebase/orders/${orderId}`);
  }

  getOrdersByDateFromFirestore(date: string): Observable<any> {
    return this.http.get(`${environment.domainUrl}/api/firebase/orders/date`, {
      params: { date }
    });
  }

  // IndexedDB filter by date
  async getOrdersByDateFromDB(date: Date): Promise<any[]> {
    await this.initDB();
    const allOrders = await this.getAllOrdersFromDB();
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return allOrders.filter(order => {
      if (!order.createdDate) return false;
      try {
        const orderDate = new Date(order.createdDate);
        if (isNaN(orderDate.getTime())) return false;
        return orderDate >= startOfDay && orderDate <= endOfDay;
      } catch {
        return false;
      }
    });
  }

  private async initializeSocketIfNeeded(): Promise<void> {
    this.orderWebSocket.connect();
  }

  private async handleOrderCreated(order: any): Promise<void> {
    try {
      const existing = await this.getOrderFromDBById(order.id);
      if (!existing) {
        await this.addOrderToDB(order);
        this.orderCreatedSubject.next(order);
      }
    } catch (error) {
      console.error('❌ Error handling order created:', error);
    }
  }

  private async handleOrderUpdated(order: any): Promise<void> {
    try {
      await this.updateOrderInDB(order);
      this.orderUpdatedSubject.next(order);
    } catch (error) {
      console.error('❌ Error handling order updated:', error);
    }
  }

  private async handleOrderDeleted(orderId: string): Promise<void> {
    try {
      await this.deleteOrderFromDB(orderId);
      this.orderDeletedSubject.next(orderId);
    } catch (error) {
      console.error('❌ Error handling order deleted:', error);
    }
  }

  private async handleSyncRequest(data: any): Promise<void> {
    // Socket-based sync requests are no longer supported. Trigger a local
    // sync-completed notification so callers can reconcile if needed.
    try {
      const localOrders = await this.getAllOrdersFromDB();
      this.syncCompletedSubject.next();
    } catch (error) {
      console.error('❌ Error handling sync request (REST mode):', error);
      this.syncCompletedSubject.next();
    }
  }

  // REST-first notify methods. These replace socket emits: they call the
  // backend REST API and then refresh the authoritative document into
  // IndexedDB so the UI becomes server-authoritative.
  public async notifyOrderCreated(order: any): Promise<void> {
    try {
      const resp = await firstValueFrom(this.addOrderToFirestore(order).pipe(catchError(err => of(err))));
      // Try to fetch the created order from server if an id is returned
      const createdId = resp && (resp.id || resp.data?.id || resp.insertedId || resp.name);
      if (createdId) {
        try {
          const serverOrder = await firstValueFrom(this.getOrderByIdFromFirestore(createdId).pipe(catchError(err => of(null))));
          if (serverOrder) {
            await this.addOrderToDB(serverOrder);
            this.orderCreatedSubject.next(serverOrder);
            return;
          }
        } catch { }
      }
      // Fallback: persist locally and emit event so UI stays responsive
      await this.addOrderToDB(order);
      this.orderCreatedSubject.next(order);
    } catch (error) {
      console.error('❌ notifyOrderCreated failed, saving locally:', error);
      await this.addOrderToDB(order);
      this.orderCreatedSubject.next(order);
    }
  }

  public async notifyOrderUpdated(order: any): Promise<void> {
    try {
      if (!order || !order.id) {
        // Can't update without id
        await this.updateOrderInDB(order);
        this.orderUpdatedSubject.next(order);
        return;
      }
      await firstValueFrom(this.updateOrderToFirestore(order.id, order).pipe(catchError(err => of(err))));
      try {
        const serverOrder = await firstValueFrom(this.getOrderByIdFromFirestore(order.id).pipe(catchError(err => of(null))));
        if (serverOrder) {
          await this.updateOrderInDB(serverOrder);
          this.orderUpdatedSubject.next(serverOrder);
          return;
        }
      } catch { }
      // Fallback: update local DB and emit
      await this.updateOrderInDB(order);
      this.orderUpdatedSubject.next(order);
    } catch (error) {
      console.error('❌ notifyOrderUpdated failed, updating locally:', error);
      await this.updateOrderInDB(order);
      this.orderUpdatedSubject.next(order);
    }
  }

  public async notifyOrderDeleted(orderId: string): Promise<void> {
    try {
      await firstValueFrom(this.deleteOrderToFirestore(orderId).pipe(catchError(err => of(err))));
      try {
        await this.deleteOrderFromDB(orderId);
        this.orderDeletedSubject.next(orderId);
        return;
      } catch { }
      // Fallback: still emit deletion event
      this.orderDeletedSubject.next(orderId);
    } catch (error) {
      console.error('❌ notifyOrderDeleted failed, deleting locally:', error);
      try {
        await this.deleteOrderFromDB(orderId);
      } catch { }
      this.orderDeletedSubject.next(orderId);
    }
  }

  public disconnectSocket(): void {
    this.orderWebSocket.disconnect();
  }
  public async initializeWebSocket(): Promise<void> {
    this.orderWebSocket.connect();
  }
  public isWebSocketConnected(): boolean {
    return this.orderWebSocket.isCurrentlyConnected();
  }
  public getWebSocketStatus(): { connected: boolean; initialized: boolean; socketExists: boolean } {
    const connected = this.orderWebSocket.isCurrentlyConnected();
    return { connected, initialized: connected, socketExists: true };
  }
  public async getLastSyncTime(): Promise<Date | null> {
    if (this.lastSyncTimestamp) {
      return this.lastSyncTimestamp;
    }
    return null;
  }
  public async needsSync(): Promise<boolean> {
    // TODO: Implement logic to check if sync is needed
    return true;
  }
  // Sync logic (placeholder)
  public async syncOrdersBetweenFirestoreAndIndexedDB(forceFullSync = false): Promise<void> {
    try {
      // 1. Lấy tất cả order từ Firestore
      const ordersResponse = await firstValueFrom(this.getAllOrdersFromFirestore());
      let orders: any[] = [];
      if (Array.isArray(ordersResponse)) {
        orders = ordersResponse;
      } else if (ordersResponse && Array.isArray(ordersResponse.data)) {
        orders = ordersResponse.data;
      } else if (ordersResponse && Array.isArray(ordersResponse.orders)) {
        orders = ordersResponse.orders;
      } else if (ordersResponse && typeof ordersResponse === 'object') {
        // fallback: flatten all values
        orders = Object.values(ordersResponse).flat();
      }
      // 2. Luôn xóa hết order cũ để đảm bảo data khớp 100% với server
      await this.clearAllOrdersFromDB();
      // 3. Lưu từng order vào IndexedDB
      if (orders && orders.length > 0) {
        for (const order of orders) {
          await this.addOrderToDB(order);
        }
        console.log(`✅ Đã đồng bộ ${orders.length} order từ Firestore vào IndexedDB`);
      } else {
        console.log('ℹ️ Không có order nào từ Firestore');
      }
      this.syncCompletedSubject.next();
    } catch (error) {
      console.error('❌ Lỗi khi đồng bộ order từ Firestore về IndexedDB:', error);
      this.syncCompletedSubject.next();
    }
  }
}
