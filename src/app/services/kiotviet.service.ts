import { Injectable } from '@angular/core';
import { environment } from "../../environments/environment";
import { InvoiceTab } from '../models/invoice.model';
import { IndexedDBService } from './indexed-db.service'; // Thêm import này
import { CategoryService } from './category.service';
import { TokenExpiredService } from './token-expired.service';
import { AuthService } from './auth.service';
import { HttpClient } from '@angular/common/http';
import { catchError, Observable, of } from 'rxjs';

interface KiotVietAuthResponse {
  access_token: string;
  retailer: number;
  LatestBranchId: string;
}

// ========= Checkout Invoice Interfaces =========
interface KVSeller {
  CreatedBy: number;
  CreatedDate: string;
  Email: string;
  GivenName: string;
  Id: number;
  IsActive: boolean;
  IsAdmin: boolean;
  Language: string;
  MobilePhone: string;
  Type: number;
  UserName: string;
  isDeleted: boolean;
}

// Tax mapping: Tax value -> TaxId (from KiotViet GET /api/tax/getAll?type=1)
// 0%    -> TaxId: 1
// 5%    -> TaxId: 2
// 8%    -> TaxId: 3
// 10%   -> TaxId: 4
// KCT   -> TaxId: 5  (Không chịu thuế)
// KKKNT -> TaxId: 12 (Không kê khai nộp thuế)
const TAX_ID_MAP: Record<string | number, number> = {
  0: 1,
  5: 2,
  8: 3,
  10: 4,
  'KCT': 5,
  'KKKNT': 12
};

interface InvoiceDetailTax {
  TaxId: number;
  DetailTax: number | null;    // Số tiền thuế (null cho KCT/KKKNT)
  PriceAfterTax: number;       // Giá sau thuế
  ViewDiscountAfterTax: number;
  DiscountAfterTax: number;
  DiscountRatioAfterTax: number;
  DiscountByPromotionAfterTax: number;
  AllocationDiscountAfterTax: number;
}

interface DetailTaxId {
  CountryId: number;
  Id: number;      // TaxId
  Name: string;    // "0%", "5%", "8%", "10%", "KCT", "KKKNT"
  Type: number;
  Value?: number;  // 0, 5, 8, 10 (không có cho KCT/KKKNT)
}

interface InvoiceDetailItem {
  BasePrice: number;
  IsLotSerialControl: boolean;
  IsBatchExpireControl: boolean;
  IsRewardPoint: boolean;
  Note: string;
  Price: number;              // Giá chưa thuế (khi có VAT)
  PriceAfterTax?: number;     // Giá sau thuế
  ProductId: number;
  Quantity: number;
  ProductCode: string;
  Weight: number;
  Discount?: number;           // Per-unit discount trước thuế
  DiscountRatio?: number;      // % discount (cho Type 5)
  DiscountAfterTax?: number;
  ProductName: string;
  SalePromotionId?: number | null;           // KiotViet SalePromotion ID
  OriginPrice: number;
  PriceByPromotion?: number | null;          // Giá KM (null cho gift)
  PromotionParentProductId?: number | null;  // Trigger product KiotViet ID
  ProductFormulaHistoryId: number | null;
  ProductBatchExpireId: number | null;
  CategoryId: number | null;
  MasterProductId: number;
  Unit: string;
  Uuid: string;
  SupplyPromotionTypes?: string;
  Formulas: any | null;
  AllocationDiscount: number;
  InvoiceDetailTaxs: InvoiceDetailTax[];
  DetailTaxIds?: DetailTaxId[];
}

interface InvoicePromotion {
  Type: number;              // 5 (discount) or 6 (gift)
  TargetType: number;        // 1
  SalePromotionId: number;
  PromotionId: number;       // = kiotVietCampaignId
  ProductId: number;         // gift/discounted product KV Id
  RelatedProductId: number;  // trigger product KV Id
  RelatedProductQty: number;
  ProductQty: number;
  IsFixedQuantity: boolean;
  LimitPromotionUsage: boolean;
  LimitPromotionUsageType: number;
  PromotionInfo: string;
  PrintPromotionInfo: string;
  ProductIds: string;
  RelatedProductIds: string;
  RelatedCategoryIds: string;
  BackupSelectedSerials?: Record<string, unknown>;
  DiscountRatio?: number;        // for Type 5 percentage
  TargetProductId?: number;      // for Type 5
}

interface InvoicePayment {
  Method: string;
  MethodStr: string;
  Amount: number;
  Id: number;
  AccountId: number | null;
  UsePoint?: number | null;
}

interface CheckoutInvoicePayload {
  Invoice: {
    BranchId: number;
    RetailerId: number;
    UpdateInvoiceId: number;
    UpdateReturnId: number;
    SoldById: number;
    SoldBy: KVSeller;
    SaleChannelId: number;
    Seller: KVSeller;
    OrderCode: string;
    Code: string;
    DiscountAfterTax?: number;
    DiscountRatioAfterTax?: number;
    DiscountByPromotion: number;
    DiscountByPromotionAfterTax?: number;
    DiscountByPromotionValue: number;
    DiscountByPromotionRatio: number;
    DiscountByCouponAfterTax?: number;
    InvoiceDetails: InvoiceDetailItem[];
    InvoiceOrderSurcharges: any[];
    InvoicePromotions: any[];
    InvoiceSupplierPromotions: any[];
    UsingCod: number;
    Payments: InvoicePayment[];
    Status: number;
    Total: number;
    TotalTax: number | null;
    EnableVATToggle: boolean;
    RoundAmount: number | null;
    Surcharge: number;
    Type: number;
    Uuid: string;
    addToAccount: string;
    PayingAmount: number;
    TotalBeforeDiscount: number;
    ProductDiscount: number;
    DebugUuid: string;
    InvoiceWarranties: any[];
    IsUsingProductVAT: boolean;
    PricingMode?: number;  // 1 = Giá đã bao gồm thuế
    CreatedBy: number;
    Description?: string;
  };
}
@Injectable({
  providedIn: 'root'
})
export class KiotvietService {

  constructor(
    private indexedDBService: IndexedDBService,
    private categoryService: CategoryService,
    private http: HttpClient,
    private tokenExpiredService: TokenExpiredService,
    private authService: AuthService
  ) { }
  private readonly updateItemUrl = 'https://api-man1.kiotviet.vn/api';
  private readonly getUpdateItemUrl = 'https://api-man1.kiotviet.vn/api/products';
  private readonly trademarkUrl = 'https://api-man1.kiotviet.vn/api/trademark';
  private readonly checkOutURL = 'https://api-sale1.kiotviet.vn/api/invoices';

  private retailerId = 500111210;
  private retailer: any | null = null;// Replace with your retailer
  private LatestBranchId: any | null = null; // Replace with your branch ID
  private accessToken: string | null = null;

  kiotviet_items_api = "/api/kiotviet/items/all";
  kiotviet_customers_api = "/api/kiotviet/customers";

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // Fallback for non-secure contexts (HTTP)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  kiotviet_categories_api = "/api/kiotviet/categories";


