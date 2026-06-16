import { Injectable } from '@angular/core';
import { Product } from '../models/product.model';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { catchError, of } from 'rxjs';
import { VietnameseService } from '../services/vietnamese.service';
import { KiotvietService, KiotVietSuggestProduct } from '../services/kiotviet.service';
import { FirebaseService } from '../services/firebase.service';
import { IndexedDBService } from './indexed-db.service';
import { FirestoreRealtimeService, ProductRealtimeUpdate as FirestoreProductUpdate } from './firestore-realtime.service';
import { WebSocketRealtimeService, ProductWebSocketUpdate } from './websocket-realtime.service';
import { Observable, Subscription } from 'rxjs';
import { InvoiceTab } from '../models/invoice.model';
import { Subject } from 'rxjs';
import { ProductHistoryService } from './product-history.service';
import { HistoryTag } from '../models/product-history.model';

type ProductRealtimeUpdate = {
  productId: number;
  onHand?: number;
  onHandNV?: number; // ✅ Thêm OnHandNV
  basePrice?: number;
  cost?: number;
  code?: string;
  name?: string;
  fullName?: string;
};

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private dbName = 'SalesDB';
  private orderDBName = 'Orders';
  private dbVersion = 6;
  private storeName = 'products';

  // Cache mechanism để tránh gọi API trùng lặp
  private firebaseProductsCache: Product[] | null = null;
  private cacheTimestamp = 0;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 phút

  // Debounce mechanism để tránh gọi saveAllProductsToFirebase trùng lặp
  private saveToFirebaseTimeout: any = null;
  private pendingProductsToSave: Product[] = [];
  private isSavingToFirebase = false;

  // Counter để theo dõi số lần gọi API
  private apiCallCount = 0;
  private cacheHitCount = 0;

  // Shared Promise để tránh gọi API đồng thời
  private currentFirebaseRequest: Promise<Product[]> | null = null;

  // Guard to prevent duplicate sync calls
  private isSyncing = false;
  private syncPromise: Promise<any> | null = null;

  // WebSocket removed: keep pending queues and retry helpers for HTTP-only fallback
  // Queue for pending notifications when socket/http unavailable
  private pendingOnHandNotifications: { productId: number; onHand?: number; basePrice?: number; timestamp: number }[] = [];
  // Queue for pending local IndexedDB applies when product record isn't present yet (e.g., race with initial sync)
  private pendingOnHandLocalApplies: Map<number, {
    onHand?: number;
    basePrice?: number;
    cost?: number;
    code?: string;
    name?: string;
    fullName?: string;
    attempts: number;
  }> = new Map();

  // Real-time event subject (used to broadcast updates to UI)
  private productOnHandUpdatedSubject = new Subject<ProductRealtimeUpdate>();
  public productOnHandUpdated$ = this.productOnHandUpdatedSubject.asObservable();

  // IndexedDB search cache to keep search responsive
  private indexedDbProductsCache: Product[] | null = null;
  private indexedDbCacheTimestamp = 0;
  private readonly INDEXED_DB_CACHE_DURATION = 5000;
  private readonly SEARCH_RESULT_LIMIT = 80;
  private readonly DEFAULT_UNIT_LABEL = '---';
  private productSearchIndex = new Map<number, { normalizedName: string; rawLowerName: string; codeLower: string }>();

  private normalizeUnitValue(unit?: string | null): string {
    if (typeof unit === 'string') {
      const trimmed = unit.trim();
      if (trimmed.length > 0 && trimmed.toLowerCase() !== 'null') {
        return trimmed;
      }
    }
    return this.DEFAULT_UNIT_LABEL;
  }

  private sanitizeProductForStorage(product: Product): Product {
    if (!product) {
      return product;
    }
    let result = product;
    const sanitizedUnit = this.normalizeUnitValue(product.Unit);
    if (product.Unit !== sanitizedUnit) {
      result = { ...result, Unit: sanitizedUnit };
    }

    // Regenerate NormalizedCode if Code changed but NormalizedCode wasn't updated
    const currentCode = (product.Code || '').toLowerCase();
    const storedNormalizedCode = (product as any).NormalizedCode || '';
    if (currentCode && storedNormalizedCode !== currentCode) {
      result = result === product ? { ...result } : result;
      (result as any).NormalizedCode = currentCode;
    }

    // Regenerate NormalizedName if Name changed but NormalizedName wasn't updated
    const currentName = (product.Name || '').trim();
    if (currentName) {
      const freshNormalizedName = this.vi.normalizeAndTokenize(currentName).join(' ').toLowerCase();
      const storedNormalizedName = (product as any).NormalizedName || '';
      if (storedNormalizedName !== freshNormalizedName) {
        result = result === product ? { ...result } : result;
        (result as any).NormalizedName = freshNormalizedName;
      }
    }

    return result;
  }

  private ensureUnitOnProduct(product: Product | undefined | null): Product | undefined | null {
    if (!product) {
      return product;
    }
    const normalizedUnit = this.normalizeUnitValue(product.Unit);
    if (product.Unit !== normalizedUnit) {
      product.Unit = normalizedUnit;
    }
    return product;
  }


  private parseFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return null;
      }
      value = trimmed;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // WebSocket subscription for cleanup
  private wsSubscription: Subscription | null = null;

  constructor(
    private http: HttpClient,
    private vi: VietnameseService,
    private indexedDBService: IndexedDBService,
    private kiotvietService: KiotvietService,
    private firebaseService: FirebaseService,
    private firestoreRealtimeService: FirestoreRealtimeService,
    private webSocketRealtimeService: WebSocketRealtimeService,
    private productHistoryService: ProductHistoryService
  ) {
    // Realtime sync will be initialized via initializeProductWebSocket()
    // Using WebSocket (Hybrid solution) instead of Firestore onSnapshot to save reads
  }

  async initDB(): Promise<void> {
    try {
      console.log('🔄 Khởi tạo ProductService IndexedDB...');

      // Prepare upgrade function so we can reuse it if we need to bump version to create missing stores
      const upgradeFn = (db: any) => {
        console.log(`📦 Đang tạo object store '${this.storeName}' cho database '${this.dbName}' v${this.dbVersion}`);

        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'Id' });
          store.createIndex('Name', 'Name', { unique: false });
          store.createIndex('MasterProductId', 'MasterProductId', { unique: false });
          store.createIndex('Code', 'Code', { unique: false });
        } else {
          console.log(`ℹ️ Object store '${this.storeName}' đã tồn tại`);
        }


      };

      // Try opening with the configured version first
      await this.indexedDBService.getDB(this.dbName, this.dbVersion, upgradeFn);

      // Double-check object stores exist; if not, attempt an upgrade by bumping version by 1
      const stores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
      const missingStores = [this.storeName].filter(s => !stores.includes(s));
      if (missingStores.length > 0) {
        console.warn(`⚠️ Phát hiện missing stores (${missingStores.join(',')}) in ${this.dbName} v${this.dbVersion}, attempting upgrade to create them`);
        // Close current connection and open with higher version to trigger upgrade callback
        await this.indexedDBService.closeDB(this.dbName);
        await this.indexedDBService.getDB(this.dbName, this.dbVersion + 1, upgradeFn);
      }

      console.log('✅ ProductService IndexedDB đã sẵn sàng');
    } catch (error) {
      console.error('❌ Lỗi khi khởi tạo ProductService IndexedDB:', error);
      throw error;
    }
  }

  // Method để kiểm tra và đảm bảo IndexedDB đã được khởi tạo
  private async ensureDBInitialized(): Promise<void> {
    try {
      await this.ensureConnectionOpen();

      // Kiểm tra xem object store có tồn tại không
      const storeExists = await this.indexedDBService.checkObjectStoreExists(this.dbName, this.dbVersion, this.storeName);
      if (!storeExists) {
        console.warn(`⚠️ Object store '${this.storeName}' không tồn tại, đang khởi tạo lại...`);
        await this.initDB();
      }
    } catch (error) {
      console.error('❌ Lỗi khi đảm bảo IndexedDB được khởi tạo:', error);
      // Thử khởi tạo lại
      await this.initDB();
    }
  }

  private async ensureConnectionOpen(): Promise<void> {
    if (this.indexedDBService.isConnectionOpen(this.dbName)) {
      return;
    }

    console.warn('⚠️ Kết nối IndexedDB đã đóng, đang mở lại trước khi thao tác...');
    await this.indexedDBService.closeDB(this.dbName).catch(() => {/* ignore */ });
    await this.initDB();
  }

  public async fetchAllProductsFromBackend(): Promise<Product[]> {
    try {
      await this.ensureConnectionOpen();
      const payload = await firstValueFrom(
        this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi gọi API products:', err);
            return of([]);
          })
        )
      ) ?? [];

      const products = this.normalizeProductApiPayload(payload);
      if (products.length === 0) {
        console.warn('⚠️ API products payload hợp lệ nhưng không có sản phẩm.');
      } else {
        console.log(`📦 API products payload sau normalize: ${products.length} sản phẩm.`);
      }
      return products;
    } catch (error) {
      console.error('❌ Lỗi khi lấy danh sách sản phẩm từ backend:', error);
      return [];
    }
  }

  // Refactored: Accept apiProducts as optional parameter
  async loadItemsFromKiotVietToIndexedDB(apiProducts?: Product[] | Record<string, unknown> | null): Promise<void> {
    // Đảm bảo IndexedDB đã được khởi tạo
    await this.ensureDBInitialized();

    let rawPayload: unknown = apiProducts;
    if (!rawPayload) {
      // Gọi API lấy toàn bộ sản phẩm từ KiotViet
      rawPayload = await firstValueFrom(
        this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi tải tất cả sản phẩm từ KiotViet:', err);
            return of([]);
          })
        )
      ) ?? [];
    }

    const allProducts = this.normalizeProductApiPayload(rawPayload);

    if (allProducts.length === 0) {
      console.log('ℹ️ Không có sản phẩm nào từ KiotViet');
      return;
    }

    console.log(`📦 Nhận được ${allProducts.length} sản phẩm từ KiotViet`);

    // Lọc và validate products
    const validProducts = allProducts.filter((product: Product) => {
      if (!product || !product.Id) {
        console.warn('⚠️ Product không hợp lệ:', product);
        return false;
      }
      return true;
    });

    if (validProducts.length === 0) {
      console.warn('⚠️ Không có products hợp lệ nào từ KiotViet');
      return;
    }

    console.log(`✅ Có ${validProducts.length} products hợp lệ từ KiotViet`);

    // Lấy toàn bộ sản phẩm đang có trong IndexedDB
    const existingProducts: Product[] = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

    // ✅ Thực hiện cleanup: xóa products trong IndexedDB mà không có trong API
    await this.cleanupOrphanedProducts(existingProducts, validProducts);

    const existingMap = new Map(existingProducts.map(p => [p.Id, p]));

    // Chuẩn bị danh sách sản phẩm cần cập nhật
    const productsToUpdate: Product[] = [];

    for (const product of validProducts) {
      const existing = existingMap.get(product.Id);

      // Tạo bản sao của product để không ảnh hưởng đến dữ liệu gốc
      const productToUpdate = this.sanitizeProductForStorage(product);

      if (existing) {
        // Kiểm tra xem có thay đổi gì không (trừ OnHand)
        const hasChanges = this.hasProductChanges(existing, product);
        if (hasChanges) {
          console.log(`🔄 Phát hiện thay đổi cho product ${product.Id} (${product.Name})`);
          this.logProductChanges(existing, product);
          productsToUpdate.push(productToUpdate);
        } else {
          console.log(`ℹ️ Product ${product.Id} (${product.Name}) không có thay đổi`);
        }
      } else {
        // Product mới, thêm vào danh sách cập nhật
        console.log(`🆕 Thêm product mới: ${product.Id} (${product.Name})`);
        productsToUpdate.push(productToUpdate);
      }
    }

    // Cập nhật nhiều sản phẩm cùng lúc nếu có thay đổi
    if (productsToUpdate.length > 0) {
      console.log(`🔄 Cập nhật ${productsToUpdate.length} sản phẩm vào IndexedDB...`);

      await this.indexedDBService.putMany(
        this.dbName,
        this.dbVersion,
        this.storeName,
        productsToUpdate
      );

      console.log(`✅ Đã cập nhật ${productsToUpdate.length} sản phẩm từ KiotViet vào IndexedDB`);

      this.invalidateIndexedDbCache();

      // Đồng bộ lên Firestore (không thay đổi OnHand)
      console.log('🔄 Đồng bộ sản phẩm lên Firestore...');
      await this.syncProductsToFirestoreWithoutOnHand(productsToUpdate);

      // Đợi một chút để Firestore được cập nhật
      console.log('⏳ Đợi Firestore cập nhật...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Sync từ Firestore về IndexedDB để đảm bảo dữ liệu đồng bộ
      // Chỉ sync nếu cache quá cũ hoặc không có cache
      if (this.shouldClearCache()) {
        console.log('🔄 Cache quá cũ, sync từ Firestore về IndexedDB...');
        await this.syncProductsFromFirebaseToIndexedDB();
      } else {
        console.log('ℹ️ Cache còn mới, bỏ qua sync từ Firestore về IndexedDB');
      }

    } else {
      console.log('ℹ️ Tất cả sản phẩm đã được đồng bộ, không cần cập nhật');
    }
  }

  public async ensureIndexedDbSeeded(apiProducts?: Product[] | Record<string, unknown> | null): Promise<boolean> {
    try {
      await this.ensureDBInitialized();

      const storeExists = await this.indexedDBService.checkObjectStoreExists(
        this.dbName,
        this.dbVersion,
        this.storeName
      );

      if (!storeExists) {
        console.warn(`⚠️ Object store '${this.storeName}' chưa tồn tại, đang khởi tạo lại...`);
        await this.initDB();
      }

      const productCount = await this.indexedDBService
        .count(this.dbName, this.dbVersion, this.storeName)
        .catch(err => {
          console.error('❌ Lỗi khi đếm products trong IndexedDB:', err);
          return 0;
        });

      if (productCount > 0) {
        console.log('ℹ️ IndexedDB đã có dữ liệu sản phẩm, bỏ qua bước seed.');
        return false;
      }

      console.log('📥 IndexedDB trống hoặc chưa có sản phẩm, đang seed dữ liệu từ KiotViet...');
      await this.loadItemsFromKiotVietToIndexedDB(apiProducts);
      return true;
    } catch (error) {
      console.error('❌ Lỗi khi đảm bảo IndexedDB có dữ liệu sản phẩm:', error);
      return false;
    }
  }

  public async countProductsInIndexedDb(): Promise<number> {
    try {
      await this.ensureDBInitialized();
      const total = await this.indexedDBService
        .count(this.dbName, this.dbVersion, this.storeName)
        .catch(err => {
          console.error('❌ Lỗi khi đếm sản phẩm trong IndexedDB:', err);
          return 0;
        });
      return total ?? 0;
    } catch (error) {
      console.error('❌ Lỗi khi lấy số lượng sản phẩm trong IndexedDB:', error);
      return 0;
    }
  }

  public async reseedIndexedDbWithApiProducts(products: Product[] | null | undefined): Promise<number> {
    if (!products || products.length === 0) {
      console.warn('⚠️ Không có dữ liệu sản phẩm để reseed IndexedDB.');
      return 0;
    }

    await this.ensureDBInitialized();

    const validProducts = products.filter((product): product is Product => !!product && !!product.Id);
    if (validProducts.length === 0) {
      console.warn('⚠️ Không có sản phẩm hợp lệ để reseed IndexedDB.');
      return 0;
    }

    // Preserve OnHand và OnHandNV từ dữ liệu hiện tại nếu có
    // CRITICAL: Clone products chỉ có OnHandNV (không sync từ KiotViet)
    const existingProducts: Product[] = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    ).catch(() => []);

    // Map để preserve cả OnHand và OnHandNV
    const onHandMap = new Map<number, number>();
    const onHandNVMap = new Map<number, number>();
    const cloneDataMap = new Map<number, {
      isClone: boolean;
      CloneMasterSourceId?: string;
      CloneSourceId?: string;
      BasePrice?: number;
      Cost?: number;
      Description?: string;
      OrderTemplate?: string;
    }>();

    for (const existing of existingProducts) {
      if (!existing || !existing.Id) {
        continue;
      }
      const parsedOnHand = this.parseFiniteNumber(existing.OnHand);
      if (parsedOnHand !== null) {
        onHandMap.set(existing.Id, parsedOnHand);
      }
      // CRITICAL: Preserve OnHandNV cho clone products
      const parsedOnHandNV = this.parseFiniteNumber(existing.OnHandNV);
      if (parsedOnHandNV !== null) {
        onHandNVMap.set(existing.Id, parsedOnHandNV);
      }
      // Preserve clone metadata + BasePrice/Cost
      if ((existing as any).isClone) {
        cloneDataMap.set(existing.Id, {
          isClone: true,
          CloneMasterSourceId: (existing as any).CloneMasterSourceId,
          CloneSourceId: (existing as any).CloneSourceId,
          BasePrice: this.parseFiniteNumber(existing.BasePrice) ?? undefined,
          Cost: this.parseFiniteNumber(existing.Cost) ?? undefined,
          Description: (existing as any).Description || '',
          OrderTemplate: (existing as any).OrderTemplate || ''
        });
      }
    }

    const sanitizedProducts = validProducts.map((product) => {
      const sanitized = this.sanitizeProductForStorage({ ...product });

      // Kiểm tra xem product từ API có phải là clone không
      const isCloneFromAPI = (product as any).isClone === true;

      // CRITICAL FIX: Chỉ preserve OnHand từ IndexedDB cho CLONE products
      // Original products phải dùng OnHand từ KiotViet (source of truth)
      if (isCloneFromAPI) {
        const preservedOnHand = onHandMap.get(product.Id!);
        if (preservedOnHand !== undefined) {
          sanitized.OnHand = preservedOnHand;
        }
      }
      // Nếu không phải clone, giữ nguyên OnHand từ API (KiotViet)

      // CRITICAL: Preserve OnHandNV - đặc biệt quan trọng cho clone products
      // OnHandNV chỉ tồn tại trong Firebase/IndexedDB, không có trong KiotViet
      const preservedOnHandNV = onHandNVMap.get(product.Id!);
      if (preservedOnHandNV !== undefined) {
        sanitized.OnHandNV = preservedOnHandNV;
      }

      // Preserve clone metadata + BasePrice/Cost nếu product là clone
      const cloneData = cloneDataMap.get(product.Id!);
      if (cloneData) {
        (sanitized as any).isClone = cloneData.isClone;
        if (cloneData.CloneMasterSourceId) {
          (sanitized as any).CloneMasterSourceId = cloneData.CloneMasterSourceId;
        }
        if (cloneData.CloneSourceId) {
          (sanitized as any).CloneSourceId = cloneData.CloneSourceId;
        }
        // CRITICAL: Preserve BasePrice/Cost cho clone products
        // Clone products không có trên KiotViet, nên API có thể trả về giá cũ từ cache.
        // Giá đã edit trong IndexedDB là source of truth cho clone.
        if (cloneData.BasePrice !== undefined) {
          sanitized.BasePrice = cloneData.BasePrice;
        }
        if (cloneData.Cost !== undefined) {
          sanitized.Cost = cloneData.Cost;
        }
        if (cloneData.Description !== undefined) {
          (sanitized as any).Description = cloneData.Description;
        }
        if (cloneData.OrderTemplate !== undefined) {
          (sanitized as any).OrderTemplate = cloneData.OrderTemplate;
        }
      }
      return sanitized;
    });

    // Debug log để verify OnHand được xử lý đúng
    const cloneCount = sanitizedProducts.filter((p: any) => p.isClone === true).length;
    const originalCount = sanitizedProducts.length - cloneCount;
    console.log(`📊 [reseedIndexedDB] Products: ${originalCount} original (OnHand from API), ${cloneCount} clone (OnHand preserved)`);

    await this.indexedDBService.clear(this.dbName, this.dbVersion, this.storeName);
    await this.indexedDBService.putMany(this.dbName, this.dbVersion, this.storeName, sanitizedProducts);
    this.invalidateIndexedDbCache();
    console.log(`✅ Đã reseed IndexedDB với ${sanitizedProducts.length} sản phẩm (OnHand: original từ API, clone preserved).`);
    return sanitizedProducts.length;
  }

  public async hasIndexedDbProducts(): Promise<boolean> {
    try {
      await this.ensureDBInitialized();
      const count = await this.indexedDBService
        .count(this.dbName, this.dbVersion, this.storeName)
        .catch((err) => {
          console.warn('⚠️ Không thể đếm số sản phẩm trong IndexedDB:', err);
          return 0;
        });
      return (count ?? 0) > 0;
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra trạng thái IndexedDB sản phẩm:', error);
      return false;
    }
  }

  // ✅ Method mới để cleanup products trong IndexedDB mà không có trong API
  private async cleanupOrphanedProducts(existingProducts: Product[], apiProducts: Product[]): Promise<void> {
    try {
      console.log('🧹 Bắt đầu cleanup orphaned products...');

      // Tạo Set các product IDs từ API để tìm kiếm nhanh
      const apiProductIds = new Set(apiProducts.map(p => p.Id));

      // Tìm products trong IndexedDB mà không có trong API
      const orphanedProducts = existingProducts.filter(existingProduct =>
        !apiProductIds.has(existingProduct.Id)
      );

      if (orphanedProducts.length === 0) {
        console.log('✅ Không có orphaned products cần xóa');
        return;
      }

      console.log(`🗑️ Tìm thấy ${orphanedProducts.length} orphaned products cần xóa:`);
      orphanedProducts.forEach(product => {
        console.log(`   - ${product.Id}: ${product.Name} (${product.Code})`);
      });

      // Xóa từng orphaned product khỏi IndexedDB
      const deletedIds: number[] = [];
      for (const orphanedProduct of orphanedProducts) {
        try {
          await this.indexedDBService.delete(
            this.dbName,
            this.dbVersion,
            this.storeName,
            orphanedProduct.Id
          );
          deletedIds.push(orphanedProduct.Id);
          console.log(`✅ Đã xóa orphaned product: ${orphanedProduct.Id} - ${orphanedProduct.Name}`);
        } catch (error) {
          console.error(`❌ Lỗi khi xóa orphaned product ${orphanedProduct.Id}:`, error);
        }
      }

      console.log(`✅ Cleanup hoàn thành: đã xóa ${deletedIds.length}/${orphanedProducts.length} orphaned products`);

      if (deletedIds.length > 0) {
        this.invalidateIndexedDbCache();
      }

      // // ✅ Đồng bộ việc xóa lên Firestore
      // if (deletedIds.length > 0) {
      //   console.log('🔄 Đồng bộ việc xóa orphaned products lên Firestore...');
      //   await this.syncDeletedProductsToFirestore(deletedIds);
      // }

    } catch (error) {
      console.error('❌ Lỗi khi cleanup orphaned products:', error);
      throw error;
    }
  }

  private normalizeProductApiPayload(payload: unknown): Product[] {
    const extracted = this.extractProductsFromPayload(payload);
    if (!Array.isArray(payload) && extracted.length === 0 && payload !== undefined && payload !== null) {
      console.warn('⚠️ API payload không chứa danh sách sản phẩm hợp lệ, trả về []');
    }
    return extracted;
  }

  private extractProductsFromPayload(payload: unknown, depth = 0, visited = new WeakSet<object>()): Product[] {
    if (!payload) {
      return [];
    }

    if (Array.isArray(payload)) {
      return payload as Product[];
    }

    if (typeof payload !== 'object' || depth > 5) {
      return [];
    }

    const objectPayload = payload as Record<string, unknown>;
    if (visited.has(objectPayload)) {
      return [];
    }
    visited.add(objectPayload);

    const candidateKeys = ['items', 'data', 'products', 'result', 'results', 'records', 'list', 'value'];
    for (const key of candidateKeys) {
      if (key in objectPayload) {
        const nested = this.extractProductsFromPayload(objectPayload[key], depth + 1, visited);
        if (nested.length > 0) {
          return nested;
        }
      }
    }

    for (const value of Object.values(objectPayload)) {
      if (typeof value === 'object' && value !== null) {
        const nested = this.extractProductsFromPayload(value, depth + 1, visited);
        if (nested.length > 0) {
          return nested;
        }
      }
    }

    return [];
  }

  // ✅ Method để đồng bộ việc xóa products lên Firestore
  // private async syncDeletedProductsToFirestore(deletedProductIds: number[]): Promise<void> {
  //   try {
  //     console.log(`🔄 Đồng bộ việc xóa ${deletedProductIds.length} products lên Firestore...`);

  //     // Gọi API để xóa products khỏi Firestore
  //     const response = await firstValueFrom(
  //       this.http.post(`${environment.domainUrl}${this.firebaseService.delete_products_batch_from_firebase}`, {
  //         productIds: deletedProductIds
  //       })
  //     );

  //     console.log(`✅ Đã đồng bộ việc xóa ${deletedProductIds.length} products lên Firestore:`, response);

  //   } catch (error) {
  //     console.error('❌ Lỗi khi đồng bộ việc xóa products lên Firestore:', error);
  //     // Không throw error để không ảnh hưởng đến quá trình chính
  //   }
  // }

  // Refactored: Accept apiProducts as optional parameter
  public async cleanupOrphanedProductsFromAPI(apiProducts?: Product[] | Record<string, unknown> | null): Promise<{ deletedCount: number; totalChecked: number }> {
    try {
      await this.ensureDBInitialized();

      let rawPayload: unknown = apiProducts;
      if (!rawPayload) {
        // Lấy products từ API nếu chưa truyền vào
        await this.ensureConnectionOpen();
        rawPayload = await firstValueFrom(
          this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
            catchError((err) => {
              console.error('❌ Lỗi khi tải products từ API:', err);
              return of([]);
            })
          )
        ) ?? [];
      }

      const productsFromAPI = this.normalizeProductApiPayload(rawPayload);

      if (productsFromAPI.length === 0) {
        console.log('ℹ️ Không có products nào từ API');
        return { deletedCount: 0, totalChecked: 0 };
      }

      // Lọc valid products
      const validApiProducts = productsFromAPI.filter((product: Product) => product && product.Id);
      console.log(`📦 Nhận được ${validApiProducts.length} valid products từ API`);

      // Lấy products từ IndexedDB
      const existingProducts = await this.getAllProductsFromIndexedDB();
      console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

      // Thực hiện cleanup
      await this.cleanupOrphanedProducts(existingProducts, validApiProducts);

      // Đếm số lượng đã xóa
      const apiProductIds = new Set(validApiProducts.map((p: Product) => p.Id));
      const orphanedProducts = existingProducts.filter(existingProduct =>
        !apiProductIds.has(existingProduct.Id)
      );

      return {
        deletedCount: orphanedProducts.length,
        totalChecked: existingProducts.length
      };

    } catch (error) {
      console.error('❌ Lỗi khi cleanup orphaned products từ API:', error);
      throw error;
    }
  }

  // ✅ Method để kiểm tra orphaned products mà không xóa
  public async checkOrphanedProducts(): Promise<{ orphanedCount: number; totalInIndexedDB: number; totalInAPI: number; orphanedProducts: Product[] }> {
    try {
      await this.ensureDBInitialized();

      console.log('🔍 Kiểm tra orphaned products...');

      // Lấy products từ API
      await this.ensureConnectionOpen();
      const apiPayload = await firstValueFrom(
        this.http.get<unknown>(`${environment.domainUrl}${this.kiotvietService.kiotviet_items_api}`).pipe(
          catchError((err) => {
            console.error('❌ Lỗi khi tải products từ API:', err);
            return of([]);
          })
        )
      ) ?? [];

      const apiProducts = this.normalizeProductApiPayload(apiPayload);

      // Lọc valid products
      const validApiProducts = apiProducts.filter((product: Product) => product && product.Id);
      console.log(`📦 Nhận được ${validApiProducts.length} valid products từ API`);

      // Lấy products từ IndexedDB
      const existingProducts = await this.getAllProductsFromIndexedDB();
      console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

      // Tìm orphaned products
      const apiProductIds = new Set(validApiProducts.map((p: Product) => p.Id));
      const orphanedProducts = existingProducts.filter(existingProduct =>
        !apiProductIds.has(existingProduct.Id)
      );

      console.log(`🔍 Tìm thấy ${orphanedProducts.length} orphaned products`);

      return {
        orphanedCount: orphanedProducts.length,
        totalInIndexedDB: existingProducts.length,
        totalInAPI: validApiProducts.length,
        orphanedProducts: orphanedProducts
      };

    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra orphaned products:', error);
      throw error;
    }
  }

  // Method mới để đồng bộ sản phẩm lên Firestore mà không thay đổi OnHand
  private async syncProductsToFirestoreWithoutOnHand(products: Product[]): Promise<void> {
    try {
      console.log(`🔄 Chuẩn bị đồng bộ ${products.length} sản phẩm lên Firestore...`);

      // Lấy OnHand hiện tại từ Firestore cho các sản phẩm cần cập nhật
      const firebaseProducts = await this.getProductsFromFirebaseWithCache();
      const firebaseMap = new Map(firebaseProducts.map(p => [p.Id, p]));

      // Chuẩn bị danh sách sản phẩm để gửi lên Firestore
      const productsForFirestore: Product[] = [];

      for (const product of products) {
        const firebaseProduct = firebaseMap.get(product.Id);

        // Tạo bản sao của product
        const productForFirestore = { ...product };

        if (firebaseProduct) {
          productForFirestore.OnHand = firebaseProduct.OnHand;
        }

        productsForFirestore.push(productForFirestore);
      }

      // Sử dụng debounce mechanism thay vì gọi trực tiếp
      await this.debouncedSaveToFirebase(productsForFirestore);

      console.log(`✅ Đã chuẩn bị đồng bộ ${productsForFirestore.length} sản phẩm lên Firestore (sẽ được gửi sau 1 giây)`);

    } catch (error) {
      console.error('❌ Lỗi khi chuẩn bị đồng bộ sản phẩm lên Firestore:', error);
      throw error;
    }
  }

  async syncProductsFromFirebaseToIndexedDB(firebaseProducts?: Product[]): Promise<void> {
    try {
      // Đảm bảo IndexedDB đã được khởi tạo
      await this.ensureDBInitialized();

      console.log('🔄 Bắt đầu đồng bộ products từ Firebase về IndexedDB...');

      // Lấy tất cả products từ Firebase (sử dụng cache nếu có, hoặc sử dụng products đã truyền vào)
      const allProducts = firebaseProducts && firebaseProducts.length > 0
        ? firebaseProducts
        : await this.getProductsFromFirebaseWithCache();
      console.log('🔎 [DEBUG] syncProductsFromFirebaseToIndexedDB: nhận được', (allProducts && allProducts.length) || 0, 'products từ Firebase');

      if (!allProducts || allProducts.length === 0) {
        console.log('ℹ️ Không có products nào từ Firebase');
        return;
      }

      console.log(`📦 Nhận được ${allProducts.length} products từ Firebase`);

      // Lọc và validate products
      const validProducts = allProducts.filter(product => {
        if (!product || !product.Id) {
          console.warn('⚠️ Product không hợp lệ:', product);
          return false;
        }
        return true;
      });

      if (validProducts.length === 0) {
        console.warn('⚠️ Không có products hợp lệ nào từ Firebase');
        return;
      }

      console.log(`✅ Có ${validProducts.length} products hợp lệ`);

      // Lấy products hiện tại từ IndexedDB
      const existingProducts: Product[] = await this.indexedDBService.getAll<Product>(
        this.dbName,
        this.dbVersion,
        this.storeName
      );

      console.log(`📋 Có ${existingProducts.length} products trong IndexedDB`);

      // Tạo map để so sánh nhanh
      const existingMap = new Map(existingProducts.map(p => [p.Id, p]));
      const productsToUpdate: Product[] = [];

      // Build OrderTemplate map từ original (non-clone) products để sync cho clone
      const originalOrderTemplateMap = new Map<string, string>();
      for (const product of validProducts) {
        if (!(product as any).isClone && product.OrderTemplate) {
          originalOrderTemplateMap.set(String(product.Id), product.OrderTemplate);
        }
      }

      // Sync OrderTemplate từ original sang clone products
      for (const product of validProducts) {
        if ((product as any).isClone && (product as any).CloneSourceId) {
          const originalOT = originalOrderTemplateMap.get(String((product as any).CloneSourceId));
          if (originalOT && originalOT !== product.OrderTemplate) {
            console.log(`🔄 Sync OrderTemplate cho clone ${product.Id} từ original ${(product as any).CloneSourceId}: "${product.OrderTemplate}" → "${originalOT}"`);
            product.OrderTemplate = originalOT;
          }
        }
      }

      // So sánh và tìm products cần cập nhật
      for (const product of validProducts) {
        const existing = existingMap.get(product.Id);

        if (existing) {
          // Tạo bản sao của product từ Firestore
          const productToUpdate = { ...product };

          // Kiểm tra xem có thay đổi gì không (trừ OnHand)
          const hasChanges = this.hasProductChanges(existing, product);
          if (hasChanges) {
            console.log(`🔄 Phát hiện thay đổi từ Firestore cho product ${product.Id} (${product.Name})`);
            this.logProductChanges(existing, product);
            this.logOnHandComparison(product.Id, existing.OnHand, productToUpdate.OnHand, 'Firestore->IndexedDB');
            productsToUpdate.push(productToUpdate);
          } else {
            console.log(`ℹ️ Product ${product.Id} (${product.Name}) không có thay đổi từ Firestore`);
            this.logOnHandComparison(product.Id, existing.OnHand, productToUpdate.OnHand, 'Firestore->IndexedDB (no changes)');
          }
        } else {
          // Product mới từ Firestore
          productsToUpdate.push(product);
        }
      }

      if (productsToUpdate.length > 0) {
        console.log(`🔄 Cập nhật ${productsToUpdate.length} products vào IndexedDB...`);

        // Cập nhật nhiều products cùng lúc
        await this.indexedDBService.putMany(
          this.dbName,
          this.dbVersion,
          this.storeName,
          productsToUpdate
        );

        console.log(`✅ Đã cập nhật thành công ${productsToUpdate.length} products từ Firebase vào IndexedDB`);
        this.invalidateIndexedDbCache();
      } else {
        console.log('ℹ️ Tất cả products đã được đồng bộ, không cần cập nhật');
      }

    } catch (error) {
      console.error('❌ Lỗi khi đồng bộ products từ Firebase:', error);
      throw error; // Re-throw để component có thể xử lý
    }
  }

  async syncAllProductsFromIndexedDBToFirebase(): Promise<void> {
    try {
      const allProducts = await this.getAllProductsFromIndexedDB();
      if (allProducts.length > 0) {
        console.log(`🔄 Chuẩn bị đồng bộ ${allProducts.length} sản phẩm từ IndexedDB lên Firebase...`);

        // Sử dụng debounce mechanism thay vì gọi trực tiếp
        await this.debouncedSaveToFirebase(allProducts);

        console.log(`✅ Đã chuẩn bị đồng bộ ${allProducts.length} sản phẩm từ IndexedDB lên Firebase (sẽ được gửi sau 1 giây)`);
      } else {
        console.log('Không có sản phẩm nào trong IndexedDB để đồng bộ.');
      }
    } catch (error) {
      console.error('❌ Lỗi khi chuẩn bị đồng bộ sản phẩm từ IndexedDB lên Firebase:', error);
    }
  }

  saveAllProductsToFirebase(products: Product[]): Observable<any> {
    return this.http.post(`${environment.domainUrl}${this.firebaseService.post_all_products_indexedDB_firebase}`, products);
  }

  /**
   * Call backend POST /api/sync/kiotviet/firebase/products which triggers sync and
   * optionally returns products. Now optimized to skip product data for faster response.
   *
   * @param includeProducts - If true, fetches products after sync. Default: false for speed.
   * @returns Object with sync result and products (if requested)
   */
  public async fetchAndSaveMergedProductsFromBackend(includeProducts = false): Promise<{
    success: boolean;
    products: Product[];
    stats?: any;
    error?: string;
  }> {
    // Prevent duplicate sync calls
    if (this.isSyncing && this.syncPromise) {
      console.log('⚠️ Sync đang chạy, chờ sync hiện tại hoàn thành...');
      return await this.syncPromise;
    }

    this.isSyncing = true;
    const timestamp = new Date().toISOString();
    console.log(`🔄 [${timestamp}] Bắt đầu sync (guard enabled)`);

    // Create sync promise
    this.syncPromise = (async () => {
      try {
        await this.ensureDBInitialized();
        const url = `${environment.domainUrl}${this.firebaseService.post_all_products_indexedDB_firebase}`;
        console.log(`🔄 [${timestamp}] Gọi POST sync endpoint (optimized):`, url);
        console.trace('Stack trace for sync API call');

        const res = await firstValueFrom(
          this.http.post<any>(url, { skip_products: !includeProducts }).pipe(
            catchError(err => {
              console.error('❌ Lỗi khi gọi POST sync endpoint:', err);
              const errorMessage = err?.error?.error || err?.message || 'Lỗi kết nối đến server';
              throw new Error(errorMessage);
            })
          )
        );

        console.log('📦 Backend response:', res);

        // Check if sync succeeded
        // Support both old and new response formats
        const syncResult = res?.sync || res || {};
        console.log('📊 Sync result:', syncResult);
        console.log('🏷️ Backend version:', syncResult.version || 'unknown (old code)');

        // Check for success (new format: success field, old format: check message)
        const isSuccess = syncResult.success === true ||
          (syncResult.message && syncResult.message.includes('đồng bộ') && !syncResult.error);

        if (!isSuccess) {
          const errorMsg = syncResult.error || syncResult.message || 'Đồng bộ thất bại';
          console.error('❌ Sync failed:', errorMsg);
          throw new Error(errorMsg);
        }

        console.log('✅ Sync succeeded:', syncResult.stats || 'No stats available (old format)');

        // If products were not included in response, fetch them separately
        let products: Product[] = [];
        if (includeProducts) {
          products = this.normalizeProductApiPayload(res);

          if (products && products.length > 0) {
            console.log(`📦 Lưu ${products.length} products vào IndexedDB (preserve OnHandNV)...`);
            // CRITICAL: Sử dụng reseedIndexedDbWithApiProducts để preserve OnHandNV
            await this.reseedIndexedDbWithApiProducts(products);
          }
        } else {
          console.log('ℹ️ Products not included in sync response (skip_products=true). Fetch separately if needed.');
        }

        return {
          success: true,
          products,
          stats: syncResult.stats
        };

      } catch (err: any) {
        console.error('❌ Lỗi trong fetchAndSaveMergedProductsFromBackend:', err);
        return {
          success: false,
          products: [],
          error: err?.message || 'Lỗi không xác định'
        };
      } finally {
        this.isSyncing = false;
        this.syncPromise = null;
      }
    })();

    return await this.syncPromise;
  }

  getAllProductsFromFirebase(): Observable<Product[]> {
    // Sử dụng cache nếu có và còn hợp lệ
    const now = Date.now();
    if (this.firebaseProductsCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      console.log('📦 Sử dụng cache cho getAllProductsFromFirebase');
      this.cacheHitCount++;
      this.logCacheUsage('getAllProductsFromFirebase', true, this.firebaseProductsCache.length);
      return of(this.firebaseProductsCache);
    }

    // Cache hết hạn hoặc chưa có, gọi API mới
    console.log('🔄 Gọi API Firebase để lấy products mới (getAllProductsFromFirebase)');
    this.apiCallCount++;
    return this.getAllProductsFromFirebaseAPI().pipe(
      map(products => {
        this.firebaseProductsCache = products || [];
        this.cacheTimestamp = now;
        console.log(`📦 Đã cache ${this.firebaseProductsCache.length} products từ Firebase (getAllProductsFromFirebase)`);
        this.logCacheUsage('getAllProductsFromFirebase', false, this.firebaseProductsCache.length);
        return this.firebaseProductsCache;
      }),
      catchError((error) => {
        console.error('❌ Lỗi khi lấy products từ Firebase (getAllProductsFromFirebase):', error);
        // Trả về cache cũ nếu có, hoặc array rỗng
        const fallbackProducts = this.firebaseProductsCache || [];
        this.logCacheUsage('getAllProductsFromFirebase_fallback', true, fallbackProducts.length);
        return of(fallbackProducts);
      })
    );
  }

  // Method private để gọi API thực tế
  private getAllProductsFromFirebaseAPI(): Observable<Product[]> {
    return this.http.get<Product[]>(`${environment.domainUrl}${this.firebaseService.get_all_products_from_firebase}`).pipe(
      catchError((err) => {
        console.error('❌ Lỗi khi tải tất cả sản phẩm từ Firebase API:', err);
        return of([]);
      })
    );
  }

  private invalidateIndexedDbCache(): void {
    this.indexedDbProductsCache = null;
    this.indexedDbCacheTimestamp = 0;
    this.productSearchIndex.clear();
  }

  private rebuildProductSearchIndex(products: Product[]): void {
    this.productSearchIndex.clear();
    for (const product of products) {
      this.ensureUnitOnProduct(product);
      const id = product?.Id;
      if (typeof id !== 'number') {
        continue;
      }
      this.productSearchIndex.set(id, this.buildSearchIndexEntry(product));
    }
  }

  private buildSearchIndexEntry(product: Product): { normalizedName: string; rawLowerName: string; codeLower: string } {
    this.ensureUnitOnProduct(product);
    const rawName = (product?.Name || '').trim();
    const normalizedFromData = (product as any)?.NormalizedName;
    const normalizedName = typeof normalizedFromData === 'string' && normalizedFromData.length > 0
      ? normalizedFromData.toLowerCase()
      : this.vi.normalizeAndTokenize(rawName).join(' ').toLowerCase();

    const normalizedCodeFromData = (product as any)?.NormalizedCode;
    const codeSource = typeof normalizedCodeFromData === 'string' && normalizedCodeFromData.length > 0
      ? normalizedCodeFromData
      : product?.Code || '';

    return {
      normalizedName: normalizedName.trim(),
      rawLowerName: rawName.toLowerCase(),
      codeLower: codeSource.toLowerCase().trim()
    };
  }

  private getOrCreateSearchIndexEntry(product: Product): { normalizedName: string; rawLowerName: string; codeLower: string } {
    const id = product?.Id;
    if (typeof id !== 'number') {
      return this.buildSearchIndexEntry(product);
    }

    let entry = this.productSearchIndex.get(id);
    if (!entry) {
      entry = this.buildSearchIndexEntry(product);
      this.productSearchIndex.set(id, entry);
    }
    return entry;
  }

  /**
   * Levenshtein edit distance with early termination.
   * Returns maxDist+1 if distance exceeds maxDist (for performance).
   */
  private editDistance(a: string, b: string, maxDist: number): number {
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    if (la === 0) return lb;
    if (lb === 0) return la;

    // Single-row DP with early termination
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);
    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      let rowMin = curr[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
        if (curr[j] < rowMin) rowMin = curr[j];
      }
      if (rowMin > maxDist) return maxDist + 1;
      [prev, curr] = [curr, prev];
    }
    return prev[lb];
  }

  private async getIndexedDbProductsWithCache(): Promise<Product[]> {
    await this.ensureDBInitialized();

    const now = Date.now();
    if (this.indexedDbProductsCache && (now - this.indexedDbCacheTimestamp) < this.INDEXED_DB_CACHE_DURATION) {
      return this.indexedDbProductsCache;
    }

    const products = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    for (const product of products) {
      this.ensureUnitOnProduct(product);
    }

    this.indexedDbProductsCache = products;
    this.indexedDbCacheTimestamp = now;
    this.rebuildProductSearchIndex(products);

    return products;
  }

  async loadProductsIfNotExist(searchTerm: string): Promise<Product[] | null> {
    const existingProducts = await this.getIndexedDbProductsWithCache();

    const existing = existingProducts.find(
      p => p.Code?.trim().toLowerCase() === searchTerm.toLowerCase() ||
        p.Name?.trim().toLowerCase() === searchTerm.toLowerCase()
    );

    // Nếu đã tồn tại thì return null
    if (existing) {
      return null;
    }

    // Logic để load từ API nếu cần (có thể bổ sung thêm)
    // Hiện tại chỉ return null nếu không tìm thấy
    return null;
  }

  async searchProducts(query: string): Promise<Product[]> {
    const trimmedQuery = (query || '').trim();
    if (!trimmedQuery) {
      return [];
    }

    const allProducts = await this.getIndexedDbProductsWithCache();
    if (!allProducts || allProducts.length === 0) {
      return [];
    }

    if (this.productSearchIndex.size === 0) {
      this.rebuildProductSearchIndex(allProducts);
    }

    const queryTokens = this.vi.normalizeAndTokenize(trimmedQuery);
    const normalizedQuery = queryTokens.join(' ').toLowerCase();
    const rawQuery = trimmedQuery.toLowerCase();
    const baseCodeQuery = rawQuery.includes('-') ? rawQuery.split('-')[0] : rawQuery;

    const queryTokensLower = queryTokens.map(t => t.toLowerCase());

    const exactCodeMatches: Product[] = [];
    const startsWithMatches: Product[] = [];
    const containsNameMatches: Product[] = [];
    const codeMatches: Product[] = [];
    const tokenMatches: { product: Product; score: number }[] = [];
    const fuzzyMatches: { product: Product; score: number }[] = [];

    for (const product of allProducts) {
      if (!product || typeof product.Id !== 'number') {
        continue;
      }

      const entry = this.getOrCreateSearchIndexEntry(product);
      const normalizedName = entry.normalizedName;
      const rawLowerName = entry.rawLowerName;
      const codeLower = entry.codeLower;

      const isExactCodeMatch = codeLower === rawQuery || (rawQuery.includes('-') && codeLower === baseCodeQuery);
      if (isExactCodeMatch) {
        exactCodeMatches.push(product);
        continue;
      }

      const startsWith = (normalizedQuery && normalizedName.startsWith(normalizedQuery)) || rawLowerName.startsWith(rawQuery);
      if (startsWith) {
        startsWithMatches.push(product);
        continue;
      }

      const nameContains = (normalizedQuery && normalizedName.includes(normalizedQuery)) || rawLowerName.includes(rawQuery);
      if (nameContains) {
        containsNameMatches.push(product);
        continue;
      }

      if (!rawQuery) {
        continue;
      }

      if (rawQuery.includes('-')) {
        if (codeLower === baseCodeQuery) {
          codeMatches.push(product);
        }
        continue;
      }

      if (codeLower.includes(rawQuery)) {
        codeMatches.push(product);
        continue;
      }

      // Tier 5: Token match - all query tokens found as substrings in name
      if (queryTokensLower.length >= 2) {
        const allFound = queryTokensLower.every(qt =>
          normalizedName.includes(qt) || rawLowerName.includes(qt)
        );
        if (allFound) {
          tokenMatches.push({ product, score: queryTokensLower.length });
          continue;
        }
      }

      // Tier 6: Fuzzy match - tokens match with small typo tolerance
      if (queryTokensLower.length >= 1) {
        const nameTokens = normalizedName.split(' ');
        let matched = 0;
        let totalDist = 0;
        for (const qt of queryTokensLower) {
          let bestDist = Infinity;
          // First check substring match (no edit distance needed)
          if (normalizedName.includes(qt) || rawLowerName.includes(qt)) {
            bestDist = 0;
          } else {
            const maxDist = qt.length <= 2 ? 0 : qt.length <= 5 ? 1 : 2;
            for (const nt of nameTokens) {
              if (Math.abs(nt.length - qt.length) > maxDist) continue;
              const dist = this.editDistance(qt, nt, maxDist);
              if (dist < bestDist) bestDist = dist;
              if (bestDist === 0) break;
            }
          }
          const threshold = qt.length <= 2 ? 0 : qt.length <= 5 ? 1 : 2;
          if (bestDist <= threshold) {
            matched++;
            totalDist += bestDist;
          }
        }
        const matchRatio = matched / queryTokensLower.length;
        if (matchRatio >= 0.6 && matched >= 2) {
          fuzzyMatches.push({ product, score: matchRatio * 100 - totalDist });
        }
      }
    }

    // Sort fuzzy tiers by score descending (best matches first)
    tokenMatches.sort((a, b) => b.score - a.score);
    fuzzyMatches.sort((a, b) => b.score - a.score);

    const seen = new Set<number>();
    const results: Product[] = [];
    const pushList = (list: Product[]) => {
      for (const product of list) {
        if (!product || typeof product.Id !== 'number') {
          continue;
        }
        if (!product.Code || !product.Name) {
          continue;
        }
        this.ensureUnitOnProduct(product);
        if (seen.has(product.Id)) {
          continue;
        }
        seen.add(product.Id);
        results.push(product);
        if (results.length >= this.SEARCH_RESULT_LIMIT) {
          return;
        }
      }
    };

    const pushScoredList = (list: { product: Product; score: number }[]) => {
      pushList(list.map(item => item.product));
    };

    pushList(exactCodeMatches);
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushList(startsWithMatches);
    }
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushList(containsNameMatches);
    }
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushList(codeMatches);
    }
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushScoredList(tokenMatches);
    }
    if (results.length < this.SEARCH_RESULT_LIMIT) {
      pushScoredList(fuzzyMatches);
    }

    return results;
  }
  updateProductsOnHandFromInvoice(invoice: InvoiceTab): Observable<any> {
    return this.http.put(`${environment.domainUrl}/api/firebase/products/update_onhand_from_invoice`, invoice);
  }
  // Thêm các method tiện ích khác
  async getProductByIdFromIndexedDB(id: number): Promise<Product | undefined> {
    await this.ensureDBInitialized();
    return await this.getProductByIdFromIndexedDBFlexible(id);
  }

  async addProductFromIndexedDB(product: Product): Promise<void> {
    await this.ensureDBInitialized();
    const sanitizedProduct = this.sanitizeProductForStorage(product);
    await this.indexedDBService.put<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName,
      sanitizedProduct
    );
    this.invalidateIndexedDbCache();
  }

  async updateProductFromIndexedDB(product: Product): Promise<void> {
    await this.ensureDBInitialized();
    const sanitizedProduct = this.sanitizeProductForStorage(product);
    await this.indexedDBService.put<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName,
      sanitizedProduct
    );
    this.invalidateIndexedDbCache();
  }

  async deleteProductFromIndexedDB(id: number): Promise<void> {
    await this.ensureDBInitialized();
    await this.indexedDBService.delete(
      this.dbName,
      this.dbVersion,
      this.storeName,
      id
    );
    this.invalidateIndexedDbCache();
  }


  async clearAllProductsFromIndexedDB(): Promise<void> {
    await this.ensureDBInitialized();
    await this.indexedDBService.clear(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
    this.invalidateIndexedDbCache();
  }

  async getAllProductsFromIndexedDB(): Promise<Product[]> {
    await this.ensureDBInitialized();
    return await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
  }

  private async getProductByIdFromIndexedDBFlexible(id: number | string): Promise<Product | undefined> {
    const candidates: Array<number | string> = [];
    const trimmedStringId = typeof id === 'string' ? id.trim() : '';
    const numericId = Number(trimmedStringId || id);

    candidates.push(id);

    if (trimmedStringId && trimmedStringId !== id) {
      candidates.push(trimmedStringId);
    }

    if (Number.isFinite(numericId)) {
      candidates.push(numericId);
      candidates.push(String(numericId));
    }

    const tried = new Set<string>();
    for (const candidate of candidates) {
      const candidateKey = `${typeof candidate}:${String(candidate)}`;
      if (tried.has(candidateKey)) {
        continue;
      }
      tried.add(candidateKey);

      const product = await this.indexedDBService.getByKey<Product>(
        this.dbName,
        this.dbVersion,
        this.storeName,
        candidate as IDBValidKey
      );

      if (product) {
        if (String(candidate) !== String(id)) {
          console.warn(`⚠️ [ProductService] IndexedDB Id lookup fallback matched ${typeof candidate}:${candidate} for requested Id=${id}`);
        }
        return product;
      }
    }

    const allProducts = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );
    const fallbackProduct = allProducts.find((product: any) => Number(product?.Id) === numericId);

    if (fallbackProduct) {
      console.warn(`⚠️ [ProductService] IndexedDB full-scan fallback matched product Id=${fallbackProduct.Id} for requested Id=${id}`);
    }

    return fallbackProduct;
  }

  async updateProductsOnHandFromInvoiceToFireBase(
    invoice: InvoiceTab,
    groupedProducts: { [x: string]: unknown;[x: number]: unknown[]; },
    _manuallyEditedIds: Set<number>,
    operation: 'decrease' | 'increase' = 'decrease',
    currentOnHandOverride?: Map<number, number>,
    historyTag?: HistoryTag
  ): Promise<any> {
    // ✅ Lấy OnHand/OnHandNV hiện tại từ IndexedDB

    const currentOnHandMap: Record<number, number> = {};
    const currentOnHandNVMap: Record<number, number> = {};
    const isNVProductMap: Record<number, boolean> = {};

    if (currentOnHandOverride && currentOnHandOverride.size > 0) {
      for (const [key, value] of currentOnHandOverride.entries()) {
        const numericId = Number(key);
        if (!Number.isFinite(numericId)) {
          continue;
        }
        currentOnHandMap[numericId] = Number(value ?? 0);
      }
    }

    // Xác định cartItem nào là NV product
    // ✅ QUAN TRỌNG: Bao gồm:
    //    1. Product có isClone = true (LUÔN là NV product, dù OnHandNV = 0)
    //    2. Product có OnHandNV > 0 (Type 2 hoặc Type 3)
    //    3. ✅ FIX: Nếu 1 variant là NV, TẤT CẢ siblings trong group cũng phải là NV
    //    4. ✅ FIX: Lookup isClone từ IndexedDB vì invoice đã lưu có thể không có isClone
    //    5. ✅ FIX 2: Thêm fallback check OnHandNV > 0 && OnHand === 0 (đặc điểm Clone product)
    //    6. ✅ FIX 3: Product có KiotVietSync = false là local product, LUÔN dùng OnHandNV
    const nvProductIds = new Set<number>();
    for (const cartItem of invoice.cartItems) {
      // ✅ FIX: Ưu tiên lookup isClone từ IndexedDB, fallback về cartItem.product
      const productFromDB = await this.getProductByIdFromIndexedDB(cartItem.product?.Id);
      const isCloneFromDB = (productFromDB as any)?.isClone === true;
      const isCloneFromCart = (cartItem.product as any)?.isClone === true;

      // ✅ FIX 3: Check KiotVietSync = false (local product created from dialog)
      const isLocalProductFromDB = (productFromDB as any)?.KiotVietSync === false;
      const isLocalProductFromCart = (cartItem.product as any)?.KiotVietSync === false;
      const isLocalProduct = isLocalProductFromDB || isLocalProductFromCart;

      // ✅ FIX: Cũng lookup OnHandNV và OnHand từ IndexedDB
      const onHandNVFromDB = productFromDB?.OnHandNV ?? 0;
      const onHandFromDB = productFromDB?.OnHand ?? 0;
      const onHandNVFromCart = cartItem.product?.OnHandNV ?? 0;
      const onHandFromCart = cartItem.product?.OnHand ?? 0;

      // ✅ FIX 2: Fallback - Clone product có đặc điểm: OnHandNV > 0 và OnHand === 0
      const isCloneByOnHandNV = (onHandNVFromDB > 0 && onHandFromDB === 0) ||
                                 (onHandNVFromCart > 0 && onHandFromCart === 0);

      // ✅ FIX 3: isLocalProduct is now part of the isClone check
      const isClone = isCloneFromDB || isCloneFromCart || isCloneByOnHandNV || isLocalProduct;
      const onHandNV = onHandNVFromDB > 0 ? onHandNVFromDB : onHandNVFromCart;

      // Clone product LUÔN được xử lý như NV product
      if (isClone || onHandNV > 0) {
        nvProductIds.add(cartItem.product.Id);

        // ✅ FIX: Thêm TẤT CẢ siblings trong group vào nvProductIds
        // Vì nếu 1 variant có OnHandNV > 0, tất cả variants khác cũng phải được sync OnHandNV
        const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
        const group = groupedProducts[masterUnitId] as unknown as Product[];
        if (group) {
          group.forEach(sibling => {
            nvProductIds.add(sibling.Id);
          });
        }
      }
    }

    // Lấy tất cả product IDs cần cập nhật
    const productIds = new Set<number>();
    for (const cartItem of invoice.cartItems) {
      const isNV = nvProductIds.has(cartItem.product.Id);
      const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
      const group = groupedProducts[masterUnitId] as unknown as Product[];

      if (group) {
        group.forEach(product => {
          productIds.add(product.Id);
          isNVProductMap[product.Id] = isNV;
        });
      } else {
        // Fallback nếu không có group
        productIds.add(cartItem.product.Id);
        isNVProductMap[cartItem.product.Id] = isNV;
      }
    }

    // Lấy OnHand và OnHandNV hiện tại từ IndexedDB
    // ✅ FIX: Với NV products, nếu sibling có OnHandNV = 0 nhưng có variant khác có OnHandNV > 0,
    //    tính OnHandNV của sibling dựa trên ConversionValue từ variant có OnHandNV
    for (const productId of productIds) {
      const product = await this.getProductByIdFromIndexedDB(productId);
      if (product) {
        if (currentOnHandMap[productId] === undefined) {
          currentOnHandMap[productId] = Number(product.OnHand ?? 0);
        }
        currentOnHandNVMap[productId] = Number(product.OnHandNV ?? 0);
      }
    }

    // ✅ FIX: Tính OnHandNV cho siblings nếu họ có OnHandNV = 0 nhưng group có variant có OnHandNV > 0
    for (const cartItem of invoice.cartItems) {
      const isNV = nvProductIds.has(cartItem.product.Id);
      if (!isNV) continue;

      const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
      const group = groupedProducts[masterUnitId] as unknown as Product[];
      if (!group || group.length <= 1) continue;

      // Tìm variant có OnHandNV > 0 (làm reference)
      let referenceProduct: Product | null = null;
      let referenceOnHandNV = 0;
      for (const p of group) {
        const onHandNV = currentOnHandNVMap[p.Id] ?? 0;
        if (onHandNV > 0) {
          referenceProduct = p;
          referenceOnHandNV = onHandNV;
          break;
        }
      }

      if (!referenceProduct || referenceOnHandNV <= 0) continue;

      // Tính OnHandNV cho các siblings có OnHandNV = 0 dựa trên reference
      const refConversion = Number((referenceProduct as any).ConversionValue) || 1;
      const masterQtyNV = referenceOnHandNV * refConversion; // Quy về đơn vị gốc

      for (const sibling of group) {
        if (currentOnHandNVMap[sibling.Id] === 0) {
          const siblingConversion = Number((sibling as any).ConversionValue) || 1;
          const calculatedOnHandNV = siblingConversion === 0 ? 0 : masterQtyNV / siblingConversion;
          currentOnHandNVMap[sibling.Id] = calculatedOnHandNV;
          console.log(`📐 [OnHandNV Sync] Calculated ${sibling.Unit} (Id: ${sibling.Id}): ${calculatedOnHandNV} from ${referenceProduct.Unit} (${referenceOnHandNV} x ${refConversion} / ${siblingConversion})`);
        }
      }
    }

    // Tạo map để gom các cập nhật cho từng productId
    const kvUpdates: Record<number, number> = {}; // Updates cho OnHand (KV products)
    const nvUpdates: Record<number, number> = {}; // Updates cho OnHandNV (NV products)

    for (const cartItem of invoice.cartItems) {
      const isNVProduct = nvProductIds.has(cartItem.product.Id);

      if (isNVProduct) {
        // NV product - trừ OnHandNV của cả group
        const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
        const group = groupedProducts[masterUnitId] as unknown as Product[];
        if (!group) {
          // Fallback cho trường hợp không tìm thấy group: chỉ trừ product đang chọn
          const qty = Number(cartItem.quantity ?? 0);
          const delta = operation === 'decrease' ? -qty : qty;
          nvUpdates[cartItem.product.Id] = (nvUpdates[cartItem.product.Id] || 0) + delta;
          continue;
        }

        const soldInGroupNV = group.find((p: any) => Number(p.Id) === Number(cartItem.product?.Id));
        const soldCVNV = Number((soldInGroupNV as any)?.ConversionValue ?? cartItem.product?.ConversionValue) || 1;
        const masterQty = Number(cartItem.quantity ?? 0) * soldCVNV;

        for (const product of group) {
          const conversion = Number((product as any)?.ConversionValue) || 1;
          const adjustment = conversion === 0 ? 0 : masterQty / conversion;
          const delta = operation === 'decrease' ? -adjustment : adjustment;
          nvUpdates[product.Id] = (nvUpdates[product.Id] || 0) + delta;
        }
      } else {
        // KV product - trừ OnHand của cả group như cũ
        const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
        const group = groupedProducts[masterUnitId] as unknown as Product[];
        if (!group) continue;

        const soldInGroup = group.find((p: any) => Number(p.Id) === Number(cartItem.product?.Id));
        const soldCV = Number((soldInGroup as any)?.ConversionValue ?? cartItem.product?.ConversionValue) || 1;
        const masterQty = Number(cartItem.quantity ?? 0) * soldCV;

        for (const product of group) {
          const conversion = Number((product as any)?.ConversionValue) || 1;
          const adjustment = conversion === 0 ? 0 : masterQty / conversion;
          const delta = operation === 'decrease' ? -adjustment : adjustment;
          kvUpdates[product.Id] = (kvUpdates[product.Id] || 0) + delta;
        }
      }
    }

    // ✅ Chuẩn bị payload - phân biệt KV và NV products
    const updatePayload: any[] = [];

    // KV products - cập nhật OnHand
    for (const [productId, delta] of Object.entries(kvUpdates)) {
      const numericId = Number(productId);
      const current = Number(currentOnHandMap[numericId] ?? 0);
      const numericDelta = Number(delta) || 0;
      const rawNewOnHand = current + numericDelta;
      // ✅ FIX: Đảm bảo OnHand không âm
      const newOnHand = Math.max(0, rawNewOnHand);
      const minus = numericDelta < 0 ? Math.abs(numericDelta) : 0;
      const plus = numericDelta > 0 ? numericDelta : 0;

      // ⚠️ Log warning nếu OnHand sẽ âm (đã bị clamp về 0)
      if (rawNewOnHand < 0) {
        console.warn(`⚠️ [OnHand] Product ${numericId}: current=${current}, delta=${numericDelta}, would be ${rawNewOnHand}, clamped to 0`);
      }

      updatePayload.push({
        productId: numericId,
        currentOnHand: current,
        delta: numericDelta,
        minus,
        plus,
        newOnHand,
        updateType: 'OnHand' // KV product
      });
    }

    // NV products - cập nhật OnHandNV
    for (const [productId, delta] of Object.entries(nvUpdates)) {
      const numericId = Number(productId);
      const currentNV = Number(currentOnHandNVMap[numericId] ?? 0);
      const numericDelta = Number(delta) || 0;
      const rawNewOnHandNV = currentNV + numericDelta;
      // ✅ FIX: Đảm bảo OnHandNV không âm
      const newOnHandNV = Math.max(0, rawNewOnHandNV);
      const minus = numericDelta < 0 ? Math.abs(numericDelta) : 0;
      const plus = numericDelta > 0 ? numericDelta : 0;

      // ⚠️ Log warning nếu OnHandNV sẽ âm (đã bị clamp về 0)
      if (rawNewOnHandNV < 0) {
        console.warn(`⚠️ [OnHandNV] Product ${numericId}: current=${currentNV}, delta=${numericDelta}, would be ${rawNewOnHandNV}, clamped to 0`);
      }

      updatePayload.push({
        productId: numericId,
        currentOnHand: currentNV, // API sẽ hiểu đây là OnHandNV
        delta: numericDelta,
        minus,
        plus,
        newOnHand: newOnHandNV,
        OnHandNV: newOnHandNV, // ✅ FIX: Gửi OnHandNV để backend nhận đúng target_value
        updateType: 'OnHandNV' // NV product
      });
    }

    console.log('🔄 Cập nhật OnHand/OnHandNV cho Firestore:', updatePayload);

    // Tạo map từ payload để biết updateType cho từng productId
    const updateTypeMap = new Map<number, string>();
    const newValueMap = new Map<number, number>();
    for (const item of updatePayload) {
      updateTypeMap.set(item.productId, item.updateType);
      newValueMap.set(item.productId, item.newOnHand);
    }

    try {
      const response = await this.http.put(`${environment.domainUrl}/api/firebase/products/update_onhand_batch`, updatePayload).toPromise() as any;

      console.log('📥 Response từ update_onhand_batch:', response);

      // ✅ Cập nhật IndexedDB - ưu tiên từ response, fallback về payload
      if (response && response.updated_products && Array.isArray(response.updated_products) && response.updated_products.length > 0) {
        console.log('✅ Cập nhật IndexedDB từ response:', response.updated_products);

        for (const updatedItem of response.updated_products) {
          try {
            const productId = Number(updatedItem.Id || updatedItem.productId);
            // ✅ Ưu tiên lấy updateType từ response, fallback về payload map
            const updateType = updatedItem.updateType || updateTypeMap.get(productId) || 'OnHand';

            console.log(`🔄 [IndexedDB] Updating product ${productId}, updateType: ${updateType}, new value: ${updatedItem.new_OnHand}`);

            if (updateType === 'OnHandNV') {
              await this.updateProductOnHandNVLocal(productId, updatedItem.new_OnHand);
            } else {
              await this.updateProductOnHandLocal(productId, updatedItem.new_OnHand);
            }
          } catch (error) {
            console.error(`❌ Lỗi cập nhật IndexedDB cho product ${updatedItem.Id}:`, error);
          }
        }
      } else {
        // ⚠️ FALLBACK: Response không có updated_products, cập nhật từ payload
        console.warn('⚠️ Response không có updated_products, sử dụng fallback từ payload');

        for (const item of updatePayload) {
          try {
            console.log(`🔄 [IndexedDB FALLBACK] Updating product ${item.productId}, updateType: ${item.updateType}, new value: ${item.newOnHand}`);

            if (item.updateType === 'OnHandNV') {
              await this.updateProductOnHandNVLocal(item.productId, item.newOnHand);
            } else {
              await this.updateProductOnHandLocal(item.productId, item.newOnHand);
            }
          } catch (error) {
            console.error(`❌ Lỗi cập nhật IndexedDB (fallback) cho product ${item.productId}:`, error);
          }
        }
      }

      // ✅ Ghi lịch sử thay đổi tồn kho cho clone products (OnHandNV)
      // Luôn quy về đơn vị master (đơn vị nhỏ nhất) và chỉ ghi 1 record cho master
      try {
        const nvPayloadItems = updatePayload.filter(item => item.updateType === 'OnHandNV');
        if (nvPayloadItems.length > 0) {
          // Collect master IDs from cart items (NV products only)
          const masterIdsToRecord = new Set<number>();
          for (const cartItem of invoice.cartItems) {
            if (!cartItem.product?.Id) continue;
            if (!nvProductIds.has(cartItem.product.Id)) continue;
            const masterId = cartItem.product.MasterUnitId || cartItem.product.Id;
            masterIdsToRecord.add(masterId);
          }

          // Build payload map for quick lookup
          const nvPayloadMap = new Map<number, { currentOnHand: number; newOnHand: number }>();
          for (const item of nvPayloadItems) {
            nvPayloadMap.set(item.productId, {
              currentOnHand: Number(item.currentOnHand ?? 0),
              newOnHand: Number(item.newOnHand ?? 0)
            });
          }

          // Record history only for master products
          for (const masterId of masterIdsToRecord) {
            const masterPayload = nvPayloadMap.get(masterId);
            if (!masterPayload) continue;
            const oldValue = masterPayload.currentOnHand;
            const newValue = masterPayload.newOnHand;
            if (oldValue === newValue) continue;

            // Get master product info
            const masterProduct = await this.getProductByIdFromIndexedDB(masterId);
            this.productHistoryService.recordChange(
              masterId,
              masterProduct?.Code || '',
              masterProduct?.Name || '',
              'OnHandNV',
              oldValue,
              newValue,
              undefined,
              historyTag
            );
          }
        }
      } catch (historyErr) {
        console.warn('⚠️ Lỗi ghi lịch sử tồn kho (không ảnh hưởng checkout):', historyErr);
      }

      return response;
    } catch (error) {
      console.error('❌ Lỗi khi gọi API update_onhand_batch:', error);

      // ⚠️ Nếu API lỗi, vẫn cập nhật IndexedDB local để UI đồng bộ
      console.warn('⚠️ API lỗi, cập nhật IndexedDB local từ payload...');
      for (const item of updatePayload) {
        try {
          if (item.updateType === 'OnHandNV') {
            await this.updateProductOnHandNVLocal(item.productId, item.newOnHand);
          } else {
            await this.updateProductOnHandLocal(item.productId, item.newOnHand);
          }
        } catch (localError) {
          console.error(`❌ Lỗi cập nhật IndexedDB local cho product ${item.productId}:`, localError);
        }
      }

      throw error;
    }
  }

  async updateProductOnHandLocal(productId: number, onHand: number): Promise<void> {
    await this.ensureDBInitialized();
    const product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
    if (product) {
      // normalize to the Product model field
      (product as any).OnHand = onHand;
      await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product);
      console.log(`✅ [IndexedDB] Updated product ${productId} OnHand: ${onHand}`);
      if (this.indexedDbProductsCache) {
        const cached = this.indexedDbProductsCache.find(p => p.Id === productId);
        if (cached) {
          cached.OnHand = onHand;
        }
      }
    } else {
      console.warn(`⚠️ [IndexedDB] Product ${productId} not found in IndexedDB, cannot update OnHand to ${onHand}`);
    }
  }

  async updateProductOnHandNVLocal(productId: number, onHandNV: number): Promise<void> {
    await this.ensureDBInitialized();
    const product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
    if (product) {
      (product as any).OnHandNV = onHandNV;
      await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product);
      console.log(`✅ [IndexedDB] Updated product ${productId} OnHandNV: ${onHandNV}`);
      if (this.indexedDbProductsCache) {
        const cached = this.indexedDbProductsCache.find(p => p.Id === productId);
        if (cached) {
          cached.OnHandNV = onHandNV;
        }
      }
    } else {
      console.warn(`⚠️ [IndexedDB] Product ${productId} not found in IndexedDB, cannot update OnHandNV to ${onHandNV}`);
    }
  }

  // Method để cập nhật OnHand cho nhiều sản phẩm cùng lúc
  async updateProductsOnHandLocal(products: Product[]): Promise<void> {
    await this.ensureDBInitialized();

    if (!products || products.length === 0) {
      console.warn('⚠️ Không có sản phẩm nào để cập nhật OnHand');
      return;
    }

    console.log(`🔄 Cập nhật OnHand cho ${products.length} sản phẩm...`);

    // Cập nhật tất cả sản phẩm cùng lúc
    await this.indexedDBService.putMany(
      this.dbName,
      this.dbVersion,
      this.storeName,
      products
    );

    console.log(`✅ Đã cập nhật OnHand cho ${products.length} sản phẩm`);

    if (this.indexedDbProductsCache && products.length > 0) {
      const onHandMap = new Map<number, number>();
      for (const p of products) {
        if (p && typeof p.Id === 'number') {
          onHandMap.set(p.Id, p.OnHand);
        }
      }

      for (const cached of this.indexedDbProductsCache) {
        const updatedOnHand = onHandMap.get(cached.Id);
        if (typeof updatedOnHand === 'number') {
          cached.OnHand = updatedOnHand;
        }
      }
    }

  }

  // Method để kiểm tra trạng thái đồng bộ với cache (không gọi API nếu cache còn hợp lệ)
  async getSyncStatusWithCache(): Promise<{ totalInFirebase: number; totalInIndexedDB: number; needsSync: boolean; usedCache: boolean }> {
    try {
      await this.ensureDBInitialized();

      const cacheInfo = this.getDetailedCacheInfo();
      let firebaseProducts: Product[] = [];
      let usedCache = false;

      if (cacheInfo.hasCache && !cacheInfo.isExpired) {
        // Sử dụng cache nếu còn hợp lệ
        firebaseProducts = this.firebaseProductsCache || [];
        usedCache = true;
        console.log(`📦 Sử dụng cache cho sync status: ${firebaseProducts.length} products`);
      } else {
        // Chỉ gọi API nếu cache không có hoặc đã hết hạn
        firebaseProducts = await this.getProductsFromFirebaseWithCache();
        usedCache = false;
      }

      const indexedDBProducts = await this.getAllProductsFromIndexedDB();

      // Log cache usage
      this.logCacheUsage('getSyncStatus', usedCache, firebaseProducts.length);

      return {
        totalInFirebase: firebaseProducts?.length || 0,
        totalInIndexedDB: indexedDBProducts?.length || 0,
        needsSync: (firebaseProducts?.length || 0) > (indexedDBProducts?.length || 0),
        usedCache: usedCache
      };
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra trạng thái đồng bộ:', error);
      return { totalInFirebase: 0, totalInIndexedDB: 0, needsSync: false, usedCache: false };
    }
  }

  // Method để kiểm tra trạng thái đồng bộ
  async getSyncStatus(): Promise<{ totalInFirebase: number; totalInIndexedDB: number; needsSync: boolean }> {
    try {
      await this.ensureDBInitialized();

      // Kiểm tra cache trước khi gọi API
      const cacheInfo = this.getDetailedCacheInfo();
      let firebaseProducts: Product[] = [];

      if (cacheInfo.hasCache && !cacheInfo.isExpired) {
        // Sử dụng cache nếu còn hợp lệ
        firebaseProducts = this.firebaseProductsCache || [];
        console.log(`📦 Sử dụng cache cho sync status check: ${firebaseProducts.length} products`);
      } else {
        // Chỉ gọi API nếu cache không có hoặc đã hết hạn
        firebaseProducts = await this.getProductsFromFirebaseWithCache();
      }

      const indexedDBProducts = await this.getAllProductsFromIndexedDB();

      return {
        totalInFirebase: firebaseProducts?.length || 0,
        totalInIndexedDB: indexedDBProducts?.length || 0,
        needsSync: (firebaseProducts?.length || 0) > (indexedDBProducts?.length || 0)
      };
    } catch (error) {
      console.error('❌ Lỗi khi kiểm tra trạng thái đồng bộ:', error);
      return { totalInFirebase: 0, totalInIndexedDB: 0, needsSync: false };
    }
  }

  // Method để force sync tất cả products từ Firebase (bỏ qua so sánh)
  async forceSyncAllProductsFromFirebase(): Promise<void> {
    try {
      await this.ensureDBInitialized();

      console.log('🔄 Force sync tất cả products từ Firebase...');

      // Force refresh cache và lấy products mới
      this.clearFirebaseCache();
      const allProducts = await this.getProductsFromFirebaseWithCache();

      if (!allProducts || allProducts.length === 0) {
        console.log('ℹ️ Không có products nào từ Firebase');
        return;
      }

      const validProducts = allProducts.filter(product => product && product.Id);

      if (validProducts.length > 0) {
        // CRITICAL: Sử dụng reseedIndexedDbWithApiProducts để preserve OnHandNV cho clone products
        await this.reseedIndexedDbWithApiProducts(validProducts);

        console.log(`✅ Force sync thành công: ${validProducts.length} products (preserve OnHandNV)`);
      }
    } catch (error) {
      console.error('❌ Lỗi khi force sync products:', error);
      throw error;
    }
  }

  // Method để force refresh cache (public)
  public async refreshFirebaseCache(): Promise<void> {
    this.clearFirebaseCache();
    await this.getProductsFromFirebaseWithCache();
  }

  // Method để kiểm tra trạng thái cache
  public getCacheStatus(): { hasCache: boolean; cacheAge: number; cacheSize: number } {
    const now = Date.now();
    const cacheAge = now - this.cacheTimestamp;

    return {
      hasCache: this.firebaseProductsCache !== null,
      cacheAge: cacheAge,
      cacheSize: this.firebaseProductsCache?.length || 0
    };
  }

  // Method để lấy thông tin cache chi tiết
  public getDetailedCacheInfo(): {
    hasCache: boolean;
    cacheAge: number;
    cacheSize: number;
    isExpired: boolean;
    timeUntilExpiry: number;
  } {
    const now = Date.now();
    const cacheAge = now - this.cacheTimestamp;
    const isExpired = cacheAge >= this.CACHE_DURATION;
    const timeUntilExpiry = Math.max(0, this.CACHE_DURATION - cacheAge);

    return {
      hasCache: this.firebaseProductsCache !== null,
      cacheAge: cacheAge,
      cacheSize: this.firebaseProductsCache?.length || 0,
      isExpired: isExpired,
      timeUntilExpiry: timeUntilExpiry
    };
  }

  // Method để lấy products từ Firebase với cache
  private async getProductsFromFirebaseWithCache(): Promise<Product[]> {
    const now = Date.now();

    // Kiểm tra cache có hợp lệ không
    if (this.firebaseProductsCache && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      console.log('📦 Sử dụng cache cho getProductsFromFirebaseWithCache');
      this.cacheHitCount++;
      this.logCacheUsage('getProductsFromFirebaseWithCache', true, this.firebaseProductsCache.length);
      return this.firebaseProductsCache;
    }

    // Nếu đang có request đang chạy, đợi kết quả
    if (this.currentFirebaseRequest) {
      console.log('⏳ Đợi request Firebase đang chạy...');
      try {
        const products = await this.currentFirebaseRequest;
        console.log(`📦 Nhận kết quả từ request đang chạy: ${products.length} products`);
        return products;
      } catch (error) {
        console.error('❌ Lỗi từ request đang chạy:', error);
        // Nếu request đang chạy bị lỗi, tiếp tục với request mới
      }
    }

    // Cache hết hạn hoặc chưa có, tạo request mới
    console.log('🔄 Tạo request Firebase mới (getProductsFromFirebaseWithCache)');
    this.currentFirebaseRequest = this.fetchProductsFromFirebase();

    try {
      const products = await this.currentFirebaseRequest;
      console.log(`📦 Đã nhận ${products.length} products từ request mới (getProductsFromFirebaseWithCache)`);
      this.logCacheUsage('getProductsFromFirebaseWithCache', false, products.length);
      return products;
    } catch (error) {
      console.error('❌ Lỗi khi lấy products từ request mới (getProductsFromFirebaseWithCache):', error);
      // Trả về cache cũ nếu có, hoặc array rỗng
      const fallbackProducts = this.firebaseProductsCache || [];
      this.logCacheUsage('getProductsFromFirebaseWithCache_fallback', true, fallbackProducts.length);
      return fallbackProducts;
    } finally {
      // Clear request đang chạy
      this.currentFirebaseRequest = null;
    }
  }

  // Method private để thực hiện việc fetch products từ Firebase
  private async fetchProductsFromFirebase(): Promise<Product[]> {
    try {
      console.log('🔎 [DEBUG] fetchProductsFromFirebase: gọi getAllProductsFromFirebase API');
      const products = await firstValueFrom(this.getAllProductsFromFirebase());
      console.log(`🔎 [DEBUG] fetchProductsFromFirebase: API trả về ${Array.isArray(products) ? products.length : 'non-array'} items`);
      return Array.isArray(products) ? products : [];
    } catch (error) {
      console.error('❌ Lỗi trong fetchProductsFromFirebase:', error);
      return []; // trả về mảng rỗng để không làm sập luồng
    }
  }

  // Clear cache khi cần thiết
  private clearFirebaseCache(): void {
    this.firebaseProductsCache = null;
    this.cacheTimestamp = 0;
    this.currentFirebaseRequest = null; // Clear shared request
    console.log('🗑️ Đã xóa cache Firebase products và shared request');
  }

  // Method để force clear shared request
  public forceClearSharedRequest(): void {
    this.currentFirebaseRequest = null;
    console.log('🔄 Đã force clear shared Firebase request');
  }

  // Method để force clear cache khi thực sự cần thiết
  public forceClearCache(): void {
    this.clearFirebaseCache();
    console.log('🔄 Đã force clear Firebase cache');
  }

  // Method để kiểm tra xem có cần clear cache không
  private shouldClearCache(): boolean {
    const cacheInfo = this.getDetailedCacheInfo();
    // Chỉ clear cache nếu cache quá cũ (hơn 10 phút) hoặc không có cache
    return !cacheInfo.hasCache || cacheInfo.cacheAge > 10 * 60 * 1000;
  }

  // Method để reset database (xóa và tạo lại)
  async resetDatabase(): Promise<void> {
    try {
      console.log('🔄 Reset ProductService IndexedDB...');

      // Xóa database hoàn toàn rồi tạo lại với version gốc (tránh version drift)
      await this.indexedDBService.deleteDatabase(this.dbName);

      // Khởi tạo lại database
      await this.initDB();

      console.log('✅ ProductService IndexedDB đã được reset thành công');
    } catch (error) {
      console.error('❌ Lỗi khi reset ProductService IndexedDB:', error);
      throw error;
    }
  }

  // Method để debug trạng thái database
  async debugDatabaseStatus(): Promise<void> {
    try {
      console.log('🔍 Debug ProductService IndexedDB status...');

      const connectionInfo = this.indexedDBService.getConnectionInfo(this.dbName);
      console.log(`📊 Connection info:`, connectionInfo);

      const objectStores = await this.indexedDBService.getObjectStoreNames(this.dbName, this.dbVersion);
      console.log(`📦 Object stores:`, objectStores);

      const storeExists = await this.indexedDBService.checkObjectStoreExists(this.dbName, this.dbVersion, this.storeName);
      console.log(`🔍 Store '${this.storeName}' exists:`, storeExists);

      if (storeExists) {
        try {
          const products = await this.getAllProductsFromIndexedDB();
          console.log(`📦 Products count: ${products.length}`);
        } catch (error) {
          console.error('❌ Không thể đọc products:', error);
        }
      }
    } catch (error) {
      console.error('❌ Lỗi khi debug database status:', error);
    }
  }

  // Method để log cache usage
  private logCacheUsage(operation: string, usedCache: boolean, productCount: number): void {
    const cacheInfo = this.getDetailedCacheInfo();
    console.log(`📊 Cache Usage [${operation}] - Used Cache: ${usedCache}, Products: ${productCount}, Cache Age: ${Math.round(cacheInfo.cacheAge / 1000)}s, Expired: ${cacheInfo.isExpired}`);
  }

  // Method để preload cache (gọi trước khi thực hiện các operation khác)
  async preloadFirebaseCache(): Promise<void> {
    try {
      console.log('🔄 Preloading Firebase cache...');
      const cacheInfo = this.getDetailedCacheInfo();

      if (!cacheInfo.hasCache || cacheInfo.isExpired) {
        console.log('📦 Cache không hợp lệ, bắt đầu preload...');
        await this.getProductsFromFirebaseWithCache(); // Sử dụng shared request mechanism
        console.log('✅ Firebase cache đã được preload');
      } else {
        console.log('ℹ️ Firebase cache đã có và còn hợp lệ, bỏ qua preload');
      }
    } catch (error) {
      console.error('❌ Lỗi khi preload Firebase cache:', error);
    }
  }

  // Method để preload cache với force refresh
  async forcePreloadFirebaseCache(): Promise<void> {
    try {
      console.log('🔄 Force preloading Firebase cache...');
      this.clearFirebaseCache(); // Clear cache và shared request
      await this.getProductsFromFirebaseWithCache(); // Tạo request mới
      console.log('✅ Firebase cache đã được force preload');
    } catch (error) {
      console.error('❌ Lỗi khi force preload Firebase cache:', error);
    }
  }

  // Method mới để xử lý việc gửi lên Firestore với debounce
  public async debouncedSaveToFirebase(products: Product[], delay = 1000): Promise<void> {
    // Thêm products vào danh sách chờ
    this.pendingProductsToSave.push(...products);

    // Clear timeout cũ nếu có
    if (this.saveToFirebaseTimeout) {
      clearTimeout(this.saveToFirebaseTimeout);
    }

    // Set timeout mới
    this.saveToFirebaseTimeout = setTimeout(async () => {
      await this.executeSaveToFirebase();
    }, delay);
  }

  public async flushPendingFirebaseSaves(): Promise<Product[] | null> {
    if (this.saveToFirebaseTimeout) {
      clearTimeout(this.saveToFirebaseTimeout);
      this.saveToFirebaseTimeout = null;
    }

    return await this.executeSaveToFirebase();
  }

  /**
   * Optimized sync method that:
   * 1. Calls the sync endpoint (fast, returns stats only)
   * 2. Fetches products separately from Firebase
   * 3. Returns comprehensive result with error details
   */
  public async syncKiotVietToFirebase(): Promise<{
    success: boolean;
    products?: Product[];
    stats?: any;
    error?: string;
    errorType?: string;
  }> {
    try {
      console.log('🔄 Bắt đầu sync KiotViet -> Firebase (optimized)...');

      // Step 1: Trigger sync (returns stats only, fast)
      const syncResult = await this.fetchAndSaveMergedProductsFromBackend(false);

      if (!syncResult.success) {
        console.error('❌ Sync failed:', syncResult.error);
        return {
          success: false,
          error: syncResult.error || 'Đồng bộ thất bại',
          errorType: 'sync_failed'
        };
      }

      console.log('✅ Sync succeeded:', syncResult.stats);

      // Step 2: Fetch products from Firebase separately (uses cache)
      console.log('📥 Fetching products from Firebase...');
      const products = await firstValueFrom(
        this.getAllProductsFromFirebase().pipe(
          catchError(err => {
            console.error('⚠️ Không thể lấy products từ Firebase:', err);
            return of([]);
          })
        )
      );

      // Step 3: Save to IndexedDB if we got products
      // CRITICAL: Sử dụng reseedIndexedDbWithApiProducts để preserve OnHandNV cho clone products
      if (products && products.length > 0) {
        console.log(`💾 Lưu ${products.length} products vào IndexedDB (preserve OnHandNV)...`);
        try {
          // Sử dụng reseedIndexedDbWithApiProducts thay vì clear/putMany
          // để preserve OnHandNV và clone metadata từ IndexedDB hiện tại
          await this.reseedIndexedDbWithApiProducts(products);
        } catch (dbErr) {
          console.error('⚠️ Lỗi khi lưu vào IndexedDB:', dbErr);
        }
      }

      return {
        success: true,
        products,
        stats: syncResult.stats
      };

    } catch (err: any) {
      console.error('❌ Lỗi trong syncKiotVietToFirebase:', err);
      return {
        success: false,
        error: err?.message || 'Lỗi không xác định',
        errorType: 'unexpected_error'
      };
    }
  }

  // Method để thực hiện việc gửi lên Firestore
  private async executeSaveToFirebase(): Promise<Product[] | null> {
    if (this.isSavingToFirebase || this.pendingProductsToSave.length === 0) {
      return null;
    }

    try {
      this.isSavingToFirebase = true;

      // Lấy tất cả products chờ và xóa danh sách chờ
      const productsToSave = [...this.pendingProductsToSave];
      this.pendingProductsToSave = [];

      console.log(`🔄 Thực hiện gửi ${productsToSave.length} sản phẩm lên Firestore...`);

      // Loại bỏ duplicates dựa trên Id
      const uniqueProducts = this.removeDuplicateProducts(productsToSave);

      if (uniqueProducts.length > 0) {
        // POST uniqueProducts to backend sync endpoint. Expect backend to return the merged final products list.
        try {
          const resp = await firstValueFrom(this.saveAllProductsToFirebase(uniqueProducts).pipe(
            catchError(err => {
              console.error('❌ Lỗi khi gọi POST sync endpoint (saveAllProductsToFirebase):', err);
              return of([] as unknown);
            })
          ));

          const merged = this.normalizeProductApiPayload(resp);

          if (merged && merged.length > 0) {
            // CRITICAL: Sử dụng reseedIndexedDbWithApiProducts để preserve OnHandNV cho clone products
            await this.reseedIndexedDbWithApiProducts(merged);
            this.firebaseProductsCache = merged.map(p => this.sanitizeProductForStorage({ ...p }));
            this.cacheTimestamp = Date.now();
            console.log(`✅ Đã gửi và lưu ${merged.length} sản phẩm trả về từ backend vào IndexedDB (preserve OnHandNV)`);
          } else {
            console.log(`ℹ️ POST sync endpoint trả về rỗng sau khi gửi ${uniqueProducts.length} sản phẩm`);
          }

          this.clearFirebaseCache();

          return merged;
        } catch (err) {
          console.error('❌ Lỗi khi gửi sản phẩm lên Firestore và lưu kết quả:', err);
          return null;
        }
      }

    } catch (error) {
      console.error('❌ Lỗi khi gửi sản phẩm lên Firestore:', error);
      // Thêm lại products vào danh sách chờ nếu có lỗi
      this.pendingProductsToSave.unshift(...this.pendingProductsToSave);
    } finally {
      this.isSavingToFirebase = false;
    }
    return null;
  }

  // Method để loại bỏ products trùng lặp
  private removeDuplicateProducts(products: Product[]): Product[] {
    const uniqueMap = new Map<number, Product>();

    for (const product of products) {
      if (product.Id) {
        uniqueMap.set(product.Id, product);
      }
    }

    return Array.from(uniqueMap.values());
  }

  // Method để force execute save to Firebase ngay lập tức
  public async forceExecuteSaveToFirebase(): Promise<void> {
    // Clear timeout nếu có
    if (this.saveToFirebaseTimeout) {
      clearTimeout(this.saveToFirebaseTimeout);
      this.saveToFirebaseTimeout = null;
    }

    // Execute ngay lập tức
    await this.executeSaveToFirebase();
  }

  // Method để lấy trạng thái của debounce mechanism
  public getSaveToFirebaseStatus(): {
    isSaving: boolean;
    pendingCount: number;
    hasTimeout: boolean;
  } {
    return {
      isSaving: this.isSavingToFirebase,
      pendingCount: this.pendingProductsToSave.length,
      hasTimeout: this.saveToFirebaseTimeout !== null
    };
  }

  // Method để kiểm tra xem có thay đổi gì không (trừ OnHand)
  private hasProductChanges(existing: Product, newProduct: Product): boolean {
    // Danh sách các trường quan trọng cần so sánh
    const importantFields: (keyof Product)[] = [
      'Name', 'FullName', 'Code', 'Cost', 'BasePrice', 'Unit',
      'Description', 'CategoryId', 'MasterUnitId', 'MasterProductId',
      'ConversionValue', 'IsRewardPoint', 'isActive', 'isDeleted',
      'Image', 'ProductAttributes', 'NormalizedName', 'NormalizedCode',
      'OrderTemplate', 'ModifiedDate', 'CreatedDate',
      'Tax', 'isClone', 'CloneSourceId'  // ✅ Thêm Tax và clone fields
    ];

    let hasChanges = false;
    const changes: string[] = [];

    for (const field of importantFields) {
      const existingValue = existing[field];
      const newValue = newProduct[field];

      // So sánh giá trị
      if (existingValue !== newValue) {
        changes.push(`${field}: ${existingValue} -> ${newValue}`);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      console.log(`📊 Thay đổi cho product ${newProduct.Id} (${newProduct.Name}):`, changes.join(', '));
    }

    return hasChanges;
  }

  // Method để log chi tiết thay đổi của product
  private logProductChanges(existing: Product, newProduct: Product): void {
    console.log(`🔍 Chi tiết thay đổi cho product ${newProduct.Id}:`);
    console.log(`   Tên: ${existing.Name} -> ${newProduct.Name}`);
    console.log(`   Mã: ${existing.Code} -> ${newProduct.Code}`);
    console.log(`   Giá gốc: ${existing.Cost} -> ${newProduct.Cost}`);
    console.log(`   Giá bán: ${existing.BasePrice} -> ${newProduct.BasePrice}`);
    console.log(`   Đơn vị: ${existing.Unit} -> ${newProduct.Unit}`);
    console.log(`   OnHand: ${existing.OnHand} -> ${newProduct.OnHand}`);
  }

  // Method để log OnHand trước và sau khi sync
  private logOnHandComparison(productId: number, beforeOnHand: number, afterOnHand: number, source: string): void {
    if (beforeOnHand !== afterOnHand) {
      console.warn(`⚠️ OnHand thay đổi cho product ${productId}: ${beforeOnHand} -> ${afterOnHand} (${source})`);
    } else {
      console.log(`✅ OnHand giữ nguyên cho product ${productId}: ${beforeOnHand} (${source})`);
    }
  }

  // Method để debug OnHand trong toàn bộ quá trình
  public async debugOnHandForProduct(productId: number): Promise<void> {
    try {
      console.log(`🔍 Debug OnHand cho product ${productId}:`);

      // Lấy từ IndexedDB
      const indexedDBProduct = await this.getProductByIdFromIndexedDB(productId);
      console.log(`   IndexedDB OnHand: ${indexedDBProduct?.OnHand || 'N/A'}`);

      // Lấy từ Firestore (force clear cache)
      this.clearFirebaseCache();
      const firebaseProducts = await this.getProductsFromFirebaseWithCache();
      const firebaseProduct = firebaseProducts.find(p => p.Id === productId);
      console.log(`   Firestore OnHand: ${firebaseProduct?.OnHand || 'N/A'}`);

      // So sánh
      if (indexedDBProduct && firebaseProduct) {
        if (indexedDBProduct.OnHand === firebaseProduct.OnHand) {
          console.log(`   ✅ OnHand đồng bộ: ${indexedDBProduct.OnHand}`);
        } else {
          console.warn(`   ⚠️ OnHand không đồng bộ: IndexedDB=${indexedDBProduct.OnHand}, Firestore=${firebaseProduct.OnHand}`);
        }
      }

    } catch (error) {
      console.error(`❌ Lỗi khi debug OnHand cho product ${productId}:`, error);
    }
  }

  // Method để force sync OnHand từ IndexedDB lên Firestore
  public async forceSyncOnHandToFirestore(): Promise<void> {
    try {
      console.log('🔄 Force sync OnHand từ IndexedDB lên Firestore...');

      // Lấy tất cả products từ IndexedDB
      const indexedDBProducts = await this.getAllProductsFromIndexedDB();

      if (indexedDBProducts.length === 0) {
        console.log('ℹ️ Không có products nào trong IndexedDB');
        return;
      }

      // Lấy products từ Firestore
      this.clearFirebaseCache();
      const firebaseProducts = await this.getProductsFromFirebaseWithCache();
      const firebaseMap = new Map(firebaseProducts.map(p => [p.Id, p]));

      // Chuẩn bị products để gửi lên Firestore
      const productsToSync: Product[] = [];

      for (const indexedDBProduct of indexedDBProducts) {
        const firebaseProduct = firebaseMap.get(indexedDBProduct.Id);

        if (firebaseProduct) {
          // Tạo bản sao từ Firestore và cập nhật OnHand
          const productToSync = { ...firebaseProduct };
          productToSync.OnHand = indexedDBProduct.OnHand;

          if (firebaseProduct.OnHand !== indexedDBProduct.OnHand) {
            console.log(`🔄 Sync OnHand cho product ${indexedDBProduct.Id}: ${firebaseProduct.OnHand} -> ${indexedDBProduct.OnHand}`);
            productsToSync.push(productToSync);
          }
        }
      }

      if (productsToSync.length > 0) {
        console.log(`🔄 Gửi ${productsToSync.length} products với OnHand đã cập nhật lên Firestore...`);
        await this.debouncedSaveToFirebase(productsToSync);
        console.log(`✅ Đã force sync OnHand cho ${productsToSync.length} products`);
      } else {
        console.log('ℹ️ Tất cả OnHand đã đồng bộ, không cần cập nhật');
      }

    } catch (error) {
      console.error('❌ Lỗi khi force sync OnHand:', error);
      throw error;
    }
  }

  // Method để lấy trạng thái cache performance
  public getCachePerformanceStats(): {
    apiCallCount: number;
    cacheHitCount: number;
    cacheHitRate: number;
    cacheAge: number;
    cacheSize: number;
    isExpired: boolean;
  } {
    const totalCalls = this.apiCallCount + this.cacheHitCount;
    const cacheHitRate = totalCalls > 0 ? (this.cacheHitCount / totalCalls) * 100 : 0;
    const cacheInfo = this.getDetailedCacheInfo();

    return {
      apiCallCount: this.apiCallCount,
      cacheHitCount: this.cacheHitCount,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100, // Làm tròn 2 chữ số thập phân
      cacheAge: cacheInfo.cacheAge,
      cacheSize: cacheInfo.cacheSize,
      isExpired: cacheInfo.isExpired
    };
  }

  // Method để reset cache performance stats
  public resetCachePerformanceStats(): void {
    this.apiCallCount = 0;
    this.cacheHitCount = 0;
    console.log('🔄 Đã reset cache performance stats');
  }

  // Method để log cache performance stats
  public logCachePerformanceStats(): void {
    const stats = this.getCachePerformanceStats();
    console.log('📊 Cache Performance Stats:');
    console.log(`   API Calls: ${stats.apiCallCount}`);
    console.log(`   Cache Hits: ${stats.cacheHitCount}`);
    console.log(`   Cache Hit Rate: ${stats.cacheHitRate}%`);
    console.log(`   Cache Age: ${Math.round(stats.cacheAge / 1000)}s`);
    console.log(`   Cache Size: ${stats.cacheSize} products`);
    console.log(`   Cache Expired: ${stats.isExpired}`);
    console.log(`   Shared Request Active: ${this.currentFirebaseRequest !== null}`);
  }

  // Method để lấy trạng thái shared request
  public getSharedRequestStatus(): {
    hasActiveRequest: boolean;
    cacheStatus: string;
    requestCount: number;
  } {
    const cacheInfo = this.getDetailedCacheInfo();
    let cacheStatus = 'No Cache';

    if (cacheInfo.hasCache) {
      if (cacheInfo.isExpired) {
        cacheStatus = 'Expired';
      } else {
        cacheStatus = 'Valid';
      }
    }

    return {
      hasActiveRequest: this.currentFirebaseRequest !== null,
      cacheStatus: cacheStatus,
      requestCount: this.apiCallCount
    };
  }

  // Method để debug API calls
  public debugAPICalls(): void {
    const stats = this.getCachePerformanceStats();
    const status = this.getSharedRequestStatus();

    console.log('🔍 API Calls Debug:');
    console.log(`   Total API Calls: ${stats.apiCallCount}`);
    console.log(`   Cache Hits: ${stats.cacheHitCount}`);
    console.log(`   Cache Hit Rate: ${stats.cacheHitRate}%`);
    console.log(`   Active Request: ${status.hasActiveRequest}`);
    console.log(`   Cache Status: ${status.cacheStatus}`);
    console.log(`   Should Clear Cache: ${this.shouldClearCache()}`);
  }

  async updateProductOnHandToFireStore(products: Product[]): Promise<void> {
    const minimalProducts = products.map(p => ({ Id: p.Id, OnHand: p.OnHand }));
    const url = `${environment.domainUrl}/api/firebase/update/products`;
    const t0 = performance.now();
    await this.http.put(url, minimalProducts).toPromise();
    const t1 = performance.now();
    console.log(`⏱️ Gửi lên Firestore (API /api/firebase/update/products) mất ${t1 - t0} ms`);
  }

  /**
   * Fetch latest product documents by IDs from backend polling endpoint.
   * Backend endpoint: POST /api/firebase/products/fetch with body { ids: [...] }
   * Updates IndexedDB with returned product documents.
   */
  public async fetchProductsByIds(ids: Array<number | string>): Promise<Product[]> {
    if (!ids || ids.length === 0) return [];
    try {
      const url = `${environment.domainUrl}/api/firebase/products/fetch`;
      const payload = { ids: ids.map(id => String(id)) };
      const res = await firstValueFrom(this.http.post<any[]>(url, payload).pipe(
        catchError(err => {
          console.warn('fetchProductsByIds: backend fetch failed', err);
          return of([]);
        })
      ));

      if (Array.isArray(res) && res.length > 0) {
        for (const p of res) {
          try {
            // ensure the returned doc is persisted into IndexedDB so UI sees freshest data
            await this.updateProductFromIndexedDB(p as Product);
          } catch (dbErr) {
            console.warn('fetchProductsByIds: failed to update IndexedDB for product', p?.Id, dbErr);
          }
        }
      }

      return Array.isArray(res) ? (res as Product[]) : [];
    } catch (err) {
      console.warn('fetchProductsByIds unexpected error', err);
      return [];
    }
  }

  /**
   * Fetch latest products (optionally limited) from backend endpoint.
   * GET /api/firebase/products/latest?limit=NN
   */
  public async fetchLatestProducts(limit?: number): Promise<Product[]> {
    try {
      const url = `${environment.domainUrl}/api/firebase/products/latest${limit ? `?limit=${limit}` : ''}`;
      const res = await firstValueFrom(this.http.get<any[]>(url).pipe(
        catchError(err => {
          console.warn('fetchLatestProducts: backend fetch failed', err);
          return of([]);
        })
      ));

      if (Array.isArray(res) && res.length > 0) {
        for (const p of res) {
          try {
            await this.updateProductFromIndexedDB(p as Product);
          } catch (dbErr) {
            console.warn('fetchLatestProducts: failed to update IndexedDB for product', p?.Id, dbErr);
          }
        }
      }

      return Array.isArray(res) ? (res as Product[]) : [];
    } catch (err) {
      console.warn('fetchLatestProducts unexpected error', err);
      return [];
    }
  }

  public async updateProductsBatchToFirebase(groupedProducts: Record<string, Product[]>): Promise<void> {
    // Nếu API backend nhận object group, gửi trực tiếp:
    // Nếu API backend chỉ nhận array, cần chuyển về array:
    // const allProducts: Product[] = Object.values(groupedProducts).flat();

    const url = `${environment.domainUrl}${this.firebaseService.update_multi_products_by_id_to_firebase}`;
    try {
      await this.http.put(url, groupedProducts).toPromise();
      console.log('✅ Đã gửi batch sản phẩm lên Firestore thành công!');
    } catch (error) {
      console.error('❌ Lỗi khi gửi batch sản phẩm lên Firestore:', error);
      throw error;
    }
  }

  // Lưu đơn đặt hàng vào IndexedDB
  async addOrderToIndexedDB(order: any): Promise<void> {
    await this.ensureDBInitialized();
    await this.indexedDBService.put(this.orderDBName, 1, 'order', order);
  }

  // Lấy toàn bộ đơn đặt hàng từ IndexedDB
  async getAllOrdersFromIndexedDB(): Promise<any[]> {
    await this.ensureDBInitialized();
    return await this.indexedDBService.getAll(this.orderDBName, 1, 'order');
  }

  // WebSocket initialization and listeners removed — backend no longer accepts incoming websocket updates.
  // The service now uses REST update endpoints and polling/fetch helpers to keep IndexedDB in sync.

  private async handleProductOnHandUpdated(
    productId: number,
    newOnHand: number | null,
    newBasePrice: number | null = null,
    newCost: number | null = null,
    newCode: string | null = null,
    newFullName: string | null = null,
    newName: string | null = null
  ): Promise<void> {
    try {
      const onHandValue = this.parseFiniteNumber(newOnHand);
      const basePriceValue = this.parseFiniteNumber(newBasePrice);
      const costValue = this.parseFiniteNumber(newCost);

      const hasOnHand = onHandValue !== null;
      const hasBasePrice = basePriceValue !== null;
      const hasCost = costValue !== null;
      const hasCode = typeof newCode === 'string' && newCode.trim().length > 0;
      const hasFullName = typeof newFullName === 'string' && newFullName.trim().length > 0;
      const hasName = typeof newName === 'string' && newName.trim().length > 0;
      if (!hasOnHand && !hasBasePrice && !hasCost && !hasCode && !hasFullName && !hasName) {
        console.warn(`⚠️ handleProductOnHandUpdated called without valid fields for id=${productId}`);
        return;
      }

      const codeValue = hasCode ? newCode!.trim() : null;
      const fullNameValue = hasFullName ? newFullName!.trim() : null;
      const nameValue = hasName ? newName!.trim() : null;

      // Use the same DB/store used across the service
      console.log(`ℹ️ handleProductOnHandUpdated called for id=${productId}, onHand=${onHandValue}, basePrice=${basePriceValue}, cost=${costValue}, code=${codeValue}, fullName=${fullNameValue}`);
      await this.ensureDBInitialized();

      // Try direct lookup first
      let product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
      if (!product) {
        console.warn(`⚠️ Real-time: Product ${productId} not found by numeric key. Attempting fallback lookups...`);

        try {
          // Read a few entries from the store to inspect keys and types
          const all = await this.indexedDBService.getAll<Product>(this.dbName, this.dbVersion, this.storeName);
          console.warn(`ℹ️ IndexedDB contains ${all.length} products (showing up to 5 ids):`,
            all.slice(0, 5).map((p: any) => ({ Id: p?.Id, typeOfId: typeof p?.Id })));

          // Try to find by loose equality in the dataset (covers string vs number mismatch cases)
          const found = all.find((p: any) => Number(p?.Id) === Number(productId));
          if (found) {
            product = found as Product;
            console.log(`ℹ️ Fallback: matched product in dataset by loose equality Id=${(product as any).Id}`);
          }

          if (!product) {
            // Try string-key lookup (some clients store keys as strings)
            const strKey = String(productId);
            const stringKeyMatch = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, strKey as any);
            if (stringKeyMatch) {
              product = stringKeyMatch;
              console.log(`ℹ️ Fallback: found product with string key '${strKey}'`);
            }
          }
        } catch (readErr) {
          console.error('❌ Error during fallback IndexedDB inspection:', readErr);
        }
      }

      if (product) {
        let changed = false;
        if (onHandValue !== null && product) {
          const beforeOnHand = (product as Product).OnHand;
          if (beforeOnHand !== onHandValue) {
            (product as Product).OnHand = onHandValue;
            console.log(`✅ Real-time: Updated OnHand for product ${productId} in IndexedDB: ${beforeOnHand} -> ${onHandValue}`);
            changed = true;
          }
        }
        if (basePriceValue !== null && product) {
          const beforeBase = (product as Product).BasePrice;
          if (beforeBase !== basePriceValue) {
            (product as Product).BasePrice = basePriceValue;
            if (typeof (product as any).FinalBasePrice === 'number') {
              (product as any).FinalBasePrice = basePriceValue;
            }
            console.log(`✅ Real-time: Updated BasePrice for product ${productId} in IndexedDB: ${beforeBase} -> ${basePriceValue}`);
            changed = true;
          }
        }
        if (costValue !== null && product) {
          const beforeCost = (product as Product).Cost;
          if (beforeCost !== costValue) {
            (product as Product).Cost = costValue;
            changed = true;
          }
        }
        if (hasCode && product) {
          const beforeCode = (product as Product).Code;
          if (beforeCode !== codeValue) {
            (product as Product).Code = codeValue as string;
            changed = true;
          }
        }
        if (hasFullName && product) {
          const beforeFullName = (product as any).FullName;
          if (beforeFullName !== fullNameValue) {
            (product as any).FullName = fullNameValue as string;
            changed = true;
          }
        }
        if (hasName && product) {
          const beforeName = (product as any).Name;
          if (beforeName !== nameValue) {
            (product as any).Name = nameValue as string;
            changed = true;
          }
        }

        if (changed) {
          await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product as Product);

          // Verify write by reading back
          try {
            const verify = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, (product as any).Id as any);
            console.log('🔍 Verified IndexedDB value after write:', {
              idRead: verify?.Id,
              OnHand: verify?.OnHand,
              BasePrice: (verify as any)?.BasePrice,
              Cost: (verify as any)?.Cost,
              Code: (verify as any)?.Code
            });
          } catch (verifyErr) {
            console.error('❌ Error verifying IndexedDB write:', verifyErr);
          }
        }
      } else {
        console.warn(`⚠️ Real-time: Product ${productId} not present in IndexedDB after fallback attempts — will retry apply shortly`);
        // Queue a few retry attempts to apply once the product list finishes syncing locally
        this.queueRetryApplyOnHand(productId, {
          onHand: onHandValue ?? undefined,
          basePrice: basePriceValue ?? undefined,
          cost: costValue ?? undefined,
          code: codeValue ?? undefined,
          fullName: fullNameValue ?? undefined,
          name: nameValue ?? undefined
        });
      }

      // Emit event for UI/components regardless (so UI can decide to reload or fetch)
      const payload: ProductRealtimeUpdate = { productId };
      const fallbackProduct = product as Product | undefined;
      if (onHandValue !== null) {
        payload.onHand = onHandValue;
      } else if (fallbackProduct && Number.isFinite(Number(fallbackProduct.OnHand))) {
        payload.onHand = Number(fallbackProduct.OnHand);
      }
      if (basePriceValue !== null) {
        payload.basePrice = basePriceValue;
      } else if (fallbackProduct && Number.isFinite(Number((fallbackProduct as any).BasePrice))) {
        payload.basePrice = Number((fallbackProduct as any).BasePrice);
      }
      if (costValue !== null) {
        payload.cost = costValue;
      } else if (fallbackProduct && Number.isFinite(Number((fallbackProduct as any).Cost))) {
        payload.cost = Number((fallbackProduct as any).Cost);
      }
      const finalCode = hasCode && codeValue ? codeValue : (typeof (fallbackProduct as any)?.Code === 'string' ? (fallbackProduct as any).Code : undefined);
      if (finalCode) {
        payload.code = finalCode;
      }
      const finalFullName = hasFullName && fullNameValue ? fullNameValue : (typeof (fallbackProduct as any)?.FullName === 'string' ? (fallbackProduct as any).FullName : undefined);
      if (finalFullName) {
        payload.fullName = finalFullName;
      }
      const finalName = hasName && nameValue ? nameValue : (typeof (fallbackProduct as any)?.Name === 'string' ? (fallbackProduct as any).Name : undefined);
      if (finalName) {
        payload.name = finalName;
      }

      if (
        payload.onHand !== undefined ||
        payload.basePrice !== undefined ||
        payload.cost !== undefined ||
        payload.code !== undefined ||
        payload.fullName !== undefined ||
        payload.name !== undefined
      ) {
        this.productOnHandUpdatedSubject.next(payload);
      }
    } catch (error) {
      console.error(`❌ Error handling product_onhand_updated:`, error);
    }
  }

  // Batch handler: [{ Id|productId, OnHand|onHand }]
  private async handleProductsOnHandUpdated(items: any[]): Promise<void> {
    try {
      if (!items || items.length === 0) return;
      await this.ensureDBInitialized();

      // Normalize and deduplicate by Id
      const map = new Map<number, {
        onHand?: number;
        basePrice?: number;
        cost?: number;
        code?: string;
        fullName?: string;
        name?: string;
      }>();
      for (const raw of items) {
        const id = Number(raw?.Id ?? raw?.productId ?? raw?.id);
        const onHandRaw = raw?.OnHand ?? raw?.onHand;
        const basePriceRaw = raw?.BasePrice ?? raw?.basePrice;
        const oh = Number(onHandRaw);
        const bp = Number(basePriceRaw);
        const hasOnHand = Number.isFinite(oh);
        const hasBasePrice = Number.isFinite(bp);
        const costRaw = raw?.Cost ?? raw?.cost;
        const cost = Number(costRaw);
        const hasCost = Number.isFinite(cost);
        const codeRaw = raw?.Code ?? raw?.code;
        const code = typeof codeRaw === 'string' && codeRaw.trim().length > 0 ? codeRaw.trim() : undefined;
        const fullNameRaw = raw?.FullName ?? raw?.fullName;
        const fullName = typeof fullNameRaw === 'string' && fullNameRaw.trim().length > 0 ? fullNameRaw.trim() : undefined;
        const nameRaw = raw?.Name ?? raw?.name;
        const name = typeof nameRaw === 'string' && nameRaw.trim().length > 0 ? nameRaw.trim() : undefined;
        if (Number.isFinite(id) && (hasOnHand || hasBasePrice || hasCost || code || fullName || name)) {
          const entry = map.get(id) ?? {};
          if (hasOnHand) entry.onHand = oh;
          if (hasBasePrice) entry.basePrice = bp;
          if (hasCost) entry.cost = cost;
          if (code) entry.code = code;
          if (fullName) entry.fullName = fullName;
          if (name) entry.name = name;
          map.set(id, entry);
        }
      }
      if (map.size === 0) return;

      // Read all current products once and update those present
      const updatedRecords: Product[] = [];
      const notFoundIds: number[] = [];
      for (const [id, payload] of map.entries()) {
        try {
          const prod = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, id);
          if (prod) {
            let changed = false;
            if (payload.onHand !== undefined) {
              prod.OnHand = payload.onHand;
              changed = true;
            }
            if (payload.basePrice !== undefined) {
              const beforeBase = prod.BasePrice;
              prod.BasePrice = payload.basePrice;
              if (typeof (prod as any).FinalBasePrice === 'number') {
                (prod as any).FinalBasePrice = payload.basePrice;
              }
              if (beforeBase !== payload.basePrice) {
                changed = true;
              }
            }
            if (payload.cost !== undefined) {
              const beforeCost = (prod as any).Cost;
              if (beforeCost !== payload.cost) {
                (prod as any).Cost = payload.cost;
                changed = true;
              }
            }
            if (payload.code !== undefined) {
              const beforeCode = (prod as any).Code;
              if (beforeCode !== payload.code) {
                (prod as any).Code = payload.code;
                changed = true;
              }
            }
            if (payload.fullName !== undefined) {
              const beforeFullName = (prod as any).FullName;
              if (beforeFullName !== payload.fullName) {
                (prod as any).FullName = payload.fullName;
                changed = true;
              }
            }
            if (payload.name !== undefined) {
              const beforeName = (prod as any).Name;
              if (beforeName !== payload.name) {
                (prod as any).Name = payload.name;
                changed = true;
              }
            }
            if (changed) {
              updatedRecords.push(prod);
            }
          } else {
            notFoundIds.push(id);
          }
        } catch (e) {
          console.warn('⚠️ handleProductsOnHandUpdated: error reading id', id, e);
        }
      }

      if (updatedRecords.length > 0) {
        await this.indexedDBService.putMany<Product>(this.dbName, this.dbVersion, this.storeName, updatedRecords);
        console.log(`✅ Real-time batch: Updated ${updatedRecords.length} products in IndexedDB`);
        // emit per-product UI events
        for (const rec of updatedRecords) {
          const payload: ProductRealtimeUpdate = {
            productId: rec.Id
          };
          if (typeof rec.OnHand === 'number' && Number.isFinite(rec.OnHand)) payload.onHand = rec.OnHand;
          if (typeof rec.BasePrice === 'number' && Number.isFinite(rec.BasePrice)) payload.basePrice = rec.BasePrice;
          if (typeof (rec as any).Cost === 'number' && Number.isFinite((rec as any).Cost)) payload.cost = (rec as any).Cost;
          if (typeof (rec as any).Code === 'string' && (rec as any).Code.trim().length > 0) payload.code = (rec as any).Code;
          if (typeof (rec as any).FullName === 'string' && (rec as any).FullName.trim().length > 0) payload.fullName = (rec as any).FullName;
          if (typeof (rec as any).Name === 'string' && (rec as any).Name.trim().length > 0) payload.name = (rec as any).Name;
          this.productOnHandUpdatedSubject.next(payload);
        }
      }

      // For not found ids, queue retry applies
      for (const id of notFoundIds) {
        const entry = map.get(id)!;
        this.queueRetryApplyOnHand(id, entry);
      }
    } catch (err) {
      console.error('❌ handleProductsOnHandUpdated error:', err);
    }
  }

  // Retry helper: attempt to apply OnHand to IndexedDB a few times to handle races with initial sync
  private queueRetryApplyOnHand(
    productId: number,
    payload: {
      onHand?: number | null;
      basePrice?: number | null;
      cost?: number | null;
      code?: string | null;
      fullName?: string | null;
      name?: string | null;
    },
    maxAttempts = 5,
    delayMs = 1500
  ): void {
    const normalizedOnHand = Number.isFinite(payload.onHand as number) ? Number(payload.onHand) : undefined;
    const normalizedBasePrice = Number.isFinite(payload.basePrice as number) ? Number(payload.basePrice) : undefined;
    const normalizedCost = Number.isFinite(payload.cost as number) ? Number(payload.cost) : undefined;
    const normalizedCode = typeof payload.code === 'string' && payload.code.trim().length > 0 ? payload.code.trim() : undefined;
    const normalizedFullName = typeof payload.fullName === 'string' && payload.fullName.trim().length > 0 ? payload.fullName.trim() : undefined;
    const normalizedName = typeof payload.name === 'string' && payload.name.trim().length > 0 ? payload.name.trim() : undefined;

    const existing = this.pendingOnHandLocalApplies.get(productId);
    const attempts = existing ? existing.attempts : 0;
    this.pendingOnHandLocalApplies.set(productId, {
      onHand: normalizedOnHand ?? existing?.onHand,
      basePrice: normalizedBasePrice ?? existing?.basePrice,
      cost: normalizedCost ?? existing?.cost,
      code: normalizedCode ?? existing?.code,
      fullName: normalizedFullName ?? existing?.fullName,
      name: normalizedName ?? existing?.name,
      attempts
    });

    const tryApply = async () => {
      const state = this.pendingOnHandLocalApplies.get(productId);
      if (!state) return; // already applied/cleared
      if (state.attempts >= maxAttempts) {
        console.warn(`⚠️ Gave up applying queued update for product ${productId} after ${state.attempts} attempts`);
        this.pendingOnHandLocalApplies.delete(productId);
        return;
      }

      try {
        await this.ensureDBInitialized();
        const prod = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, productId);
        if (prod) {
          let updated = false;
          if (state.onHand !== undefined) {
            const beforeOnHand = prod.OnHand;
            prod.OnHand = state.onHand;
            console.log(`✅ Retried apply: Updated OnHand for product ${productId} in IndexedDB: ${beforeOnHand} -> ${state.onHand}`);
            updated = true;
          }
          if (state.basePrice !== undefined) {
            const beforeBase = prod.BasePrice;
            prod.BasePrice = state.basePrice;
            if (typeof (prod as any).FinalBasePrice === 'number') {
              (prod as any).FinalBasePrice = state.basePrice;
            }
            console.log(`✅ Retried apply: Updated BasePrice for product ${productId} in IndexedDB: ${beforeBase} -> ${state.basePrice}`);
            updated = true;
          }
          if (state.cost !== undefined) {
            const beforeCost = (prod as any).Cost;
            (prod as any).Cost = state.cost;
            console.log(`✅ Retried apply: Updated Cost for product ${productId} in IndexedDB: ${beforeCost} -> ${state.cost}`);
            updated = true;
          }
          if (state.code !== undefined) {
            const beforeCode = (prod as any).Code;
            (prod as any).Code = state.code;
            console.log(`✅ Retried apply: Updated Code for product ${productId} in IndexedDB: ${beforeCode} -> ${state.code}`);
            updated = true;
          }
          if (state.fullName !== undefined) {
            const beforeFullName = (prod as any).FullName;
            (prod as any).FullName = state.fullName;
            console.log(`✅ Retried apply: Updated FullName for product ${productId} in IndexedDB: ${beforeFullName} -> ${state.fullName}`);
            updated = true;
          }
          if (state.name !== undefined) {
            const beforeName = (prod as any).Name;
            (prod as any).Name = state.name;
            console.log(`✅ Retried apply: Updated Name for product ${productId} in IndexedDB: ${beforeName} -> ${state.name}`);
            updated = true;
          }
          if (updated) {
            await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, prod);
          }
          this.pendingOnHandLocalApplies.delete(productId);
          return;
        }

        // Not found yet — increment attempts and schedule next try
        this.pendingOnHandLocalApplies.set(productId, {
          onHand: state.onHand,
          basePrice: state.basePrice,
          cost: state.cost,
          code: state.code,
          fullName: state.fullName,
          name: state.name,
          attempts: state.attempts + 1
        });
        setTimeout(tryApply, delayMs);
      } catch (err) {
        console.warn(`⚠️ Retry apply failed for product ${productId} (attempt ${state.attempts + 1}):`, err);
        this.pendingOnHandLocalApplies.set(productId, {
          onHand: state.onHand,
          basePrice: state.basePrice,
          cost: state.cost,
          code: state.code,
          fullName: state.fullName,
          name: state.name,
          attempts: state.attempts + 1
        });
        setTimeout(tryApply, delayMs);
      }
    };

    // Kick off the first attempt with a short delay to allow concurrent writes to complete
    setTimeout(tryApply, delayMs);
  }

  // Helper: update single product OnHand locally and emit
  public async updateSingleProductOnHandLocal(productId: number | string, onHand: number): Promise<void> {
    try {
      await this.ensureDBInitialized();
      const id = Number(productId);
      const product = await this.indexedDBService.getByKey<Product>(this.dbName, this.dbVersion, this.storeName, id);
      if (product) {
        product.OnHand = onHand;
        await this.indexedDBService.put<Product>(this.dbName, this.dbVersion, this.storeName, product);
        this.productOnHandUpdatedSubject.next({ productId: id, onHand });
        console.log(`✅ updateSingleProductOnHandLocal: updated ${id} -> ${onHand}`);
      } else {
        console.warn(`⚠️ updateSingleProductOnHandLocal: product ${id} not found`);
      }
    } catch (err) {
      console.error('❌ updateSingleProductOnHandLocal error:', err);
    }
  }

  // Public method to initialize realtime sync (previously WebSocket, now Firestore onSnapshot)
  public async initializeProductWebSocket(): Promise<void> {
    console.log('🔄 [ProductService] Initializing WebSocket realtime listener (Hybrid solution)...');

    // ✅ Use WebSocket instead of Firestore onSnapshot to save Firestore reads
    // Connect to WebSocket server
    this.webSocketRealtimeService.connect();

    // Subscribe to product updates from WebSocket
    this.wsSubscription = this.webSocketRealtimeService.getProductUpdates$().subscribe(
      async (updates: ProductWebSocketUpdate[]) => {
        console.log(`📡 [ProductService] Received ${updates.length} updates via WebSocket`);
        await this.handleWebSocketRealtimeUpdates(updates);
      }
    );

    // Subscribe to newly added products (clone products, new products)
    this.webSocketRealtimeService.getProductsAdded$().subscribe(
      async (newProducts: ProductWebSocketUpdate[]) => {
        console.log(`🆕 [ProductService] Received ${newProducts.length} NEW products via WebSocket`);
        await this.handleProductsAdded(newProducts);
      }
    );

    // Log connection status changes
    this.webSocketRealtimeService.getConnectionStatus$().subscribe(status => {
      console.log(`🔌 [ProductService] WebSocket status: ${status}`);

      if (status === 'connected') {
        // Perform Initial Sync to catch up on missed updates
        this.performInitialSyncOnConnect();
      }
    });

    console.log('✅ [ProductService] WebSocket realtime listener initialized');

    // ❌ DISABLED: Firestore onSnapshot listener - causes excessive reads (~700K/day)
    // WebSocket is sufficient for realtime sync. Re-enable only if WebSocket fails.
    // See: https://console.firebase.google.com - Query "COLLECTION /products" was consuming 703K reads/day
    //
    // this.firestoreRealtimeService.startListening(async (updates: FirestoreProductUpdate[]) => {
    //   console.log(`📡 [ProductService] Received ${updates.length} updates via Firestore Realtime`);
    //   await this.handleFirestoreRealtimeUpdates(updates);
    // });
    // console.log('✅ [ProductService] Firestore realtime listener initialized as fallback');

    console.log('ℹ️ [ProductService] Firestore onSnapshot DISABLED to save reads. Using WebSocket only.');
  }

  /**
   * Perform Initial Sync when WebSocket connects
   * Fetches products modified since last sync to catch up on missed updates
   */
  private async performInitialSyncOnConnect(): Promise<void> {
    const lastSync = this.getLastSyncTime();

    if (!lastSync) {
      console.log('ℹ️ [ProductService] No lastSyncTime, skipping Initial Sync (will use full data from IndexedDB)');
      return;
    }

    console.log(`🔄 [ProductService] Performing Initial Sync (since ${lastSync})...`);

    try {
      const result = await this.getProductsModifiedSince(lastSync);

      if (result.products.length > 0) {
        console.log(`📦 [ProductService] Initial Sync: Found ${result.count} products modified since ${lastSync}`);
        // Cast to ProductWebSocketUpdate[] - the structure is compatible
        await this.handleWebSocketRealtimeUpdates(result.products as unknown as ProductWebSocketUpdate[]);
      } else {
        console.log('✅ [ProductService] Initial Sync: No missed updates');
      }

      // Update lastSyncTime
      this.saveLastSyncTime(result.fetched_at);

    } catch (error) {
      console.error('❌ [ProductService] Initial Sync failed:', error);
    }
  }

  /**
   * Handle product updates from WebSocket
   * Similar to handleFirestoreRealtimeUpdates but for WebSocket data format
   */
  private async handleWebSocketRealtimeUpdates(updates: ProductWebSocketUpdate[]): Promise<void> {
    if (!updates || updates.length === 0) {
      return;
    }

    console.log(`📥 [ProductService] Processing ${updates.length} realtime updates from WebSocket`);

    let hasAnyChanges = false;

    for (const update of updates) {
      try {
        const productId = Number(update.Id);
        if (!productId || isNaN(productId)) {
          continue;
        }

        // Get existing product from IndexedDB
        const existingProduct = await this.indexedDBService.getByKey<Product>(
          this.dbName,
          this.dbVersion,
          this.storeName,
          productId
        );

        if (!existingProduct) {
          console.log(`⏳ [ProductService] Product ${productId} not in IndexedDB, queuing for later sync`);
          this.pendingOnHandLocalApplies.set(productId, {
            onHand: update.OnHand,
            basePrice: update.BasePrice,
            cost: update.Cost,
            attempts: 0
          });
          continue;
        }

        // Check for actual changes
        let hasChanges = false;
        const fieldsToCheck = ['OnHand', 'OnHandNV', 'BasePrice', 'Cost', 'Name', 'Code', 'FullName', 'Description'];

        for (const field of fieldsToCheck) {
          if (update[field] !== undefined && update[field] !== (existingProduct as any)[field]) {
            hasChanges = true;
            break;
          }
        }

        if (hasChanges) {
          // Merge fields from WebSocket update - ONLY if value is not null/undefined
          // This prevents overwriting existing values with null
          const updatedProduct: Product = { ...existingProduct };

          // Safely merge each field from update
          for (const [key, value] of Object.entries(update)) {
            if (value !== null && value !== undefined) {
              (updatedProduct as any)[key] = value;
            }
          }

          // Ensure Id is always set
          updatedProduct.Id = productId;

          // Log important changes
          if (update.OnHand !== undefined && update.OnHand !== existingProduct.OnHand) {
            console.log(`   📦 Product ${productId}: OnHand ${existingProduct.OnHand} → ${update.OnHand}`);
          }
          if (update.OnHandNV !== undefined && update.OnHandNV !== existingProduct.OnHandNV) {
            console.log(`   📦 Product ${productId}: OnHandNV ${existingProduct.OnHandNV} → ${update.OnHandNV}`);
          }
          if (update.Code !== undefined && update.Code !== existingProduct.Code) {
            console.log(`   🏷️ Product ${productId}: Code "${existingProduct.Code}" → "${update.Code}"`);
          }
          if (update.Name !== undefined && update.Name !== existingProduct.Name) {
            console.log(`   📝 Product ${productId}: Name "${existingProduct.Name}" → "${update.Name}"`);
          }
          if (update.BasePrice !== undefined && update.BasePrice !== existingProduct.BasePrice) {
            console.log(`   💰 Product ${productId}: BasePrice ${existingProduct.BasePrice} → ${update.BasePrice}`);
          }
          if (update.Cost !== undefined && update.Cost !== existingProduct.Cost) {
            console.log(`   💵 Product ${productId}: Cost ${existingProduct.Cost} → ${update.Cost}`);
          }

          // Update IndexedDB
          await this.indexedDBService.put<Product>(
            this.dbName,
            this.dbVersion,
            this.storeName,
            updatedProduct
          );

          hasAnyChanges = true;

          // Emit event for UI - include all changed fields
          this.productOnHandUpdatedSubject.next({
            productId,
            onHand: update.OnHand,
            onHandNV: update.OnHandNV,
            basePrice: update.BasePrice,
            cost: update.Cost,
            code: update.Code,
            name: update.Name,
            fullName: update.FullName
          });

        }

      } catch (error) {
        console.error(`❌ [ProductService] Error processing WebSocket update for product ${update.Id}:`, error);
      }
    }

    // Invalidate cache after changes
    if (hasAnyChanges) {
      this.invalidateIndexedDbCache();
      console.log(`🗑️ [ProductService] Cache invalidated after WebSocket updates`);
    }

    console.log(`✅ [ProductService] Finished processing WebSocket updates`);
  }

  /**
   * Handle newly added products from WebSocket (clone products, new products)
   * Adds products to IndexedDB if they don't exist
   */
  private async handleProductsAdded(newProducts: ProductWebSocketUpdate[]): Promise<void> {
    if (!newProducts || newProducts.length === 0) {
      return;
    }

    // DEBUG: Log để trace nguồn gốc products_added event
    console.log(`🆕 [ProductService] Processing ${newProducts.length} NEW products from WebSocket`);
    console.log(`🔍 [ProductService] Products to add:`, newProducts.map(p => ({
      Id: p.Id,
      Code: p.Code,
      Name: p.Name,
      isClone: p['isClone']
    })));
    console.trace('📍 [ProductService] handleProductsAdded called from:');

    let addedCount = 0;
    let skippedCount = 0;

    for (const newProduct of newProducts) {
      try {
        const productId = Number(newProduct.Id);
        if (!productId || isNaN(productId)) {
          console.warn(`⚠️ [ProductService] Invalid product ID:`, newProduct.Id);
          continue;
        }

        // Check if product already exists in IndexedDB
        const existingProduct = await this.indexedDBService.getByKey<Product>(
          this.dbName,
          this.dbVersion,
          this.storeName,
          productId
        );

        if (existingProduct) {
          // Product already exists, skip
          console.log(`⏭️ [ProductService] Product ${productId} already exists, skipping`);
          skippedCount++;
          continue;
        }

        // Add new product to IndexedDB
        const productToAdd: Product = {
          Id: productId,
          Code: newProduct.Code || '',
          Name: newProduct.Name || '',
          FullName: newProduct.FullName || newProduct.Name || '',
          ProductName: newProduct.ProductName,
          CategoryId: newProduct['CategoryId'] || null,
          isActive: newProduct['isActive'] !== false,
          isDeleted: newProduct['isDeleted'] === true,
          isClone: newProduct['isClone'] === true,
          Cost: newProduct.Cost || 0,
          BasePrice: newProduct.BasePrice || 0,
          OnHand: newProduct.OnHand || 0,
          OnHandNV: newProduct.OnHandNV || 0,
          Unit: newProduct['Unit'] || '',
          MasterUnitId: newProduct['MasterUnitId'] || null,
          MasterProductId: newProduct['MasterProductId'] || null,
          ConversionValue: newProduct['ConversionValue'] || 1,
          Description: newProduct.Description || '',
          IsRewardPoint: newProduct['IsRewardPoint'] || false,
          ModifiedDate: newProduct.ModifiedDate || new Date().toISOString(),
          Image: newProduct['Image'] || null,
          CreatedDate: newProduct['CreatedDate'] || new Date().toISOString(),
          ProductAttributes: newProduct['ProductAttributes'] || [],
          NormalizedName: newProduct.NormalizedName || '',
          NormalizedCode: newProduct.NormalizedCode || '',
          OrderTemplate: newProduct['OrderTemplate'] || '',
          TradeMarkId: newProduct['TradeMarkId'] || null,
          TradeMarkName: newProduct['TradeMarkName'] || null,
          CloneSourceId: newProduct['CloneSourceId'] || undefined,
          CloneMasterSourceId: newProduct['CloneMasterSourceId'] || undefined,
          // ✅ FIX: Include KiotVietSync for local products (created from dialog)
          KiotVietSync: newProduct['KiotVietSync'],
          OriginalCode: newProduct['OriginalCode'] || undefined,
          ParentCode: newProduct['ParentCode'] || undefined,
        } as Product;

        await this.indexedDBService.put(
          this.dbName,
          this.dbVersion,
          this.storeName,
          productToAdd
        );

        console.log(`✅ [ProductService] Added new product ${productId}: ${productToAdd.Name} (isClone: ${productToAdd.isClone})`);
        addedCount++;

        // Emit event so UI can update
        this.productOnHandUpdatedSubject.next({
          productId: productId,
          onHand: productToAdd.OnHand,
          onHandNV: productToAdd.OnHandNV,
          basePrice: productToAdd.BasePrice,
          cost: productToAdd.Cost
        });

      } catch (error) {
        console.error(`❌ [ProductService] Error adding product ${newProduct.Id}:`, error);
      }
    }

    // Invalidate cache if any products were added
    if (addedCount > 0) {
      this.invalidateIndexedDbCache();
      console.log(`🗑️ [ProductService] Cache invalidated after adding ${addedCount} new products`);
    }

    console.log(`✅ [ProductService] Finished processing NEW products: ${addedCount} added, ${skippedCount} skipped`);
  }

  /**
   * Xử lý updates từ Firestore realtime listener
   * Cập nhật IndexedDB và emit events cho UI
   * ✅ FIXED: Merge TẤT CẢ fields từ Firestore, không chỉ OnHand/OnHandNV/BasePrice/Cost
   */
  private async handleFirestoreRealtimeUpdates(updates: FirestoreProductUpdate[]): Promise<void> {
    if (!updates || updates.length === 0) {
      return;
    }

    console.log(`📥 [ProductService] Processing ${updates.length} realtime updates from Firestore`);

    let hasAnyChanges = false;

    for (const update of updates) {
      try {
        const productId = Number(update.id);
        if (!productId || isNaN(productId)) {
          continue;
        }

        // Lấy product hiện tại từ IndexedDB
        const existingProduct = await this.indexedDBService.getByKey<Product>(
          this.dbName,
          this.dbVersion,
          this.storeName,
          productId
        );

        if (!existingProduct) {
          // Product không tồn tại trong IndexedDB, có thể là product mới
          // Thêm vào pending queue để retry sau
          console.log(`⏳ [ProductService] Product ${productId} not in IndexedDB, queuing for later sync`);
          this.pendingOnHandLocalApplies.set(productId, {
            onHand: update.OnHand,
            basePrice: update.BasePrice,
            cost: update.Cost,
            attempts: 0
          });
          continue;
        }

        // ✅ FIXED: Merge TẤT CẢ fields từ Firestore update vào existing product
        // Loại bỏ 'id' field vì nó là document ID, không phải product field
        const { id, ...updateFields } = update;

        // Kiểm tra xem có thay đổi thực sự không bằng cách so sánh các fields quan trọng
        let hasChanges = false;
        const fieldsToCheck = ['OnHand', 'OnHandNV', 'BasePrice', 'Cost', 'Name', 'Code', 'Description', 'Image', 'CategoryId', 'TradeMarkId', 'TradeMarkName', 'Tax', 'Unit'];

        for (const field of fieldsToCheck) {
          if (updateFields[field] !== undefined && updateFields[field] !== (existingProduct as any)[field]) {
            hasChanges = true;
            console.log(`   🔄 Product ${productId}: ${field} changed`);
            break;
          }
        }

        // Nếu không phát hiện thay đổi qua check nhanh, vẫn merge để đảm bảo consistency
        // (có thể có fields khác thay đổi mà chưa check)
        if (!hasChanges) {
          // Double check với JSON stringify cho các fields phức tạp
          const oldJson = JSON.stringify({
            OnHand: existingProduct.OnHand,
            OnHandNV: existingProduct.OnHandNV,
            BasePrice: existingProduct.BasePrice,
            Cost: existingProduct.Cost
          });
          const newJson = JSON.stringify({
            OnHand: updateFields.OnHand,
            OnHandNV: updateFields.OnHandNV,
            BasePrice: updateFields.BasePrice,
            Cost: updateFields.Cost
          });
          hasChanges = oldJson !== newJson;
        }

        if (hasChanges) {
          // ✅ Merge all fields từ Firestore vào existing product
          const updatedProduct: Product = {
            ...existingProduct,
            ...updateFields,
            Id: productId // Ensure Id is preserved as number
          };

          // Log chi tiết thay đổi quan trọng
          if (updateFields.OnHand !== undefined && updateFields.OnHand !== existingProduct.OnHand) {
            console.log(`   📦 Product ${productId}: OnHand ${existingProduct.OnHand} → ${updateFields.OnHand}`);
          }
          if (updateFields.OnHandNV !== undefined && updateFields.OnHandNV !== existingProduct.OnHandNV) {
            console.log(`   📦 Product ${productId}: OnHandNV ${existingProduct.OnHandNV} → ${updateFields.OnHandNV}`);
          }
          if (updateFields.BasePrice !== undefined && updateFields.BasePrice !== existingProduct.BasePrice) {
            console.log(`   💰 Product ${productId}: BasePrice ${existingProduct.BasePrice} → ${updateFields.BasePrice}`);
          }
          if (updateFields.Cost !== undefined && updateFields.Cost !== existingProduct.Cost) {
            console.log(`   💵 Product ${productId}: Cost ${existingProduct.Cost} → ${updateFields.Cost}`);
          }

          // Cập nhật IndexedDB
          await this.indexedDBService.put<Product>(
            this.dbName,
            this.dbVersion,
            this.storeName,
            updatedProduct
          );

          hasAnyChanges = true;

          // Emit event cho UI
          this.productOnHandUpdatedSubject.next({
            productId,
            onHand: updateFields.OnHand,
            onHandNV: updateFields.OnHandNV,
            basePrice: updateFields.BasePrice,
            cost: updateFields.Cost
          });

        }

      } catch (error) {
        console.error(`❌ [ProductService] Error processing update for product ${update.id}:`, error);
      }
    }

    // ✅ FIXED: Invalidate cache sau khi có changes để đảm bảo data fresh
    if (hasAnyChanges) {
      this.invalidateIndexedDbCache();
      console.log(`🗑️ [ProductService] Cache invalidated after realtime updates`);
    }

    console.log(`✅ [ProductService] Finished processing realtime updates`);
  }

  // Notify server about an OnHand change so server can emit to other connected clients
  // Payload: { productId, onHand, basePrice? }
  public async notifyServerProductOnHandChange(productId: number, onHand: number, basePrice?: number): Promise<void> {
    const pid = Number(productId);
    const oh = Number(onHand);
    const bp = basePrice !== undefined ? Number(basePrice) : undefined;
    const payload: any = { productId: pid, onHand: oh };
    if (bp !== undefined && Number.isFinite(bp)) {
      payload.basePrice = bp;
    }
    // Prefer emitting over socket when connected
    try {
      console.log('📡 notifyServerProductOnHandChange (HTTP)', payload);
      await this.http.put(`${environment.domainUrl}/api/firebase/update/products`, payload).toPromise();
    } catch (httpErr) {
      console.warn('⚠️ HTTP notify failed, enqueueing notification for later flush', httpErr);
      this.enqueuePendingOnHandNotification(pid, oh, bp);
    }
  }

  // Emit a single batched products change over socket only (no HTTP fallback)
  // This is used to avoid duplicate HTTP PUTs when we've already updated via REST.
  // Payload: [{ Id, OnHand?, BasePrice?, Cost?, Code?, FullName?, Name? }, ...]
  public emitProductsOnHandChangeViaSocket(products: Array<{
    Id: number;
    OnHand?: number;
    BasePrice?: number;
    Cost?: number;
    Code?: string;
    FullName?: string;
    Name?: string;
  }>): void {
    // WebSocket support removed on backend — do not emit updates from client.
    // Prefer calling REST update endpoints (e.g. `updateProductOnHandToFireStore`) and
    // then use `fetchProductsByIds` / `fetchLatestProducts` to refresh local data.
    console.warn('emitProductsOnHandChangeViaSocket called, but websockets are removed. Skipping emit. Use REST update + fetch instead.');
  }

  private enqueuePendingOnHandNotification(productId: number, onHand?: number, basePrice?: number) {
    const entry = {
      productId,
      onHand,
      basePrice,
      timestamp: Date.now()
    };
    this.pendingOnHandNotifications.push(entry);
    console.log('🗳️ Enqueued OnHand notification', entry, 'queueLength=', this.pendingOnHandNotifications.length);
    // Keep queue bounded to a sensible size (e.g., 500)
    if (this.pendingOnHandNotifications.length > 500) {
      this.pendingOnHandNotifications.shift();
    }
  }

  private async flushPendingOnHandNotifications(): Promise<void> {
    if (!this.pendingOnHandNotifications || this.pendingOnHandNotifications.length === 0) return;
    console.log('🔄 Flushing', this.pendingOnHandNotifications.length, 'pending OnHand notifications');
    const toFlush = this.pendingOnHandNotifications
      .filter(entry => entry.onHand !== undefined || entry.basePrice !== undefined)
      .map(entry => ({ ...entry }));
    this.pendingOnHandNotifications = [];

    // Send per-item HTTP calls sequentially to avoid overloading the backend
    for (const entry of toFlush) {
      try {
        const payload: any = { productId: entry.productId };
        if (entry.onHand !== undefined) {
          payload.onHand = entry.onHand;
        }
        if (entry.basePrice !== undefined) {
          payload.basePrice = entry.basePrice;
        }
        await this.http.put(`${environment.domainUrl}/api/firebase/update/products`, payload).toPromise();
      } catch (err) {
        console.warn('⚠️ flushPendingOnHandNotifications: HTTP notify failed for', entry, err);
        // re-enqueue failed ones at front
        this.pendingOnHandNotifications.unshift(entry);
        // stop further attempts for now
        break;
      }
    }
  }
  /**
   * ✅ NEW: Lấy TẤT CẢ products từ Firebase KHÔNG dùng cache
   * Sử dụng endpoint /api/firebase/products/fetch với { all: true }
   */
  getAllProductsFromFirebaseFresh(options?: {
    includeInactive?: boolean;
    includeDeleted?: boolean;
  }): Observable<Product[]> {
    console.log('🔄 Gọi API Firebase FRESH (không cache) - /api/firebase/products/fetch');

    const payload = {
      all: true,
      include_inactive: options?.includeInactive ?? false,
      include_deleted: options?.includeDeleted ?? false
    };

    return this.http.post<Product[]>(
      `${environment.domainUrl}/api/firebase/products/fetch`,
      payload
    ).pipe(
      map(products => {
        const result = Array.isArray(products) ? products : [];
        console.log(`📦 Nhận được ${result.length} products từ Firebase (fresh)`);

        // Update local cache
        this.firebaseProductsCache = result;
        this.cacheTimestamp = Date.now();

        return result;
      }),
      catchError((err) => {
        console.error('❌ Lỗi khi lấy products từ Firebase (fresh):', err);
        return of([]);
      })
    );
  }
  async addProduct(product: Product): Promise<any> {
    const url = `${environment.domainUrl}/api/firebase/add/product`;
    return firstValueFrom(this.http.post(url, product));
  }

  /**
   * Add multiple products to Firebase (batch)
   */
  async addProducts(products: Product[]): Promise<any> {
    const url = `${environment.domainUrl}/api/firebase/add/products/batch`;
    return firstValueFrom(this.http.post(url, { products }));
  }

  /**
   * Get all products from Firebase
   */
  async getProducts(options?: {
    includeInactive?: boolean;
    includeDeleted?: boolean
  }): Promise<Product[]> {
    const params = new URLSearchParams();
    if (options?.includeInactive) {
      params.append('include_inactive', 'true');
    }
    if (options?.includeDeleted) {
      params.append('include_deleted', 'true');
    }

    const url = `${environment.domainUrl}/api/firebase/get/products? ${params.toString()}`;
    return firstValueFrom(this.http.get<Product[]>(url));
  }

  /**
   * Update products
   */
  async updateProducts(products: Partial<Product>[]): Promise<any> {
    const url = `${environment.domainUrl}/api/firebase/update/products`;
    return firstValueFrom(this.http.put(url, products));
  }

  /**
   * Delete a product
   */
  async deleteProduct(productId: string | number): Promise<any> {
    const url = `${environment.domainUrl}/api/firebase/products/del/${productId}`;
    return firstValueFrom(this.http.delete(url));
  }

  /**
   * Delete a product AND all its siblings (products with the same MasterUnitId).
   * Use this for clone products to ensure ALL related units are deleted together.
   *
   * @param productId - The product ID (can be master or any child)
   * @returns Promise with deleted product IDs
   */
  async deleteProductWithSiblings(productId: string | number): Promise<{
    status: string;
    message: string;
    deleted_ids: string[];
  }> {
    const url = `${environment.domainUrl}/api/firebase/products/del-with-siblings/${productId}`;
    return firstValueFrom(this.http.delete<{
      status: string;
      message: string;
      deleted_ids: string[];
    }>(url));
  }
  async checkCloneProductsExist(ids: number[]): Promise<number[]> {
    if (!ids || ids.length === 0) return [];
    const url = `${environment.domainUrl}/api/firebase/products/batch-exists`;
    const response = await firstValueFrom(
      this.http.post<{ existing_ids: string[] }>(url, { ids: ids.map(String) })
    );
    return (response.existing_ids || []).map(Number);
  }

  async addProductToIndexedDB(product: Product): Promise<void> {
    await this.ensureDBInitialized();
    const sanitized = this.sanitizeProductForStorage({ ...product });
    await this.indexedDBService.put(this.dbName, this.dbVersion, this.storeName, sanitized);
    this.invalidateIndexedDbCache();
  }

  // ========================================
  // INCREMENTAL SYNC - Optimized Firestore reads
  // ========================================

  private readonly LAST_SYNC_TIME_KEY = 'productLastSyncTime';

  /**
   * Get products modified since a given timestamp.
   * Optimized endpoint to reduce Firestore reads.
   *
   * @param sinceTimestamp ISO 8601 timestamp string
   * @returns Promise with products and metadata
   */
  async getProductsModifiedSince(sinceTimestamp: string): Promise<{
    products: Product[];
    count: number;
    since: string;
    fetched_at: string;
  }> {
    console.log(`🔄 Fetching products modified since ${sinceTimestamp}...`);

    const url = `${environment.domainUrl}/api/firebase/products/modified-since`;
    const payload = {
      since: sinceTimestamp,
      include_inactive: true,
      include_deleted: false
    };

    try {
      const result = await firstValueFrom(
        this.http.post<{
          products: Product[];
          count: number;
          since: string;
          fetched_at: string;
        }>(url, payload)
      );

      console.log(`✅ Found ${result.count} products modified since ${sinceTimestamp}`);
      return result;
    } catch (error) {
      console.error('❌ Error fetching products modified since:', error);
      throw error;
    }
  }

  /**
   * Get the last sync timestamp from localStorage.
   * Returns null if never synced before.
   */
  getLastSyncTime(): string | null {
    return localStorage.getItem(this.LAST_SYNC_TIME_KEY);
  }

  /**
   * Save the current sync timestamp to localStorage.
   */
  saveLastSyncTime(timestamp?: string): void {
    const ts = timestamp || new Date().toISOString();
    localStorage.setItem(this.LAST_SYNC_TIME_KEY, ts);
    console.log(`💾 Saved lastSyncTime: ${ts}`);
  }

  /**
   * Clear the last sync timestamp (forces full sync on next reload).
   */
  clearLastSyncTime(): void {
    localStorage.removeItem(this.LAST_SYNC_TIME_KEY);
    console.log('🗑️ Cleared lastSyncTime');
  }

  /**
   * Perform an incremental sync - only fetch products modified since last sync.
   * Falls back to full sync if no previous sync time exists.
   *
   * @param forceFullSync If true, ignores lastSyncTime and does full sync
   * @returns Object with sync results
   */
  async incrementalSyncFromFirebase(forceFullSync: boolean = false): Promise<{
    mode: 'full' | 'incremental';
    fetchedCount: number;
    updatedCount: number;
    products: Product[];
  }> {
    const lastSync = forceFullSync ? null : this.getLastSyncTime();

    if (!lastSync) {
      // No previous sync - need full sync
      console.log('📦 No previous sync found, performing FULL sync...');
      const products = await firstValueFrom(
        this.getAllProductsFromFirebaseFresh({ includeInactive: true, includeDeleted: false })
      );

      // ✅ FIX: Lưu TẤT CẢ products vào IndexedDB khi full sync
      if (products.length > 0) {
        console.log(`💾 Saving ${products.length} products to IndexedDB...`);
        await this.syncProductsFromFirebaseToIndexedDB(products);
        this.invalidateIndexedDbCache();
        console.log(`✅ Saved ${products.length} products to IndexedDB`);
      }

      this.saveLastSyncTime();

      return {
        mode: 'full',
        fetchedCount: products.length,
        updatedCount: products.length,
        products
      };
    }

    // Incremental sync
    console.log(`🔄 Performing INCREMENTAL sync (since ${lastSync})...`);

    try {
      const result = await this.getProductsModifiedSince(lastSync);

      // Update IndexedDB with changed products
      if (result.products.length > 0) {
        for (const product of result.products) {
          await this.updateProductFromIndexedDB(product);
        }
        this.invalidateIndexedDbCache();
        console.log(`✅ Updated ${result.products.length} products in IndexedDB`);
      }

      // Save new sync time
      this.saveLastSyncTime(result.fetched_at);

      return {
        mode: 'incremental',
        fetchedCount: result.count,
        updatedCount: result.products.length,
        products: result.products
      };
    } catch (error) {
      console.error('❌ Incremental sync failed, falling back to full sync:', error);

      // Fallback to full sync
      const products = await firstValueFrom(
        this.getAllProductsFromFirebaseFresh({ includeInactive: true, includeDeleted: false })
      );

      // ✅ FIX: Lưu TẤT CẢ products vào IndexedDB khi fallback full sync
      if (products.length > 0) {
        console.log(`💾 Saving ${products.length} products to IndexedDB (fallback)...`);
        await this.syncProductsFromFirebaseToIndexedDB(products);
        this.invalidateIndexedDbCache();
        console.log(`✅ Saved ${products.length} products to IndexedDB`);
      }

      this.saveLastSyncTime();

      return {
        mode: 'full',
        fetchedCount: products.length,
        updatedCount: products.length,
        products
      };
    }
  }

  // WebSocket control methods removed — client no longer manages a socket connection.
  // If you were calling `disconnectProductSocket()` or checking socket status, prefer
  // to stop relying on socket state; use `fetchProductsByIds` / `fetchLatestProducts` instead.

  /**
   * Sync single product from KiotViet to Firebase and IndexedDB
   * Syncs master product and all child units
   * @param productId - Product code to sync
   * @returns Sync result with updated products
   */
  async syncSingleProductFromKiotViet(productId: number, productCode: string): Promise<{
    success: boolean;
    syncedCount: number;
    products: Product[];
    message: string;
  }> {
    try {
      console.log(`🔄 Syncing single product from KiotViet: ${productCode} (Id: ${productId})`);

      // Step 1: Get product from KiotViet API using ProductKey (code search)
      // This returns UnitList with all unit variant names
      const kvProducts = await this.kiotvietService.getSingleProductFromKiotViet(productCode);

      if (!kvProducts || kvProducts.length === 0) {
        return {
          success: false,
          syncedCount: 0,
          products: [],
          message: `Không tìm thấy sản phẩm với mã: ${productCode}`
        };
      }

      // Step 2: IdsProduct returns only the queried product (master).
      // Use UnitList from the response to build a map of child ProductId → UnitName
      const relatedProducts = kvProducts;
      const targetProduct = relatedProducts.find(p => p.Id === productId) || relatedProducts[0];
      const masterProductId = targetProduct?.MasterProductId || targetProduct?.MasterUnitId || targetProduct?.Id || productId;

      // Build UnitList map: ProductId → UnitName (for updating child Unit names)
      const unitListMap = new Map<number, string>();
      if (targetProduct?.UnitList) {
        for (const unit of targetProduct.UnitList) {
          unitListMap.set(unit.ProductId, unit.UnitName);
        }
        console.log(`📋 UnitList: ${targetProduct.UnitList.map(u => `${u.UnitName}(${u.ProductId})`).join(', ')}`);
      }

      console.log(`🎯 Target product: ${targetProduct?.Code} (Id: ${targetProduct?.Id}), Master: ${masterProductId}`);

      // Step 3: Transform KiotViet products to our Product model
      const transformedProducts: Product[] = [];
      for (const kvProduct of relatedProducts) {
        const transformed = this.transformKiotVietToProduct(kvProduct);
        transformedProducts.push(transformed);
      }

      // Step 3b: Update Firebase
      console.log(`📤 Updating ${transformedProducts.length} products to Firebase...`);
      await this.updateProducts(transformedProducts);

      // Step 4: Update IndexedDB and collect merged results
      console.log(`💾 Updating ${transformedProducts.length} products in IndexedDB...`);
      const mergedResults: Product[] = [];
      for (const product of transformedProducts) {
        try {
          const existing = await this.getProductByIdFromIndexedDB(product.Id);
          if (existing) {
            // Merge: preserve OnHandNV for clone products, set to 0 for original products
            // Also preserve OrderTemplate - it's a Firebase-only field, not in KiotViet
            const merged: Product = {
              ...existing,
              ...product,
              // For clone products: preserve existing OnHandNV, for original products: always 0
              OnHandNV: (existing as any).isClone ? (existing.OnHandNV ?? 0) : 0,
              // Preserve OrderTemplate from IndexedDB (KiotViet doesn't have this field)
              OrderTemplate: existing.OrderTemplate || product.OrderTemplate || '',
              // Preserve MasterUnitId/MasterProductId nếu existing có mà product không có
              // (tránh trường hợp KiotViet masterproducts API clear MasterUnitId cho child units)
              MasterUnitId: product.MasterUnitId ?? existing.MasterUnitId ?? null,
              MasterProductId: product.MasterProductId ?? existing.MasterProductId ?? null
            };
            // Strip runtime-only _original* properties to prevent IndexedDB contamination
            delete (merged as any)._originalOnHand;
            delete (merged as any)._originalCost;
            delete (merged as any)._originalBasePrice;
            delete (merged as any)._derivedOriginalOnHand;
            await this.updateProductFromIndexedDB(merged);
            mergedResults.push(merged);
          } else {
            // New product - add to IndexedDB
            await this.addProductToIndexedDB(product);
            mergedResults.push(product);
          }
        } catch (dbError) {
          console.warn(`⚠️ Error updating product ${product.Id} in IndexedDB:`, dbError);
          mergedResults.push(product);
        }
      }

      // Step 4b: Update child products in IndexedDB
      // - Use UnitList to update Unit names
      // - Compute OnHand/Cost/BasePrice proportionally from master data
      const syncedMaster = mergedResults.find(p => p.Id === masterProductId);
      if (syncedMaster) {
        const masterConversion = syncedMaster.ConversionValue || 1;
        const allProducts = await this.getAllProductsFromIndexedDB();
        // Only get UNIT variant children (Code starts with masterCode + "-")
        const masterCode = syncedMaster.Code || '';
        const childProducts = allProducts.filter(p => {
          const isMasterChild = (p as any).MasterProductId === masterProductId ||
            (p as any).MasterUnitId === masterProductId;
          if (!isMasterChild || p.Id === masterProductId) return false;
          // Only unit variants (exclude attribute variants)
          return masterCode && p.Code && p.Code.startsWith(masterCode + '-');
        });
        const syncedIds = new Set(mergedResults.map(p => p.Id));

        for (const child of childProducts) {
          if (syncedIds.has(child.Id)) continue; // Already updated from API
          let changed = false;

          // Update Unit name from UnitList
          const newUnitName = unitListMap.get(child.Id);
          if (newUnitName && newUnitName !== child.Unit) {
            console.log(`📝 Updating Unit for ${child.Code}: "${child.Unit}" → "${newUnitName}"`);
            child.Unit = newUnitName;
            // Update FullName to reflect new unit, but keep NameOriginal/Name unchanged
            const baseName = ((child as any).NameOriginal || child.Name || '').replace(/\([^)]*\)\s*$/, '').trim();
            child.FullName = baseName + ` (${newUnitName})`;
            // Don't overwrite Name with unit suffix - Name should stay as NameOriginal
            changed = true;
          }

          // Compute values proportionally from master
          const childConversion = child.ConversionValue || 1;
          child.OnHand = (syncedMaster.OnHand * masterConversion) / childConversion || 0;
          const oldChildCost = child.Cost;
          const oldChildBasePrice = child.BasePrice;
          child.Cost = Math.round((syncedMaster.Cost / masterConversion) * childConversion) || 0;
          const costDiff = child.Cost - oldChildCost;
          if (costDiff !== 0) {
            child.BasePrice = Math.round((oldChildBasePrice + costDiff) / 100) * 100 || 0;
            changed = true;
          }

          await this.updateProductFromIndexedDB(child);
          mergedResults.push(child);
          console.log(`🔄 Updated child ${child.Code}: Unit=${child.Unit}, OnHand=${child.OnHand}, Cost=${child.Cost}, BasePrice=${child.BasePrice} (costDiff=${costDiff})`);
        }
      }

      // Step 4c: Sync OrderTemplate từ original sang clone products
      const allProductsForCloneSync = await this.getAllProductsFromIndexedDB();
      for (const mergedProduct of mergedResults) {
        if ((mergedProduct as any).isClone) continue;
        if (!mergedProduct.OrderTemplate) continue;

        const clones = allProductsForCloneSync.filter(p =>
          (p as any).isClone && String((p as any).CloneSourceId) === String(mergedProduct.Id)
        );

        for (const clone of clones) {
          if (clone.OrderTemplate !== mergedProduct.OrderTemplate) {
            console.log(`🔄 Sync OrderTemplate cho clone ${clone.Id} từ original ${mergedProduct.Id}: "${clone.OrderTemplate}" → "${mergedProduct.OrderTemplate}"`);
            clone.OrderTemplate = mergedProduct.OrderTemplate;
            await this.updateProductFromIndexedDB(clone);
          }
        }
      }

      // Step 5: Invalidate cache
      this.invalidateIndexedDbCache();

      console.log(`✅ Synced ${mergedResults.length} products successfully`);
      return {
        success: true,
        syncedCount: mergedResults.length,
        products: mergedResults,
        message: `Đã đồng bộ ${mergedResults.length} sản phẩm thành công`
      };

    } catch (error: any) {
      console.error('❌ Error syncing single product:', error);
      return {
        success: false,
        syncedCount: 0,
        products: [],
        message: `Lỗi đồng bộ: ${error.message || 'Unknown error'}`
      };
    }
  }

  /**
   * Transform KiotViet suggest product to our Product model
   */
  /**
   * Map KiotViet TaxIds → Tax value, mirror backend get_tax_value (product_class.py).
   * Id: 1→0, 2→5, 3→8, 4→10, 5→"KCT", 12→"KKKNT". Default 0.
   */
  private mapKiotVietTaxIdsToTax(taxIds: any): number | string {
    const TAX_MAPPING: Record<number, number | string> = { 1: 0, 2: 5, 3: 8, 4: 10, 5: 'KCT', 12: 'KKKNT' };
    let raw = taxIds;
    if (raw === null || raw === undefined || raw === '' || (Array.isArray(raw) && raw.length === 0)) return 0;
    if (Array.isArray(raw)) raw = raw[0];
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return 0;
    const id = Number(raw);
    if (!Number.isFinite(id)) return 0;
    return TAX_MAPPING[id] ?? 0;
  }

  private transformKiotVietToProduct(kvProduct: KiotVietSuggestProduct): Product {
    // Find master unit ID
    // Only use MasterUnitId (unit-conversion relationship), NOT MasterProductId (product-variant relationship)
    // MasterProductId links variants to base product in KiotViet, which is a different concept
    // Using MasterProductId as fallback breaks our grouping logic
    const masterUnitId = kvProduct.MasterUnitId || null;

    // Build FullName: prefer FullName from API (masterproducts returns it directly),
    // otherwise construct from ProductName/Name + AttributeLabel + Unit
    let fullName = kvProduct.FullName || '';
    if (!fullName) {
      // Fallback: build FullName from parts (for suggest API which doesn't have FullName)
      fullName = kvProduct.ProductName || kvProduct.Name || '';
      if (kvProduct.AttributeLabel) {
        fullName += ' ' + kvProduct.AttributeLabel;
      }
      if (kvProduct.Unit) {
        fullName += ' (' + kvProduct.Unit + ')';
      }
    }

    // Build ProductAttributes from AttributeLabel
    const productAttributes: any[] = [];
    if (kvProduct.AttributeLabel) {
      productAttributes.push({
        AttributeName: 'Màu/Loại',
        Value: kvProduct.AttributeLabel
      });
    }

    const now = new Date().toISOString();

    const baseName =
      (kvProduct.NameOriginal || kvProduct.Name || '').trim() ||
      fullName.replace(/\s*\([^)]*\)\s*$/, '').trim();

    // Map KiotViet TaxIds → Tax value (0/5/8/10/"KCT"/"KKKNT"), mirror backend get_tax_value
    const taxValue = this.mapKiotVietTaxIdsToTax((kvProduct as any).TaxIds);

    return {
      Id: kvProduct.Id,
      Code: kvProduct.Code,
      // Keep Name as base product name (without unit suffix), use FullName for display with unit.
      Name: baseName,
      // NameOriginal stores original product name without variant/unit suffix.
      NameOriginal: kvProduct.NameOriginal || baseName,
      FullName: fullName.trim(),
      Unit: kvProduct.Unit,
      BasePrice: kvProduct.BasePrice,
      Cost: kvProduct.Cost,
      OnHand: kvProduct.OnHand,
      OnHandNV: 0, // Original KiotViet products always have OnHandNV = 0 (only clone products have OnHandNV > 0)
      ConversionValue: kvProduct.ConversionValue,
      MasterUnitId: masterUnitId,
      MasterProductId: kvProduct.MasterProductId || null,
      CategoryId: kvProduct.CategoryId,
      Image: kvProduct.Image || null,
      Tax: taxValue,
      ProductAttributes: productAttributes,
      ModifiedDate: now,
      CreatedDate: now,
      // Required fields with defaults
      isActive: kvProduct.AllowsSale ?? true,
      isDeleted: false,
      Description: '',
      IsRewardPoint: false,
      // Index both base name and full name so search still matches either form.
      NormalizedName: this.vi.normalizeAndTokenize(`${baseName} ${fullName}`.trim()).join(' ').toLowerCase(),
      NormalizedCode: (kvProduct.Code || '').toLowerCase()
      // Note: OrderTemplate is NOT set here - it's a Firebase-only field
      // Setting it to '' would overwrite the real value when syncing to Firebase
    } as Product;
  }
}
