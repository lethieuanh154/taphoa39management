import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { KiotvietService, KiotVietPurchaseProduct, KiotVietSupplier } from './kiotviet.service';
import { log, logError } from '../utils/log.util';

/** Một dòng hàng của phiếu nhập: dữ liệu từ XML + sản phẩm KiotViet đã khớp */
export interface PurchaseLine {
  stt: number;
  xmlName: string;        // Tên hàng trên hóa đơn XML
  unit: string;           // ĐVT trên XML
  quantity: number;
  unitPrice: number;      // Đơn giá (trước chiết khấu)
  discount: number;       // Chiết khấu của dòng (STCKhau)
  amount: number;         // Thành tiền (đã trừ chiết khấu)
  product: KiotVietPurchaseProduct | null;  // SP KiotViet khớp được, null = chưa khớp
  candidates: KiotVietPurchaseProduct[];    // SP gợi ý từ KiotViet (cho dialog review)
  matchScore: number;     // 1 = trùng tên tuyệt đối, <1 = cần user xác nhận
  needsReview: boolean;   // true khi chưa khớp hoặc khớp không chắc chắn
  searching?: boolean;
}

/** Kết quả đọc file XML hóa đơn đầu vào */
export interface ParsedPurchaseInvoice {
  lines: PurchaseLine[];
  sellerName: string;
  invoiceNumber: string;  // Số hóa đơn đầu vào (ký hiệu + số)
}

const PURCHASE_USER = {
  id: 979657,
  username: 'admin',
  givenName: 'Tạp hóa 39',
  Id: 979657,
  UserName: 'admin',
  GivenName: 'Tạp hóa 39',
  IsAdmin: true,
  IsLimitedByTrans: false,
  IsShowSumRow: true,
  Theme: null,
  Language: 'vi-VN',
  MobilePhone: '+84 703 863 690'
};

const PURCHASE_BRANCH = {
  id: 878979,
  name: 'Chi nhánh trung tâm',
  Id: 878979,
  Name: 'Chi nhánh trung tâm',
  Address: 'a',
  LocationName: 'Đà Nẵng - Quận Cẩm Lệ',
  WardName: null,
  ContactNumber: '0778806690',
  SubContactNumber: null,
  GmbStatus: 1,
  PharmacySyncStatus: null,
  PharmacyStoreType: null,
  AdministrativeAreaId: null
};

@Injectable({ providedIn: 'root' })
export class KiotVietPurchaseOrderService {

  /** localStorage: nhớ lựa chọn SP của user theo tên hàng XML (tên hàng đã normalize → SP KiotViet) */
  private readonly MATCH_STORAGE_KEY = 'kvPurchaseOrderMatches';

  constructor(
    private http: HttpClient,
    private kiotvietService: KiotvietService
  ) {}

  // ============ Ghi nhớ lựa chọn match (localStorage) ============