  async getCategories(): Promise<any[]> {
    try {
      console.log('🔍 [getCategories] Bắt đầu kiểm tra cache...');

      // Kiểm tra xem có categories trong IndexedDB không
      const hasCategories = await this.categoryService.hasCategories();
      console.log(`🔍 [getCategories] hasCategories = ${hasCategories}`);

      if (hasCategories) {
        // Kiểm tra cache có còn hợp lệ không (theo TTL)
        const isCacheValid = await this.categoryService.isCacheValid();
        console.log(`🔍 [getCategories] isCacheValid = ${isCacheValid}`);

        if (isCacheValid) {
          // Cache còn hợp lệ, dùng luôn không cần fetch API
          console.log('📦 Lấy categories từ IndexedDB (cache còn hợp lệ) ✅');
          return await this.categoryService.getAllCategories();
        } else {
          // Cache hết hạn, fetch API và update cache
          console.log('🔄 Cache hết hạn, đang làm mới từ API...');
          const cachedCategories = await this.categoryService.getAllCategories();
          // Fetch API trong background để update cache
          this.fetchAndCacheCategories().catch(err =>
            console.warn('⚠️ Không thể cập nhật categories cache:', err)
          );
          // Trả về cache cũ ngay để không làm chậm UI
          return cachedCategories;
        }
      }

      // Nếu chưa có cache, fetch từ API
      console.log('🌐 Lấy categories từ API (lần đầu)');
      return await this.fetchAndCacheCategories();
    } catch (error) {
      console.error('❌ Error fetching categories:', error);
      // Fallback: thử lấy từ cache nếu API fail
      try {
        const cachedCategories = await this.categoryService.getAllCategories();
        if (cachedCategories.length > 0) {
          console.log('✅ Sử dụng categories từ cache (fallback)');
          return cachedCategories;
        }
      } catch (cacheError) {
        console.error('❌ Không thể lấy categories từ cache:', cacheError);
      }
      return [];
    }
  }

  /**
   * Fetch categories từ API và lưu vào IndexedDB
   */
  private async fetchAndCacheCategories(): Promise<any[]> {
    try {
      const result = await this.http.get<any[]>(
        `${environment.domainUrl}${this.kiotviet_categories_api}`
      ).toPromise();

      const categories = result || [];

      if (categories.length > 0) {
        // Lưu vào IndexedDB
        await this.categoryService.saveCategories(categories);
        console.log(`✅ Đã lưu ${categories.length} categories vào IndexedDB`);
      }

      return categories;
    } catch (error) {
      console.error('❌ Error fetching and caching categories:', error);
      throw error;
    }
  }

  /**
   * Force refresh categories từ API và cập nhật cache
   */
  async refreshCategories(): Promise<any[]> {
    console.log('🔄 Làm mới categories từ API...');
    return await this.fetchAndCacheCategories();
  }

  // ========= Auth helpers & unified retry-on-401/403 =========
  /**
   * Nạp credentials vào bộ nhớ nếu chưa có.
   * BẮT BUỘC gọi trước khi đọc this.LatestBranchId để build payload/body:
   * performKiotVietFetchWithRetry chỉ nạp credentials lúc gửi request, tức là SAU khi
   * payload đã được dựng xong → Number(null) = 0 → KiotViet tra tồn kho ở chi nhánh 0
   * và trả KvValidateProductException "Không đủ số lượng tồn kho" cho toàn bộ dòng hàng.
   */
  private ensureCredentialsLoaded(): void {
    if (!this.accessToken || !this.retailer || !this.LatestBranchId) {
      this.loadStoredCredentials();
    }
  }

  private loadStoredCredentials(): boolean {
    const storedToken = localStorage.getItem('kv_access_token');
    const storedRetailer = localStorage.getItem('kv_retailer');
    const storedBranchId = localStorage.getItem('kv_branch_id');
    if (storedToken && storedRetailer && storedBranchId) {
      this.accessToken = storedToken;
      this.retailer = storedRetailer;
      this.LatestBranchId = storedBranchId;
      return true;
    }
    return false;
  }

  // Run a KiotViet fetch, and if unauthorized (401/403), attempt to get token again then retry ONCE
  private async performKiotVietFetchWithRetry<T>(
    makeRequest: (token: string) => Promise<Response>,
    parseJson: boolean = true
  ): Promise<T> {
    // Ensure we have creds in memory; avoid calling getAccessToken unless needed
    if (!this.accessToken || !this.retailer || !this.LatestBranchId) {
      this.loadStoredCredentials();
    }
    const token1 = this.accessToken || '';

    let res = await makeRequest(token1);
    if (res.status === 401 || res.status === 403) {
      // Token expired — refresh via AuthService (calls /api/auth/refresh to get new KV token)
      try {
        const refreshed = await this.authService.refreshKiotVietToken();
        if (refreshed) {
          this.authService.scheduleTokenRefresh();
          // Reload credentials from localStorage (AuthService đã lưu token mới)
          this.loadStoredCredentials();
          const newToken = this.accessToken || '';
          res = await makeRequest(newToken);
        } else {
          // Refresh failed — check if refresh token still exists (transient error vs expired)
          if (!this.authService.getRefreshToken()) {
            console.error('❌ [KiotvietService] Refresh token invalid, redirecting to login');
            this.tokenExpiredService.emitTokenExpired('kiotviet');
            setTimeout(() => {
              this.tokenExpiredService.redirectToLogin(true);
            }, 2000);
            throw new Error(`KIOTVIET_TOKEN_EXPIRED: ${res.status} ${res.statusText}`);
          }
          // Transient error — don't redirect, just throw for caller to handle
          console.warn('⚠️ [KiotvietService] Refresh failed (transient), not redirecting');
          throw new Error(`KiotViet auth failed (transient): ${res.status}`);
        }
      } catch (reAuthErr: any) {
        if (reAuthErr?.message?.includes('KIOTVIET_TOKEN_EXPIRED')) throw reAuthErr;
        // Network/unexpected error during refresh — don't redirect
        console.warn('⚠️ [KiotvietService] Error during token refresh:', reAuthErr);
        throw new Error(`KiotViet auth error: ${reAuthErr?.message || res.status}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP error! status: ${res.status}, message: ${text}`);
    }

    return (parseJson ? (await res.json()) : (await (res as any))) as T;
  }
  private async getAccessToken(): Promise<string> {
    // Ưu tiên lấy từ localStorage nếu đã đăng nhập
    const storedToken = localStorage.getItem('kv_access_token');
    const storedRetailer = localStorage.getItem('kv_retailer');
    const storedBranchId = localStorage.getItem('kv_branch_id');

    if (storedToken && storedRetailer && storedBranchId) {
      // Kiểm tra token có expired không
      if (this.isTokenExpired(storedToken)) {
        console.log('Token đã hết hạn, yêu cầu đăng nhập lại');
        this.clearStoredCredentials();
        throw new Error('Token đã hết hạn. Vui lòng đăng nhập lại.');
      }

      this.accessToken = storedToken;
      this.retailer = storedRetailer;
      this.LatestBranchId = storedBranchId;
      return this.accessToken;
    }

    // Nếu chưa có, yêu cầu đăng nhập lại
    throw new Error('Chưa đăng nhập KiotViet. Vui lòng đăng nhập lại.');
  }

  private isTokenExpired(token: string): boolean {
    try {
      // JWT token có 3 phần, phần thứ 2 là payload
      const payload = token.split('.')[1];
      const decodedPayload = JSON.parse(atob(payload));

      // Kiểm tra thời gian hết hạn (exp)
      if (decodedPayload.exp) {
        const currentTime = Math.floor(Date.now() / 1000);
        return currentTime >= decodedPayload.exp;
      }

      // Nếu không có exp, kiểm tra thời gian tạo token (iat) + thời gian sống ước tính
      if (decodedPayload.iat) {
        const currentTime = Math.floor(Date.now() / 1000);
        const estimatedExpiry = decodedPayload.iat + (24 * 60 * 60); // Ước tính 24 giờ
        return currentTime >= estimatedExpiry;
      }

      // Nếu không có thông tin thời gian, coi như không expired
      return false;
    } catch (error) {
      console.error('Lỗi khi kiểm tra token expired:', error);
      // Nếu không parse được token, coi như expired để đảm bảo an toàn
      return true;
    }
  }

  private clearStoredCredentials(): void {
    localStorage.removeItem('kv_access_token');
    localStorage.removeItem('kv_retailer');
    localStorage.removeItem('kv_branch_id');
    this.accessToken = null;
    this.retailer = null;
    this.LatestBranchId = null;
  }

  async getRequestBody(Id: number) {
    try {
      const url = `${this.getUpdateItemUrl}/${Id}/initialdata?Includes=ProductAttributes&ProductType=2`;
      const data = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any,
          }
        });
      });
      return data;
    } catch (error) {
      console.error('Error getting product', error);
      throw error;
    }
  }
  async updateProductToKiotviet(formDataGetFromKiotViet: any): Promise<any> {
    // BranchForProductCostss dưới đây đọc this.LatestBranchId → nạp credentials trước
    this.ensureCredentialsLoaded();

    const fD = new FormData();
    fD.append("product", JSON.stringify(formDataGetFromKiotViet.Product))
    fD.append("BranchForProductCostss", `[{ "Id": ${this.LatestBranchId}, "Name": "Chi nhánh trung tâm" }]`)
    fD.append("ListUnitPriceBookDetail", "[]")
    try {
      const url = `${this.updateItemUrl}/products/photo`;
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': token || '',
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: fD
        });
      });
      return result;
    } catch (error) {
      console.error('Error sending product data:', error);
      throw error;
    }
  }

  async updateOnHandFromInvoiceToKiotviet(
    invoice: InvoiceTab,
    groupedProducts: { [x: string]: any;[x: number]: any[]; },
    operation: 'decrease' | 'increase' = 'decrease'
  ): Promise<any> {
    const results: { productId: any; result?: any; error?: any; skipped?: boolean }[] = [];

    for (const cartItem of invoice.cartItems) {
      // Skip NV products (OnHandNV > 0 và OnHand = 0) - không gọi KiotViet API
      const onHand = cartItem.product?.OnHand ?? 0;
      const onHandNV = cartItem.product?.OnHandNV ?? 0;
      if (onHandNV > 0 && onHand === 0) {
        console.log(`⏭️ Bỏ qua sản phẩm NV (${cartItem.product?.Name}) - không cập nhật KiotViet`);
        results.push({ productId: cartItem.product?.Id, skipped: true });
        continue;
      }

      const masterUnitId = cartItem.product.MasterUnitId || cartItem.product.Id;
      const group = groupedProducts[masterUnitId];
      const masterItem = group?.find(item => item.MasterUnitId == null);

      if (!masterItem) {
        console.warn('⚠️ Không tìm thấy master item để cập nhật tồn kho KiotViet cho sản phẩm', cartItem?.product?.Id);
        continue;
      }

      const formDataGetFromKiotViet = await this.getRequestBody(masterItem.Id)
      const conversion = Number(cartItem.product?.ConversionValue) || 1;
      const delta = Number(cartItem.quantity ?? 0) * conversion;
      if (operation === 'decrease') {
        formDataGetFromKiotViet.Product.OnHand = formDataGetFromKiotViet.Product.OnHand - delta;
      } else {
        formDataGetFromKiotViet.Product.OnHand = formDataGetFromKiotViet.Product.OnHand + delta;
      }
      await this.updateProductToKiotviet(formDataGetFromKiotViet)
        .then(result => {
          results.push({ productId: masterItem.Id, result });
        })
        .catch(error => {
          console.error(`Error updating product ${masterItem.Id}:`, error);
          results.push({ productId: masterItem.Id, error: error.message });
        });
    }

    return results; // Return tất cả kết quả sau khi hoàn thành vòng lặp
  }

  async addCustomer(customerData: any): Promise<any> {
    // Payload đọc this.LatestBranchId → nạp credentials trước khi build
    this.ensureCredentialsLoaded();

    const payload = {
      Customer: {
        BranchId: Number(this.LatestBranchId),
        IsActive: true,
        Uuid: this.generateUUID(),
        Type: 0,
        temploc: "",
        tempw: "",
        EmployeeInChargeIds: [],
        Name: customerData.name,
        Organization: customerData.organization || "",
        ContactNumber: customerData.phone,
        Gender: customerData.gender === 'Nam' ? 1 : (customerData.gender === 'Nữ' ? 0 : null),
        BirthDate: customerData.birthDate ? new Date(customerData.birthDate).toISOString() : null,
        TaxCode: customerData.taxCode,
        IdentificationNumber: customerData.idCard,
        Email: customerData.email,
        Facebook: customerData.facebook,
        Comments: customerData.notes,
        LocationName: "",
        AdministrativeAreaId: null,
        WardName: "",
        CustomerGroupDetails: [],
        RetailerId: this.retailerId
      },
      isMergedSupplier: false,
      isCreateNewSupplier: false,
      MergedSupplierId: 0,
      SkipValidateEmail: false,
    };

    try {
      const url = `https://api-man1.kiotviet.vn/api/customers`;
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(payload)
        });
      });
      return result;
    } catch (error) {
      console.error('Error adding customer:', error);
      throw error;
    }
  }
  async syncProductFromKiotvietToFirebase(data: any): Promise<void> {
    (await this.http.post(`${environment.domainUrl}/api/sync/kiotviet/firebase/products`, data)
      .pipe(
        catchError((err) => {
          console.error('❌ Lỗi khi tải tất cả sản phẩm:', err);
          return of([]);
        })
      ).toPromise()) ?? [];
  }

  async syncCustomerFromKiotvietToFirebase(data: any): Promise<void> {
    // Lấy dữ liệu từ API
    (await this.http.put(`${environment.domainUrl}/api/sync/kiotviet/firebase/customers`, data)
      .pipe(
        catchError((err) => {
          console.error('❌ Lỗi khi tải tất cả khách hàng:', err);
          return of([]);
        })
      ).toPromise()) ?? [];
  }

  // ========= Campaign API =========

  /**
   * Fetch SalePromotionId từ KiotViet campaign (dùng để backfill promotions cũ).
   * Trả về { kiotVietSalePromotionId, kiotVietPromotionType } hoặc null nếu lỗi.
   */
  async fetchCampaignSalePromotionId(campaignId: number): Promise<{
    kiotVietSalePromotionId: number | null;
    kiotVietSalePromotionIds?: { [productId: string]: number };
    kiotVietPromotionType: number | null;
  } | null> {
    try {
      const res = await this.http.get<any>(
        `${environment.domainUrl}/api/kiotviet/campaigns/${campaignId}`
      ).toPromise();
      if (res?.success) {
        return {
          kiotVietSalePromotionId: res.kiotVietSalePromotionId,
          kiotVietSalePromotionIds: res.kiotVietSalePromotionIds,
          kiotVietPromotionType: res.kiotVietPromotionType,
        };
      }
      return null;
    } catch (err) {
      console.error('Failed to fetch campaign SalePromotionId:', err);
      return null;
    }
  }

  // ========= Trademark API =========

  /**
   * Lấy danh sách thương hiệu từ KiotViet
   */
  async getTrademarks(): Promise<any[]> {
    try {
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(this.trademarkUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          }
        });
      });
      return result?.Data || [];
    } catch (error) {
      console.error('Error getting trademarks:', error);
      throw error;
    }
  }

  /**
   * Tạo thương hiệu mới trên KiotViet
   * @param name Tên thương hiệu
   */
  async createTrademark(name: string): Promise<any> {
    const payload = {
      TradeMark: {
        Name: name,
        CompareName: ""
      }
    };

    try {
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(this.trademarkUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(payload)
        });
      });
      return result;
    } catch (error) {
      console.error('Error creating trademark:', error);
      throw error;
    }
  }

  // ========= Add Original Products API =========

  async addOriginalProductsToKiotViet(payload: {
    name: string;
    categoryId: number | null;
    trademarkId: number | null;
    taxRate: number;
    description: string;
    orderTemplate: string;
    units: Array<{ unit: string; price: number; cost: number; conversion: number; onHand: number; isBase: boolean }>;
  }): Promise<any> {
    const { firstValueFrom } = await import('rxjs');
    return await firstValueFrom(
      this.http.post<any>(`${environment.domainUrl}/api/kiotviet/products/addmany`, payload)
    );
  }

  // ========= Checkout Invoice API =========

  /**
   * Tạo hóa đơn checkout trên KiotViet
   * @param invoice InvoiceTab từ cart
   * @param sellerInfo Thông tin nhân viên bán hàng (từ KiotViet)
   * @param paymentMethod Phương thức thanh toán ('Cash', 'Card', 'Transfer')
   */
  async checkoutToKiotViet(
    invoice: InvoiceTab,
    sellerInfo: KVSeller,
    paymentMethod: 'Cash' | 'Card' | 'Transfer' = 'Cash',
    options?: { description?: string }
  ): Promise<any> {
    // Payload dưới đây đọc this.LatestBranchId → phải nạp credentials TRƯỚC khi build
    this.ensureCredentialsLoaded();
    // Chặn sớm: gửi BranchId=0 sẽ khiến KiotViet báo "Không đủ số lượng tồn kho" cho
    // TOÀN BỘ dòng hàng — thông báo sai hoàn toàn và cực khó lần ra nguyên nhân.
    if (!this.LatestBranchId) {
      throw new Error('Chưa nạp được chi nhánh KiotViet (BranchId). Vui lòng đăng nhập lại.');
    }

    // Tính tổng tiền và tạo invoice details
    const invoiceDetails: InvoiceDetailItem[] = [];
    let total = 0;
    let totalBeforeDiscount = 0;
    let totalProductDiscount = 0;
    let totalProductDiscountPreTax = 0;

    for (const cartItem of invoice.cartItems) {
      // Skip NV products (không gửi lên KiotViet)
      const onHand = cartItem.product?.OnHand ?? 0;
      const onHandNV = cartItem.product?.OnHandNV ?? 0;
      const isCloneFlag = (cartItem.product as any)?.isClone === true;
      const isCloneByOnHandNV = onHandNV > 0 && onHand === 0;
      const isClone = isCloneFlag || isCloneByOnHandNV;

      // Debug log
      console.log(`🔍 checkoutToKiotViet - Checking product: ${cartItem.product?.Name}`, {
        id: cartItem.product?.Id,
        onHand,
        onHandNV,
        isCloneFlag,
        isCloneByOnHandNV,
        finalIsClone: isClone,
        willSkip: isClone
      });

      if (isClone) {
        console.log(`⏭️ Bỏ qua sản phẩm Clone/NV (${cartItem.product?.Name}) trong checkout KiotViet - KHÔNG GỬI LÊN KIOTVIET`);
        continue;
      }

      // === Promotion handling (3 loại) ===
      // Type 1 Gift:           isGift=true              → KV: full price + 100% discount (khi có KV promo data)
      // Type 2 Direct Discount: promotionId set, unitPriceSaleOff>0, !isPromotionItem → DiscountAfterTax
      // Type 3 Buy A→B:        isPromotionItem=true     → DiscountAfterTax + SalePromotionId
      const isGiftItem = cartItem.isGift === true;
      const isDiscountedPromoItem = cartItem.isPromotionItem === true && !isGiftItem; // Type 3
      const isDirectDiscount = !isGiftItem && !isDiscountedPromoItem
        && !!cartItem.promotionId && (cartItem.unitPriceSaleOff ?? 0) > 0; // Type 2

      // KiotViet promotion data (chỉ có khi promotion đã sync lên KiotViet)
      const hasKvPromoData = !!(cartItem.kiotVietSalePromotionId && cartItem.kiotVietCampaignId);
      // BasePrice: ưu tiên product.BasePrice, fallback sang unitPrice (set từ BasePrice khi tạo CartItem)
      const basePrice = cartItem.product?.BasePrice || cartItem.unitPrice || 0;
      // Gift items: luôn Price=0 (để HĐĐT không tính giá bán cho hàng tặng)
      const priceAfterTax = isGiftItem ? 0 : (cartItem.unitPrice ?? basePrice);
      const quantity = cartItem.quantity || 0;
      // Gift items: luôn free (không tính vào total thanh toán)
      const itemTotal = isGiftItem ? 0 : (priceAfterTax * quantity);
      total += itemTotal;
      // Track TotalBeforeDiscount: gồm cả gift items ở giá gốc
      totalBeforeDiscount += basePrice * quantity;

      // Per-item discount
      let perItemDiscountAfterTax = 0;
      let perItemDiscountPreTax = 0;
      if (isDiscountedPromoItem || isDirectDiscount) {
        perItemDiscountAfterTax = Math.max(0, basePrice - priceAfterTax);
      }
      const totalItemDiscount = perItemDiscountAfterTax * quantity;
      totalProductDiscount += totalItemDiscount;
      totalProductDiscountPreTax += perItemDiscountPreTax * quantity;

      const productId = cartItem.product?.Id || 0;
      // MasterProductId: nếu là master thì bằng chính Id, nếu là child thì bằng MasterUnitId
      const masterProductId = cartItem.product?.MasterUnitId || productId;

      // ✅ Tính Tax cho sản phẩm
      // Tax có thể là number (0, 5, 8, 10) hoặc string ("KCT", "KKKNT")
      const rawTax = cartItem.product?.Tax ?? 0;
      const isStringTax = typeof rawTax === 'string' && isNaN(Number(rawTax)); // "KCT", "KKKNT"
      const taxPercent = isStringTax ? 0 : (Number(rawTax) || 0);  // KCT/KKKNT = 0% effective rate
      const taxId = TAX_ID_MAP[rawTax] ?? TAX_ID_MAP[taxPercent] ?? 1;
      const hasTax = taxPercent > 0;

      // Tính giá chưa thuế và số tiền thuế
      const priceBeforeTax = hasTax
        ? Math.round((priceAfterTax / (1 + taxPercent / 100)) * 100) / 100
        : priceAfterTax;

      // Gift: Price=0 → DetailTax=0
      const detailTax = isGiftItem ? 0
        : (hasTax ? Math.round((priceAfterTax - priceBeforeTax) * quantity) : 0);

      // Pre-tax per-unit discount
      perItemDiscountPreTax = (hasTax && perItemDiscountAfterTax > 0)
        ? Math.round((perItemDiscountAfterTax / (1 + taxPercent / 100)) * 100) / 100
        : perItemDiscountAfterTax;

      // Build InvoiceDetailTaxs array
      const discountRatioAfterTax = (isDiscountedPromoItem && hasKvPromoData && cartItem.discountPercent) ? cartItem.discountPercent : 0;
      const invoiceDetailTaxs: InvoiceDetailTax[] = [{
        TaxId: taxId,
        DetailTax: isStringTax ? null : detailTax,
        PriceAfterTax: priceAfterTax,
        ViewDiscountAfterTax: perItemDiscountAfterTax,
        DiscountAfterTax: perItemDiscountAfterTax,
        DiscountRatioAfterTax: discountRatioAfterTax,
        DiscountByPromotionAfterTax: 0,
        AllocationDiscountAfterTax: 0
      }];

      // Build DetailTaxIds array
      const taxName = isStringTax ? String(rawTax) : `${taxPercent}%`;
      const detailTaxIds: DetailTaxId[] = isStringTax
        ? [{ CountryId: 1, Id: taxId, Name: taxName, Type: 1 }]
        : [{ CountryId: 1, Id: taxId, Name: taxName, Type: 1, Value: taxPercent }];

      console.log(`🧾 Tax info for ${cartItem.product?.Name}:`, {
        rawTax, isStringTax, taxPercent, taxId, priceAfterTax, priceBeforeTax, detailTax, hasTax,
        hasKvPromoData, perItemDiscountAfterTax, perItemDiscountPreTax
      });

      // Note cho gift/promotion items
      const promoSuffix = cartItem.promotionName ? ` (${cartItem.promotionName})` : '';
      const itemNote = isGiftItem
        ? `KM: Tặng kèm${promoSuffix}`
        : (isDiscountedPromoItem || isDirectDiscount)
          ? `KM: Giảm giá${promoSuffix}`
          : '';

      // Build InvoiceDetailItem
      const detailItem: InvoiceDetailItem = {
        BasePrice: basePrice,
        IsLotSerialControl: false,
        IsBatchExpireControl: false,
        IsRewardPoint: cartItem.product?.IsRewardPoint || true,
        Note: itemNote,
        Price: isGiftItem ? 0 : (hasTax ? priceBeforeTax : priceAfterTax),
        PriceAfterTax: priceAfterTax,
        ProductId: productId,
        Quantity: quantity,
        ProductCode: cartItem.product?.Code || '',
        Weight: 0,
        DiscountAfterTax: perItemDiscountAfterTax,
        ProductName: cartItem.product?.Name || '',
        SalePromotionId: isDiscountedPromoItem && hasKvPromoData
          ? cartItem.kiotVietSalePromotionId : null,
        OriginPrice: isGiftItem ? 0 : basePrice,
        PriceByPromotion: null,
        PromotionParentProductId: isDiscountedPromoItem && hasKvPromoData
          ? (Number(cartItem.parentProductId) || null) : null,
        ProductFormulaHistoryId: null,
        ProductBatchExpireId: null,
        CategoryId: cartItem.product?.CategoryId || null,
        MasterProductId: masterProductId,
        Unit: cartItem.product?.Unit || '',
        Uuid: `WN${this.generateUUID()}`,
        SupplyPromotionTypes: '',
        Formulas: null,
        AllocationDiscount: 0,
        InvoiceDetailTaxs: invoiceDetailTaxs,
        DetailTaxIds: detailTaxIds
      };

      // Thêm Discount/DiscountRatio cho discount promotion items có KV data
      if (hasKvPromoData && isDiscountedPromoItem) {
        detailItem.Discount = perItemDiscountPreTax;
        if (isDiscountedPromoItem && cartItem.discountPercent) {
          detailItem.DiscountRatio = cartItem.discountPercent;
        }
      }

      invoiceDetails.push(detailItem);
    }

    // Nếu không có sản phẩm KV nào để checkout
    if (invoiceDetails.length === 0) {
      console.log('⚠️ Không có sản phẩm KiotViet để checkout');
      return { skipped: true, message: 'Không có sản phẩm KiotViet để checkout' };
    }

    // ========== Build InvoicePromotions array ==========
    const invoicePromotions: InvoicePromotion[] = [];

    for (const cartItem of invoice.cartItems) {
      // Chỉ build InvoicePromotion cho items có KV promotion data
      if (!cartItem.kiotVietSalePromotionId || !cartItem.kiotVietCampaignId) continue;
      if (!cartItem.isGift && !cartItem.isPromotionItem) continue;
      // Gift items: Price=0, không cần InvoicePromotion (tránh HĐĐT tính giá)
      if (cartItem.isGift) continue;

      const isType6 = cartItem.kiotVietPromotionType === 6; // gift
      const promoProductId = cartItem.product?.Id || 0;
      const triggerProductId = Number(cartItem.parentProductId) || 0;
      const promoProductCode = cartItem.product?.Code || '';
      const promoProductName = cartItem.product?.Name || '';

      // Tìm trigger item trong cart để lấy thông tin
      const triggerItem = invoice.cartItems.find(ci =>
        ci.product?.Id === triggerProductId && !ci.isGift && !ci.isPromotionItem
      );
      const triggerCode = triggerItem?.product?.Code || '';
      const triggerName = triggerItem?.product?.Name || '';
      const triggerUnit = triggerItem?.product?.Unit || '';
      const promoUnit = cartItem.product?.Unit || '';

      const promoEntry: InvoicePromotion = {
        Type: isType6 ? 6 : 5,
        TargetType: 1,
        SalePromotionId: cartItem.kiotVietSalePromotionId,
        PromotionId: cartItem.kiotVietCampaignId,
        ProductId: promoProductId,
        RelatedProductId: triggerProductId,
        RelatedProductQty: 1,
        ProductQty: 1,
        IsFixedQuantity: false,
        LimitPromotionUsage: true,
        LimitPromotionUsageType: 2,
        PromotionInfo: isType6
          ? `${cartItem.promotionName || 'Promotion'}:\n                Khi mua ${triggerItem?.quantity || 1} ${triggerCode} - ${triggerName} \n                tặng ${cartItem.quantity} ${promoProductCode} - ${promoProductName}`
          : `${cartItem.promotionName}:\n                Khi mua ${triggerItem?.quantity || 1} ${triggerCode} - ${triggerName}  giảm giá${cartItem.discountPercent ? ` ${cartItem.discountPercent}%` : ''}\n                cho ${cartItem.quantity} ${promoProductCode} - ${promoProductName}`,
        PrintPromotionInfo: isType6
          ? `Mua ${triggerItem?.quantity || 1} ${triggerUnit} ${triggerName} \n                tặng ${cartItem.quantity} ${promoUnit} ${promoProductName}`
          : `Mua ${triggerItem?.quantity || 1} ${triggerUnit} ${triggerName}  giảm giá\n                ${cartItem.discountPercent ? `${cartItem.discountPercent}%` : ''}\n                                                cho ${cartItem.quantity} ${promoUnit} ${promoProductName}`,
        ProductIds: String(promoProductId),
        RelatedProductIds: String(triggerProductId),
        RelatedCategoryIds: '',
        BackupSelectedSerials: {},
      };

      // Type 5 (discount): thêm DiscountRatio và TargetProductId
      if (!isType6) {
        if (cartItem.discountPercent) {
          promoEntry.DiscountRatio = cartItem.discountPercent;
        }
        promoEntry.TargetProductId = triggerProductId;
      }

      invoicePromotions.push(promoEntry);
    }

    console.log('🎁 InvoicePromotions built:', invoicePromotions.length, 'entries');

    // ✅ Tính tổng thuế từ tất cả invoice details
    const totalTax = invoiceDetails.reduce((sum, item) => {
      const itemTax = item.InvoiceDetailTaxs.reduce((taxSum, tax) => taxSum + (tax.DetailTax ?? 0), 0);
      return sum + itemTax;
    }, 0);

    // ✅ Kiểm tra có sản phẩm nào có thuế không
    const hasAnyTax = invoiceDetails.some(item => item.InvoiceDetailTaxs.length > 0);

    console.log('🧾 Total invoice tax calculation:', {
      totalTax,
      hasAnyTax,
      itemsCount: invoiceDetails.length,
      totalBeforeDiscount,
      totalProductDiscount
    });

    // Tính discount tổng hóa đơn
    const invoiceDiscount = invoice.discountAmount || 0;
    const totalPayment = total - invoiceDiscount;

    // Map payment method
    const paymentMethodMap: Record<string, { method: string; methodStr: string }> = {
      'Cash': { method: 'Cash', methodStr: 'Tiền mặt' },
      'Card': { method: 'Card', methodStr: 'Thẻ' },
      'Transfer': { method: 'Transfer', methodStr: 'Chuyển khoản' }
    };

    const payment = paymentMethodMap[paymentMethod] || paymentMethodMap['Cash'];

    const invoiceUuid = `WN${this.generateUUID()}`;

    const payload: CheckoutInvoicePayload = {
      Invoice: {
        BranchId: Number(this.LatestBranchId),
        RetailerId: this.retailerId,
        UpdateInvoiceId: 0,
        UpdateReturnId: 0,
        SoldById: sellerInfo.Id,
        SoldBy: sellerInfo,
        SaleChannelId: 0,
        Seller: sellerInfo,
        OrderCode: '',
        Code: invoice.name || 'Hóa đơn 1',
        DiscountAfterTax: 0,
        DiscountRatioAfterTax: 0,
        DiscountByPromotion: 0,
        DiscountByPromotionAfterTax: 0,
        DiscountByPromotionValue: 0,
        DiscountByPromotionRatio: 0,
        DiscountByCouponAfterTax: 0,
        InvoiceDetails: invoiceDetails,
        InvoiceOrderSurcharges: [],
        InvoicePromotions: invoicePromotions,
        InvoiceSupplierPromotions: [],
        UsingCod: 0,
        Payments: [{
          Method: payment.method,
          MethodStr: payment.methodStr,
          Amount: totalPayment,
          Id: -1,
          AccountId: paymentMethod === 'Transfer' ? 813285 : null,
          UsePoint: null
        }],
        Status: 1,
        Total: total,
        TotalTax: hasAnyTax ? totalTax : null,  // ✅ Chỉ set khi có thuế
        EnableVATToggle: true,
        RoundAmount: null,
        Surcharge: 0,
        Type: 1,
        Uuid: invoiceUuid,
        addToAccount: '0',
        PayingAmount: totalPayment,
        TotalBeforeDiscount: totalBeforeDiscount,
        ProductDiscount: Math.round(totalProductDiscountPreTax) + invoiceDiscount,
        DebugUuid: invoiceUuid,
        InvoiceWarranties: [],
        IsUsingProductVAT: hasAnyTax,           // ✅ true khi có sản phẩm có thuế
        PricingMode: hasAnyTax ? 1 : undefined, // ✅ 1 = Giá đã bao gồm thuế
        CreatedBy: sellerInfo.Id,
        ...(options?.description ? { Description: options.description } : {})
      }
    };

    try {
      console.log('📤 Đang gửi checkout đến KiotViet...', payload);

      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(this.checkOutURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(payload)
        });
      });

      console.log('✅ Checkout KiotViet thành công:', result);
      return result;
    } catch (error) {
      console.error('❌ Error checkout to KiotViet:', error);
      throw error;
    }
  }

  /**
   * Tạo hóa đơn checkout với payload tùy chỉnh
   * @param customPayload Payload tùy chỉnh theo format KiotViet
   */
  async checkoutToKiotVietWithCustomPayload(customPayload: CheckoutInvoicePayload): Promise<any> {
    try {
      console.log('📤 Đang gửi custom checkout đến KiotViet...', customPayload);

      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        return await fetch(this.checkOutURL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(customPayload)
        });
      });

      console.log('✅ Custom checkout KiotViet thành công:', result);
      return result;
    } catch (error) {
      console.error('❌ Error custom checkout to KiotViet:', error);
      throw error;
    }
  }

  /**
   * Mark/unmark a KiotViet invoice as favourite.
   * POST https://api-man1.kiotviet.vn/api/invoices/updateFavourite
   */
  async updateInvoiceFavourite(invoiceId: number, isFavourite: boolean): Promise<any> {
    const url = 'https://api-man1.kiotviet.vn/api/invoices/updateFavourite';
    return this.performKiotVietFetchWithRetry<any>(async (token) => {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
          'Retailer': this.retailer as any,
          'BranchId': this.LatestBranchId as any
        },
        body: JSON.stringify({ Id: invoiceId, IsFavourite: isFavourite })
      });
    });
  }

  /**
   * Lấy default seller info cho checkout
   * Sử dụng khi không có thông tin seller từ bên ngoài
   */
  getDefaultSellerInfo(): KVSeller {
    return {
      CreatedBy: 0,
      CreatedDate: new Date().toISOString(),
      Email: '',
      GivenName: 'Nhân viên',
      Id: 979657, // Default admin ID
      IsActive: true,
      IsAdmin: true,
      Language: 'vi-VN',
      MobilePhone: '',
      Type: 0,
      UserName: 'admin',
      isDeleted: false
    };
  }

  // ========= Invoice API (for Ledger 9) =========

  /**
   * Lấy danh sách hóa đơn từ KiotViet theo khoảng thời gian
   * @param fromDate Ngày bắt đầu (yyyy-mm-dd)
   * @param toDate Ngày kết thúc (yyyy-mm-dd)
   */
  async getInvoices(fromDate: string, toDate: string): Promise<KiotVietInvoice[]> {
    const url = 'https://api-man1.kiotviet.vn/api/invoices/list';

    // Calculate next day for toDate to include the entire day
    const toDateObj = new Date(toDate);
    toDateObj.setDate(toDateObj.getDate() + 1);
    const toDateNext = toDateObj.toISOString().split('T')[0];

    // Format dates for display
    const fromDateParts = fromDate.split('-');
    const toDateParts = toDate.split('-');
    const fromDateStr = `${fromDateParts[2]}/${fromDateParts[1]}/${fromDateParts[0]} 00:00:00`;
    const toDateStr = `${toDateParts[2]}/${toDateParts[1]}/${toDateParts[0]} 23:59:59`;

    const payload = {
      "$inlinecount": "allpages",
      "$format": "json",
      "ExpectedDeliveryFilterType": "alltime",
      "FiltersForOrm": JSON.stringify({
        "BranchIds": [878979],
        "PriceBookIds": [],
        "FromDate": `${fromDate}T17:00:00.000Z`,
        "ToDate": `${toDateNext}T16:59:59.000Z`,
        "FromDateStr": fromDateStr,
        "ToDateStr": toDateStr,
        "TimeRange": "other",
        "InvoiceStatus": [1],
        "UsingCod": [0],
        "TableIds": [],
        "SalechannelIds": [],
        "StartDeliveryDate": null,
        "EndDeliveryDate": null,
        "StartDeliveryDateStr": null,
        "EndDeliveryDateStr": null,
        "UsingPrescription": 2,
        "EInvoiceStatus": []
      }),
      "InvoiceStatus": "[1]",
      "$top": 20000,
      "$filter": `((PurchaseDate ge datetime'${fromDate}T00:00:00' and PurchaseDate lt datetime'${toDateNext}T00:00:00') and (UsingCod eq 0 or UsingCod eq null))`
    };

    try {
      const result = await this.performKiotVietFetchWithRetry<{ Data: any[] }>(async (token) => {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(payload)
        });
      });

      // Skip first item (usually metadata) and return the rest
      const data = result?.Data || [];
      return data.slice(1) as KiotVietInvoice[];
    } catch (error) {
      console.error('Error getting invoices from KiotViet:', error);
      throw error;
    }
  }

  /**
   * Get single product from KiotViet by product code
   * Uses masterproducts API to get master product, then initialdata API to get child units
   * @param productCode - Product code to search
   * @returns Array of products (master + child units)
   */
  async getSingleProductFromKiotViet(productCode: string): Promise<KiotVietSuggestProduct[]> {
    try {
      // Step 1: Get master product from masterproducts API
      const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
        const url = `https://api-man1.kiotviet.vn/api/branchs/${this.LatestBranchId}/masterproducts?format=json&Includes=ProductAttributes&ForSummaryRow=true`;
        const payload = {
          "$inlinecount": "allpages",
          "$format": "json",
          "CategoryIds": "[]",
          "AttributeFilter": "[]",
          "ConditionTaxIds": "",
          "ProductKey": String(productCode),
          "BranchId": -1,
          "ProductTypes": "",
          "IsImei": 2,
          "IsFormulas": 2,
          "IsActive": true,
          "AllowSale": null,
          "IsBatchExpireControl": 2,
          "ShelvesIds": "",
          "TrademarkIds": "",
          "StockoutDate": "alltime",
          "CreatedDate": "alltime",
          "supplierIds": "",
          "isNewFilter": true,
          "$top": 15,
          "Skip": 0,
          "Take": 15,
          "PageSize": 15,
          "Page": 1
        };

        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token,
            'Retailer': this.retailer as any,
            'BranchId': this.LatestBranchId as any
          },
          body: JSON.stringify(payload)
        });
      });

      // Filter out summary rows (Id <= 0) from masterproducts response
      const allData = result?.Data || [];
      const masterProducts = allData.filter((p: any) => p.Id > 0);
      console.log(`📦 KiotViet masterproducts API returned ${masterProducts.length} products for ProductKey: ${productCode}`);

      if (!masterProducts || masterProducts.length === 0) {
        return [];
      }

      // Step 2: For each master product, call products API with MasterProductId to get child units
      // API: GET /api/branchs/{branchId}/products?MasterProductId={masterId}
      // Response trả về child units với MasterUnitId/MasterProductId chính xác từ KiotViet
      const allProducts: KiotVietSuggestProduct[] = [];

      for (const master of masterProducts) {
        // Clear MasterUnitId/MasterProductId for master products
        // KiotViet's MasterProductId = product-variant relationship (e.g., 9999999999992 is variant of 9999999999990)
        // Our MasterUnitId = unit-conversion grouping. If we keep MasterProductId, transformKiotVietToProduct
        // will use it as fallback for MasterUnitId, breaking our grouping (product becomes child of wrong master)
        master.MasterUnitId = null as any;
        master.MasterProductId = null as any;
        allProducts.push(master);

        try {
          const childData = await this.performKiotVietFetchWithRetry<any>(async (token) => {
            const url = `https://api-man1.kiotviet.vn/api/branchs/${this.LatestBranchId}/products?MasterProductId=${master.Id}`;
            return await fetch(url, {
              method: 'GET',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'Retailer': this.retailer as any,
                'BranchId': this.LatestBranchId as any
              }
            });
          });

          const childProducts = childData?.Data || [];
          if (childProducts.length > 0) {
            console.log(`📦 products API returned ${childProducts.length} child units for master ${master.Id}`);

            // Child products từ API đã có MasterUnitId/MasterProductId chính xác
            for (const child of childProducts) {
              const childProduct: KiotVietSuggestProduct = {
                Id: child.Id,
                Code: child.Code,
                Name: child.Name || master.Name,
                NameOriginal: child.NameOriginal || master.NameOriginal,
                FullName: child.FullName || child.Name || `${master.Name} (${child.Unit})`,
                ProductName: master.Name,
                SortName: master.SortName || '',
                Unit: child.Unit,
                BasePrice: child.BasePrice,
                Cost: child.Cost || child.LatestPurchasePrice || 0,
                OnHand: child.OnHand || 0,
                OnOrder: child.OnOrder || 0,
                LatestPurchasePrice: child.LatestPurchasePrice || 0,
                MasterUnitId: child.MasterUnitId,       // Giữ nguyên từ KiotViet API
                MasterProductId: child.MasterProductId,  // Giữ nguyên từ KiotViet API
                Reserved: child.Reserved || 0,
                IsLotSerialControl: child.IsLotSerialControl || false,
                IsBatchExpireControl: child.IsBatchExpireControl || false,
                ConversionValue: child.ConversionValue,
                TaxIds: child.TaxIds ?? master.TaxIds,  // Carry tax for transform → Tax field
                ProductType: child.ProductType || master.ProductType || 2,
                AllowsSale: child.AllowsSale ?? true,
                CategoryId: child.CategoryId || master.CategoryId,
                Image: master.Image,
                ListProductUnit: [],
                ProductShelves: child.ProductShelves || [],
                ActualReserved: child.ActualReserved || 0,
                HasSerialOrBatchExpireInfo: false,
                HasVariants: false,
                TotalOnHand: child.OnHand || 0,
                VariantCount: 0
              };
              allProducts.push(childProduct);
            }
          }
        } catch (childError) {
          console.warn(`⚠️ Failed to get child units for product ${master.Id}, skipping:`, childError);
        }
      }

      // Deduplicate: nếu cùng 1 product xuất hiện vừa là "master" (MasterUnitId=null)
      // vừa là "child" (MasterUnitId có giá trị từ initialdata), giữ bản child
      const productMap = new Map<number, KiotVietSuggestProduct>();
      for (const product of allProducts) {
        const existing = productMap.get(product.Id);
        if (!existing) {
          productMap.set(product.Id, product);
        } else if (product.MasterUnitId && !existing.MasterUnitId) {
          // Prefer child version (có MasterUnitId) over master version (MasterUnitId=null)
          productMap.set(product.Id, product);
        }
        // Nếu existing đã có MasterUnitId, giữ nguyên (không ghi đè bằng null)
      }
      const deduplicatedProducts = Array.from(productMap.values());

      console.log(`📦 Total products (master + children): ${allProducts.length}, after dedup: ${deduplicatedProducts.length}`);
      return deduplicatedProducts;
    } catch (error) {
      console.error('Error getting single product from KiotViet:', error);
      throw error;
    }
  }

  // ========= Purchase Order API (Nhập hàng) =========

  /**
   * BranchId hiện tại (đọc từ localStorage nếu chưa nạp vào bộ nhớ).
   */
  getBranchId(): number {
    if (!this.LatestBranchId) this.loadStoredCredentials();
    return Number(this.LatestBranchId) || 0;
  }

  /**
   * Tìm sản phẩm cho phiếu nhập hàng (đúng API màn Nhập hàng của KiotViet).
   * GET /api/products/autocomplete?tearm=...&Type=1&PurchaseId=0
   */
  async autocompletePurchaseProducts(term: string): Promise<KiotVietPurchaseProduct[]> {
    const url = `https://api-man1.kiotviet.vn/api/products/autocomplete?tearm=${encodeURIComponent(term)}&Type=1&PurchaseId=0`;
    const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
      return await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
          'Retailer': this.retailer as any,
          'BranchId': this.LatestBranchId as any
        }
      });
    });
    return Array.isArray(result) ? result : (result?.Data || []);
  }

  /**
   * Tìm nhà cung cấp theo tên (dùng để gán Supplier cho phiếu nhập).
   * GET /api/suppliers/autocomplete?tearm=...
   */
  async autocompleteSuppliers(term: string): Promise<KiotVietSupplier[]> {
    const url = `https://api-man1.kiotviet.vn/api/suppliers/autocomplete?tearm=${encodeURIComponent(term)}`;
    const result = await this.performKiotVietFetchWithRetry<any>(async (token) => {
      return await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
          'Retailer': this.retailer as any,
          'BranchId': this.LatestBranchId as any
        }
      });
    });
    return Array.isArray(result) ? result : (result?.Data || []);
  }

  /**
   * Tạo phiếu nhập hàng trên KiotViet.
   * POST /api/purchaseOrders — payload đã bọc sẵn { PurchaseOrder, Complete, ... }
   */
  async createPurchaseOrder(payload: any): Promise<any> {
    const url = 'https://api-man1.kiotviet.vn/api/purchaseOrders';
    return await this.performKiotVietFetchWithRetry<any>(async (token) => {
      return await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token,
          'Retailer': this.retailer as any,
          'BranchId': this.LatestBranchId as any
        },
        body: JSON.stringify(payload)
      });
    });
  }
}