  /** Chuẩn hóa đơn vị tính để so sánh (bỏ hoa/thường + khoảng trắng) */
  normalizeUnit(unit: string): string {
    return (unit || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /** Key ghi nhớ gồm tên hàng + đơn vị (tránh nhầm cùng SP khác đơn vị, vd ly ↔ thùng) */
  private normalizeKey(name: string, unit: string): string {
    const n = (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const u = this.normalizeUnit(unit);
    if (!n) return '';
    return u ? `${n}||${u}` : n;
  }

  private loadSavedMatches(): Record<string, KiotVietPurchaseProduct> {
    try {
      return JSON.parse(localStorage.getItem(this.MATCH_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  /** SP user đã chọn trước đó cho tên hàng + đơn vị này (null nếu chưa từng chọn) */
  getSavedMatch(xmlName: string, unit: string): KiotVietPurchaseProduct | null {
    const key = this.normalizeKey(xmlName, unit);
    if (!key) return null;
    return this.loadSavedMatches()[key] || null;
  }

  private saveMatch(xmlName: string, unit: string, product: KiotVietPurchaseProduct | null): void {
    const key = this.normalizeKey(xmlName, unit);
    if (!key) return;
    const map = this.loadSavedMatches();
    if (product) {
      map[key] = product;
    } else {
      delete map[key]; // user bỏ qua → xóa ghi nhớ cũ
    }
    try {
      localStorage.setItem(this.MATCH_STORAGE_KEY, JSON.stringify(map));
    } catch (error) {
      logError('[KVPurchaseOrder] saveMatch error:', error);
    }
  }

  // ============ 1. Đọc XML ============

  /**
   * Đọc file XML hóa đơn qua backend /v1/parse-xml rồi map sang các dòng phiếu nhập.
   */
  async parseXmlFile(file: File): Promise<ParsedPurchaseInvoice> {
    const formData = new FormData();
    formData.append('file', file);

    log('[KVPurchaseOrder] parseXmlFile:', file.name);
    const result = await firstValueFrom(
      this.http.post<any>(`${environment.domainUrl}/v1/parse-xml`, formData)
    );

    if (!result?.success || !result.invoices?.length) {
      throw new Error(result?.error || 'Không đọc được dữ liệu từ file XML');
    }

    const invoice = result.invoices[0];
    const lines: PurchaseLine[] = (invoice.items || [])
      .filter((item: any) => (item.unit || '') || Number(item.quantity) > 0)
      .map((item: any, index: number) => ({
        stt: index + 1,
        xmlName: item.name || item.description || '',
        unit: item.unit || '',
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        discount: Number(item.discount) || 0,
        amount: Number(item.amount) || 0,
        product: null,
        candidates: [],
        matchScore: 0,
        needsReview: true
      }));

    const parsed: ParsedPurchaseInvoice = {
      lines,
      sellerName: invoice.sellerName || '',
      invoiceNumber: `${invoice.invoiceSymbol || ''}${invoice.invoiceNo || ''}`.trim()
    };
    log('[KVPurchaseOrder] parsed:', parsed.lines.length, 'dòng, NCC:', parsed.sellerName);
    return parsed;
  }

  // ============ 2. Khớp sản phẩm / nhà cung cấp ============

  /**
   * Tìm SP trên KiotViet theo từ khóa (dùng cho auto-match và ô tìm tay).
   */
  searchProducts(term: string): Promise<KiotVietPurchaseProduct[]> {
    return this.kiotvietService.autocompletePurchaseProducts(term);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Tìm SP có retry khi gặp lỗi mạng tạm thời ("Failed to fetch" — KiotViet chặn khi bắn dồn).
   */
  private async searchProductsWithRetry(term: string, attempts = 3): Promise<KiotVietPurchaseProduct[]> {
    let lastError: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await this.searchProducts(term);
      } catch (error: any) {
        lastError = error;
        const isNetwork = error?.name === 'TypeError' || /failed to fetch|networkerror|load failed/i.test(error?.message || '');
        if (!isNetwork || i === attempts - 1) throw error;
        await this.delay(400 * (i + 1)); // backoff 0.4s, 0.8s
      }
    }
    throw lastError;
  }

  /**
   * Tự khớp từng dòng XML với SP KiotViet theo tên hàng + ĐƠN VỊ.
   * Autocomplete KiotViet trả mỗi đơn vị 1 row cùng ProductName (vd "...(ly)", "...(thùng)"),
   * nên phải chọn đúng row có Unit khớp ĐVT trên hóa đơn — nếu không sẽ nhập nhầm đơn vị gốc.
   * CHỈ auto-chọn khi trùng tên 100% VÀ đúng đơn vị; còn lại để user xác nhận trong dialog review.
   */
  async autoMatchLines(lines: PurchaseLine[]): Promise<void> {
    for (const line of lines) {
      if (!line.xmlName) continue;
      line.searching = true;
      try {
        const results = await this.searchProductsWithRetry(line.xmlName);
        line.candidates = results || [];
        const best = this.pickBestMatch(line.xmlName, line.unit, line.candidates);

        // Ưu tiên lựa chọn user đã ghi nhớ trước đó (theo tên + đơn vị)
        const saved = this.getSavedMatch(line.xmlName, line.unit);
        if (saved) {
          line.product = saved;
          if (!line.candidates.some(c => c.Id === saved.Id)) {
            line.candidates = [saved, ...line.candidates];
          }
        } else if (best.score >= 1 && best.unitMatch) {
          // Chỉ tự nhận khi tên khớp tuyệt đối VÀ đơn vị khớp
          line.product = best.product;
        } else {
          line.product = null; // tên khớp nhưng sai/thiếu đơn vị → cần user kiểm tra
        }
        line.matchScore = line.product ? this.similarity(line.xmlName, line.product.ProductName) : best.score;
        line.needsReview = !line.product;
        log('[KVPurchaseOrder] match:', `${line.xmlName} (${line.unit})`, '→',
          line.product ? `${line.product.Code} [${line.product.Unit}]` : 'KHÔNG KHỚP',
          `(score=${line.matchScore.toFixed(2)}, unitMatch=${best.unitMatch}, saved=${!!saved}, candidates=${line.candidates.length})`);
      } catch (error) {
        logError('[KVPurchaseOrder] autoMatchLines error:', line.xmlName, error);
        line.candidates = [];
        line.product = null;
        line.matchScore = 0;
        line.needsReview = true;
      } finally {
        line.searching = false;
      }
    }
  }

  /** Gán SP đã chọn (từ dialog review) cho 1 dòng + ghi nhớ vào localStorage cho lần sau */
  setLineProduct(line: PurchaseLine, product: KiotVietPurchaseProduct | null): void {
    line.product = product;
    line.needsReview = !product;
    line.matchScore = product ? this.similarity(line.xmlName, product.ProductName) : 0;
    if (product && !line.candidates.some(c => c.Id === product.Id)) {
      line.candidates = [product, ...line.candidates];
    }
    this.saveMatch(line.xmlName, line.unit, product);
  }

  /**
   * Chọn candidate tốt nhất: ưu tiên khớp ĐƠN VỊ, sau đó tới độ giống tên.
   * Trả về `unitMatch` để caller quyết định auto-nhận hay đưa vào review.
   */
  private pickBestMatch(
    name: string,
    unit: string,
    results: KiotVietPurchaseProduct[]
  ): { product: KiotVietPurchaseProduct | null; score: number; unitMatch: boolean } {
    if (!results?.length) return { product: null, score: 0, unitMatch: false };
    const targetUnit = this.normalizeUnit(unit);
    let best: { product: KiotVietPurchaseProduct | null; score: number; unitMatch: boolean; rank: number } =
      { product: null, score: -1, unitMatch: false, rank: -Infinity };
    for (const p of results) {
      const nameSim = this.similarity(name, p.ProductName);
      const unitMatch = !!targetUnit && this.normalizeUnit(p.Unit) === targetUnit;
      // Đơn vị khớp có trọng số áp đảo (+2) để chọn đúng row đơn vị dù tên giống nhau
      const rank = nameSim + (unitMatch ? 2 : 0);
      if (rank > best.rank) best = { product: p, score: nameSim, unitMatch, rank };
    }
    return { product: best.product, score: best.score, unitMatch: best.unitMatch };
  }

  /** Độ giống tên hàng (0..1): 1 = trùng tuyệt đối, còn lại dùng Dice coefficient trên bigram */
  similarity(a: string, b: string): number {
    const normalize = (v: string) => (v || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const s1 = normalize(a);
    const s2 = normalize(b);
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const bigrams = (s: string) => {
      const set = new Set<string>();
      for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
      return set;
    };
    const b1 = bigrams(s1);
    const b2 = bigrams(s2);
    if (!b1.size || !b2.size) return 0;

    let common = 0;
    b1.forEach(g => { if (b2.has(g)) common++; });
    return (2 * common) / (b1.size + b2.size);
  }

  /**
   * Tìm nhà cung cấp theo tên người bán trên XML.
   */
  async matchSupplier(sellerName: string): Promise<KiotVietSupplier | null> {
    if (!sellerName) return null;
    try {
      const suppliers = await this.kiotvietService.autocompleteSuppliers(sellerName);
      const supplier = suppliers?.[0] || null;
      log('[KVPurchaseOrder] supplier:', sellerName, '→', supplier?.Name || 'KHÔNG KHỚP');
      return supplier;
    } catch (error) {
      logError('[KVPurchaseOrder] matchSupplier error:', error);
      return null;
    }
  }

  // ============ 3. Gửi phiếu nhập ============

  /**
   * Tạo phiếu nhập trên KiotViet.
   * @param complete false = Lưu tạm (Phiếu tạm), true = Hoàn thành
   */
  async createPurchaseOrder(
    lines: PurchaseLine[],
    supplier: KiotVietSupplier | null,
    invoiceNumber: string,
    complete: boolean
  ): Promise<any> {
    const matched = lines.filter(l => l.product);
    if (!matched.length) throw new Error('Không có sản phẩm nào khớp với KiotViet');

    const payload = this.buildPayload(matched, supplier, invoiceNumber, complete);
    log('[KVPurchaseOrder] createPurchaseOrder:', { complete, lines: matched.length, payload });

    try {
      const result = await this.kiotvietService.createPurchaseOrder(payload);
      if (!result?.Id) {
        // KiotViet trả 200 nhưng không tạo được phiếu
        throw new Error(this.extractKiotVietError(result) || 'KiotViet không trả về mã phiếu nhập');
      }
      log('[KVPurchaseOrder] result:', result);
      return result;
    } catch (error: any) {
      const message = this.extractKiotVietError(error) || error?.message || 'Lỗi không xác định';
      logError('[KVPurchaseOrder] createPurchaseOrder failed:', message, error);
      throw new Error(message);
    }
  }

  /**
   * Bóc message lỗi thật của KiotViet.
   * performKiotVietFetchWithRetry throw Error dạng: `HTTP error! status: 400, message: {"ResponseStatus":{...}}`
   * → parse JSON để lấy ResponseStatus.Message / Message thay vì show raw body cho user.
   */
  private extractKiotVietError(source: any): string {
    if (!source) return '';
    if (source instanceof Error && source.message?.includes('KIOTVIET_TOKEN_EXPIRED')) {
      return 'Phiên đăng nhập KiotViet đã hết hạn, vui lòng đăng nhập lại';
    }

    const raw = source instanceof Error ? source.message : source;
    let body: any = raw;

    if (typeof raw === 'string') {
      const jsonStart = raw.indexOf('{');
      if (jsonStart < 0) return raw;
      try {
        body = JSON.parse(raw.slice(jsonStart));
      } catch {
        return raw;
      }
    }

    const responseStatus = body?.ResponseStatus || body?.responseStatus;
    const message =
      responseStatus?.Message ||
      responseStatus?.message ||
      body?.Message ||
      body?.message ||
      responseStatus?.Errors?.[0]?.Message ||
      '';
    return typeof message === 'string' ? message : '';
  }

  private buildPayload(
    lines: PurchaseLine[],
    supplier: KiotVietSupplier | null,
    invoiceNumber: string,
    complete: boolean
  ): any {
    const details = lines.map((line, index) => this.buildDetail(line, index));
    const total = details.reduce((sum, d) => sum + (d.TotalValue || 0), 0);
    const totalQuantity = details.reduce((sum, d) => sum + (d.Quantity || 0), 0);
    const branchId = this.kiotvietService.getBranchId() || PURCHASE_BRANCH.Id;

    const purchaseOrder: any = {
      Uuid: this.generateUUID(),
      PurchaseOrderDetails: details,
      UserId: PURCHASE_USER.Id,
      CompareUserId: PURCHASE_USER.Id,
      User: PURCHASE_USER,
      Description: '',
      CompareSupplierId: 0,
      SubTotal: total,
      Branch: PURCHASE_BRANCH,
      Status: 1,
      StatusValue: 'Phiếu tạm',
      CompareStatusValue: 'Phiếu tạm',
      Discount: 0,
      CompareDiscount: 0,
      DiscountRatio: 0,
      Id: 0,
      UpdatePurchaseId: 0,
      Account: {},
      Total: total,
      TotalQuantity: totalQuantity,
      ExpensesOthersTitle: '',
      ExpensesOthersRtpTitle: '',
      PurchaseOrderExpensesOthers: [],
      PurchaseOrderExpensesOthersRs: [],
      PurchaseOrderExpensesOthersRtp: [],
      MultiPayment: [],
      PurchasePayments: [],
      ExReturnSuppliers: 0,
      ExReturnThirdParty: 0,
      PaidAmount: 0,
      PayingAmount: 0,
      ChangeAmount: -total,
      paymentMethod: 'Cash',
      payments: [{ paymentMethod: 'Cash', PayingAmount: 0 }],
      BalanceDue: total,
      DepositReturn: total,
      OriginTotal: total,
      PricebookDetail: [],
      paymentMethodObj: { Id: 'Cash', Label: 'Tiền mặt' },
      paymentReturnType: 0,
      IsApplyPurchaseTax: true,
      TaxMode: 1,
      IsShowPurchaseTax: false,
      TotalTax: 0,
      TotalPriceAfterTotalTax: total,
      SystemTotalTax: 0,
      OriginalSortOrderIds: details.map(d => d.ProductId),
      BranchId: branchId
    };

    if (supplier) {
      purchaseOrder.Supplier = supplier;
      purchaseOrder.SupplierId = supplier.Id;
      purchaseOrder.disableSupplierMoney = false;
    }
    if (invoiceNumber) {
      purchaseOrder.InvoiceNumberManual = invoiceNumber;
    }

    return {
      PurchaseOrder: purchaseOrder,
      PurchaseOrderLargeData: null,
      Complete: complete,
      CopyFrom: 0,
      PricebookDetail: [],
      IsFinalizedOS: false
    };
  }

  /**
   * Build 1 PurchaseOrderDetail theo đúng shape KiotViet.
   * Price = đơn giá gốc trên HĐ, priceAfterDiscount = đơn giá sau chiết khấu,
   * Cost = giá vốn hiện tại của SP trên KiotViet (KiotViet tự tính lại khi hoàn thành).
   */
  private buildDetail(line: PurchaseLine, index: number): any {
    const p = line.product as KiotVietPurchaseProduct;
    const units = p.ListProductUnit?.length
      ? p.ListProductUnit
      : [{ Id: p.Id, Unit: p.Unit, Code: p.Code, Conversion: 0, MasterUnitId: 0 }];

    const quantity = line.quantity || 0;
    const amount = Math.round(line.amount || 0);
    const priceAfterDiscount = quantity > 0 ? amount / quantity : (line.unitPrice || 0);
    const hasDiscount = (line.discount || 0) > 0;

    const detail: any = {
      ProductId: p.Id,
      ConversionValue: p.ConversionValue || 1,
      Product: {
        Name: `${p.ProductName} `,
        Code: p.Code,
        IsLotSerialControl: p.IsLotSerialControl || false,
        IsBatchExpireControl: p.IsBatchExpireControl || false,
        OnHand: p.OnHand || 0,
        Reserved: p.Reserved || 0,
        ActualReserved: p.ActualReserved || 0
      },
      ProductName: `${p.ProductName} `,
      ProductCode: p.Code,
      Description: '',
      BasePrice: p.BasePrice || 0,
      LatestPurchasePrice: p.LatestPurchasePrice || 0,
      _isNewItem: true,
      Price: line.unitPrice || 0,
      Cost: p.Cost || 0,
      priceAfterDiscount: priceAfterDiscount,
      Quantity: quantity,
      ShowUnit: units.length > 1,
      ListProductUnit: units,
      Units: units,
      Unit: p.Unit,
      SelectedUnit: p.Id,
      OnOrder: p.OnOrder || 0,
      ListProductSerialHavingTrans: [],
      ListProductBatchExpireHavingTrans: [],
      HasVariants: p.HasVariants || false,
      tabIndex: 100,
      ViewIndex: index + 1,
      SelectedTaxId: null,
      TotalValue: amount,
      Stotal: amount,
      Discount: hasDiscount ? line.discount : null,
      Allocation: 0,
      AllocationSuppliers: 0,
      AllocationThirdParty: 0,
      OrderByNumber: index
    };

    if (p.Image) detail.Image = p.Image;
    if (hasDiscount) {
      detail.DiscountValue = line.discount;
      detail.DiscountType = 'VND';
      detail.DiscountRatio = null;
      detail.adjustedPrice = priceAfterDiscount;
    }

    return detail;
  }

  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
}