// ========= KiotViet Purchase Order Interfaces =========

/** Item trả về từ /api/products/autocomplete (Type=1) — đủ field để build PurchaseOrderDetails */
export interface KiotVietPurchaseProduct {
  Id: number;
  Name: string;          // "Kẹo gừng cứng 200g (gói)" — tên kèm đơn vị
  ProductName: string;   // Tên hàng thuần
  Unit: string;
  Code: string;
  BasePrice: number;
  OnHand: number;
  OnOrder: number;
  Cost: number;
  LatestPurchasePrice: number;
  Reserved: number;
  ActualReserved: number;
  IsLotSerialControl: boolean;
  IsBatchExpireControl?: boolean;
  ConversionValue: number;
  Image?: string;
  HasVariants: boolean;
  ListProductUnit: { Id: number; Unit: string; Code: string; Conversion: number; MasterUnitId: number }[];
}

export interface KiotVietSupplier {
  Id: number;
  Name: string;
  Code?: string;
  Phone?: string;
  Address?: string;
  [key: string]: any;
}

// ========= KiotViet Suggest Product Interface =========
export interface KiotVietSuggestProduct {
  Id: number;
  Name: string;
  NameOriginal?: string; // masterproducts API returns this (e.g., "Test" without variant/unit suffix)
  FullName?: string; // masterproducts API returns this (e.g., "Test - Cam (chai)")
  ProductName: string;
  SortName: string;
  AttributeLabel?: string;
  Unit: string;
  Code: string;
  BasePrice: number;
  OnHand: number;
  OnOrder: number;
  Cost: number;
  LatestPurchasePrice: number;
  MasterUnitId?: number;
  MasterProductId?: number;
  Reserved: number;
  IsLotSerialControl: boolean;
  IsBatchExpireControl: boolean;
  ConversionValue: number;
  ProductType: number;
  Image?: string;
  AllowsSale: boolean;
  CategoryId: number;
  ListProductUnit: {
    Id: number;
    Unit: string;
    Code: string;
    Conversion: number;
    MasterUnitId: number;
  }[];
  // masterproducts API returns UnitList instead of ListProductUnit
  UnitList?: {
    UnitName: string;
    ProductId: number;
  }[];
  ProductShelves: any[];
  ActualReserved: number;
  HasSerialOrBatchExpireInfo: boolean;
  HasVariants: boolean;
  TotalOnHand: number;
  VariantCount: number;
  OrderTemplate?: string;
  TaxIds?: number[] | number | string; // KiotViet tax id(s), mapped → Tax value on transform
}

// ========= KiotViet Invoice Interface =========
export interface KiotVietInvoice {
  Id: number;
  PurchaseDate: string;
  CreatedDate: string;
  CreatedBy: number;
  RetailerId: number;
  Code: string;
  Status: number;
  BranchId: number;
  SoldById: number;
  Total: number;
  TotalPayment: number;
  Debt: number;
  Surcharge: number;
  Uuid: string;
  CustomerName: string;
  CustomerCode: string;
  CustomerContactNumber: string;
  CustomerAddress: string;
  StatusValue: string;
  SubTotal: number;
  PaidAmount: number;
}
