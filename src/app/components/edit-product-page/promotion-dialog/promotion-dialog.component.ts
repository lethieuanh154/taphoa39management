import { Component, Inject, OnInit } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormControl } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { Observable } from 'rxjs';
import { map, startWith, debounceTime } from 'rxjs/operators';
import { Promotion, GiftEntry } from '../../../models/promotion.model';
import { PromotionService } from '../../../services/promotion.service';
import { environment } from '../../../../environments/environment';
import { IndexedDBService } from '../../../services/indexed-db.service';
import { SALES_DB_NAME, SALES_DB_VERSION } from '../../../services/sales-db.config';

export interface PromotionDialogData {
  mode: 'create' | 'edit';
  promotion?: Promotion;
}

interface ProductOption {
  Id: number;
  Code: string;
  Name: string;
  Image: string;
  Cost: number;
  BasePrice: number;
}

interface GiftEntryUI {
  product: ProductOption | null;
  quantity: number;
  searchControl: FormControl;
  filteredProducts: Observable<ProductOption[]>;
}

@Component({
  selector: 'promotion-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatRadioModule,
    MatAutocompleteModule,
    MatSnackBarModule,
    MatSlideToggleModule,
    MatButtonToggleModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  templateUrl: './promotion-dialog.component.html',
  styleUrls: ['./promotion-dialog.component.css'],
})
export class PromotionDialogComponent implements OnInit {
  mode: 'create' | 'edit' = 'create';
  isLoading = false;

  // Form fields
  name = '';
  promoType: 'gift' | 'directDiscount' | 'buyAGetB' = 'gift';
  discountMode: '%' | 'VND' = '%';

  minQuantity = 1;
  discountPercent: number | null = null;
  discountAmount: number | null = null;
  giftQuantity = 1;  // kept for Type 3 (buyAGetB SP B quantity)
  fromDate: Date | null = null;
  toDate: Date | null = null;
  isEnabled = true;

  // Target product search
  targetSearchControl = new FormControl('');
  targetFilteredProducts!: Observable<ProductOption[]>;
  selectedTargetProduct: ProductOption | null = null;

  // Gift entries array (Type 1: gift) — supports N gift products
  giftEntries: GiftEntryUI[] = [];

  // Discount product search (Type 3: buy A get B)
  discountProductSearchControl = new FormControl('');
  discountProductFilteredProducts!: Observable<ProductOption[]>;
  selectedDiscountProduct: ProductOption | null = null;

  // Products from IndexedDB - separated into regular and KM
  private regularProducts: ProductOption[] = [];
  private kmProducts: ProductOption[] = [];

  private dbName = SALES_DB_NAME;
  private dbVersion = SALES_DB_VERSION;
  private storeName = 'products';

  constructor(
    public dialogRef: MatDialogRef<PromotionDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: PromotionDialogData,
    private promotionService: PromotionService,
    private indexedDBService: IndexedDBService,
    private snackBar: MatSnackBar,
    private http: HttpClient
  ) {}

  async ngOnInit() {
    this.mode = this.data.mode;

    // Load products from IndexedDB
    await this.loadProducts();

    // Setup autocomplete — target (regular products)
    this.targetFilteredProducts = this.targetSearchControl.valueChanges.pipe(
      startWith(''),
      debounceTime(200),
      map(value => this.filterProducts(value || ''))
    );

    // Discount product search (all regular products for Type 3)
    this.discountProductFilteredProducts = this.discountProductSearchControl.valueChanges.pipe(
      startWith(''),
      debounceTime(200),
      map(value => this.filterProducts(value || ''))
    );

    // If editing, populate form
    if (this.mode === 'edit' && this.data.promotion) {
      this.populateForm(this.data.promotion);
    }

    // Set default dates for create mode
    if (this.mode === 'create') {
      this.fromDate = new Date();
      const nextMonth = new Date();
      nextMonth.setMonth(nextMonth.getMonth() + 1);
      this.toDate = nextMonth;
      this.addGiftEntry(); // init first gift entry
    }
  }

  private isKmProduct(p: any): boolean {
    const name = (p.FullName || p.Name || '').toLowerCase();
    return (name.includes('(km)') || name.includes('(KM)')) && (p.Cost === 0 || !p.Cost);
  }

  private isCloneProduct(p: any): boolean {
    if (p.isClone === true) return true;
    if (p.OnHandNV > 0 && (p.OnHand === 0 || !p.OnHand)) return true;
    if (p.KiotVietSync === false) return true;
    return false;
  }

  private async loadProducts() {
    try {
      const products = await this.indexedDBService.getAll<any>(
        this.dbName, this.dbVersion, this.storeName
      );
      const activeProducts = products.filter((p: any) => !p.isDeleted && p.isActive && !this.isCloneProduct(p));

      this.regularProducts = [];
      this.kmProducts = [];

      for (const p of activeProducts) {
        const option: ProductOption = {
          Id: p.Id,
          Code: p.Code || '',
          Name: p.FullName || p.Name || '',
          Image: p.Image || '',
          Cost: p.Cost || 0,
          BasePrice: p.BasePrice || 0,
        };
        if (this.isKmProduct(p)) {
          this.kmProducts.push(option);
        } else {
          this.regularProducts.push(option);
        }
      }
    } catch (e) {
      console.error('Failed to load products from IndexedDB:', e);
    }
  }

  private filterProducts(value: string, kmOnly = false): ProductOption[] {
    const filter = typeof value === 'string' ? value.toLowerCase().trim() : '';
    const products = kmOnly ? this.kmProducts : this.regularProducts;

    if (!filter) return products.slice(0, 50);

    return products.filter(p =>
      p.Name.toLowerCase().includes(filter) ||
      p.Code.toLowerCase().includes(filter)
    ).slice(0, 50);
  }

  displayProductFn(product: ProductOption): string {
    return product ? `${product.Code} - ${product.Name}` : '';
  }

  onTargetProductSelected(product: ProductOption) {
    this.selectedTargetProduct = product;
    this.targetSearchControl.setValue(product as any);
  }

  onGiftProductSelected(product: ProductOption, index: number) {
    this.giftEntries[index].product = product;
    this.giftEntries[index].searchControl.setValue(product as any);
  }

  addGiftEntry(): void {
    const ctrl = new FormControl('');
    const filtered = ctrl.valueChanges.pipe(
      startWith(''),
      debounceTime(200),
      map(value => this.filterProducts(value || '', true))
    );
    this.giftEntries.push({ product: null, quantity: 1, searchControl: ctrl, filteredProducts: filtered });
  }

  removeGiftEntry(index: number): void {
    this.giftEntries.splice(index, 1);
  }

  onDiscountProductSelected(product: ProductOption) {
    this.selectedDiscountProduct = product;
    this.discountProductSearchControl.setValue(product as any);
  }

  private populateForm(promo: Promotion) {
    this.name = promo.name;

    // Xác định promoType từ saved data
    const isGift = promo.hasGift ?? promo.type === 'gift';
    const hadDiscount = (promo.hasPercentDiscount ?? promo.type === 'percentage')
                     || (promo.hasFixedDiscount ?? promo.type === 'fixed_amount');

    if (isGift) {
      this.promoType = 'gift';
    } else if (hadDiscount && promo.giftProductId) {
      this.promoType = 'buyAGetB'; // Type 3: có SP B
    } else if (hadDiscount) {
      this.promoType = 'directDiscount'; // Type 2: không có SP B
    } else {
      this.promoType = 'gift';
    }

    this.discountMode = (promo.hasFixedDiscount ?? promo.type === 'fixed_amount') ? 'VND' : '%';
    this.minQuantity = promo.minQuantity;
    this.discountPercent = promo.discountPercent ?? null;
    this.discountAmount = promo.discountAmount ?? null;
    this.giftQuantity = promo.giftQuantity ?? 1;
    this.fromDate = promo.fromDate ? new Date(promo.fromDate) : null;
    this.toDate = promo.toDate ? new Date(promo.toDate) : null;
    this.isEnabled = promo.isEnabled;

    // Set target product
    this.selectedTargetProduct = {
      Id: Number(promo.targetProductId),
      Code: promo.targetProductCode,
      Name: promo.targetProductName,
      Image: '',
      Cost: 0,
      BasePrice: 0,
    };
    this.targetSearchControl.setValue(this.selectedTargetProduct as any);

    // Set gift entries (Type 1) or discount product B (Type 3)
    if (this.promoType === 'gift') {
      this.giftEntries = [];
      const entries = promo.giftItems && promo.giftItems.length > 0
        ? promo.giftItems
        : promo.giftProductId
          ? [{ productId: promo.giftProductId, code: promo.giftProductCode || '', name: promo.giftProductName || '', basePrice: promo.giftProductBasePrice || 0, quantity: promo.giftQuantity || 1 }]
          : [];
      for (const entry of entries) {
        const ctrl = new FormControl('');
        const filtered = ctrl.valueChanges.pipe(
          startWith(''),
          debounceTime(200),
          map(value => this.filterProducts(value || '', true))
        );
        const productOption: ProductOption = { Id: Number(entry.productId), Code: entry.code, Name: entry.name, Image: '', Cost: 0, BasePrice: entry.basePrice || 0 };
        ctrl.setValue(productOption as any);
        this.giftEntries.push({ product: productOption, quantity: entry.quantity || 1, searchControl: ctrl, filteredProducts: filtered });
      }
      if (this.giftEntries.length === 0) this.addGiftEntry();
    } else if (promo.giftProductId) {
      const productOption: ProductOption = {
        Id: Number(promo.giftProductId),
        Code: promo.giftProductCode || '',
        Name: promo.giftProductName || '',
        Image: '',
        Cost: 0,
        BasePrice: promo.giftProductBasePrice || 0,
      };
      if (this.promoType === 'buyAGetB') {
        this.selectedDiscountProduct = productOption;
        this.discountProductSearchControl.setValue(productOption as any);
      }
    }
  }

  async onSave() {
    // Validate
    if (!this.name.trim()) {
      this.snackBar.open('Vui lòng nhập tên khuyến mại', 'OK', { duration: 3000 });
      return;
    }
    if (!this.selectedTargetProduct) {
      this.snackBar.open('Vui lòng chọn sản phẩm mục tiêu', 'OK', { duration: 3000 });
      return;
    }
    if (this.promoType === 'gift' && (this.giftEntries.length === 0 || this.giftEntries.some(e => !e.product))) {
      this.snackBar.open('Vui lòng chọn đủ sản phẩm tặng', 'OK', { duration: 3000 });
      return;
    }
    if (this.promoType === 'buyAGetB' && !this.selectedDiscountProduct) {
      this.snackBar.open('Vui lòng chọn sản phẩm được giảm giá (SP B)', 'OK', { duration: 3000 });
      return;
    }

    const needsDiscount = this.promoType === 'directDiscount' || this.promoType === 'buyAGetB';
    if (needsDiscount && this.discountMode === '%' && (!this.discountPercent || this.discountPercent <= 0 || this.discountPercent > 100)) {
      this.snackBar.open('Phần trăm giảm giá phải từ 1% đến 100%', 'OK', { duration: 3000 });
      return;
    }
    if (needsDiscount && this.discountMode === 'VND' && (!this.discountAmount || this.discountAmount <= 0)) {
      this.snackBar.open('Số tiền giảm giá phải lớn hơn 0', 'OK', { duration: 3000 });
      return;
    }

    // Build promotion data
    const isGift = this.promoType === 'gift';
    const hasPercentDiscount = needsDiscount && this.discountMode === '%';
    const hasFixedDiscount = needsDiscount && this.discountMode === 'VND';
    const primaryType = isGift ? 'gift' : hasPercentDiscount ? 'percentage' : 'fixed_amount';

    const promoData: Partial<Promotion> = {
      name: this.name.trim(),
      type: primaryType,
      hasGift: isGift,
      hasPercentDiscount,
      hasFixedDiscount,
      targetProductId: String(this.selectedTargetProduct.Id),
      targetProductCode: this.selectedTargetProduct.Code,
      targetProductName: this.selectedTargetProduct.Name,
      minQuantity: this.minQuantity || 1,
      fromDate: this.fromDate ? this.fromDate.toISOString() : '',
      toDate: this.toDate ? new Date(this.toDate.getFullYear(), this.toDate.getMonth(), this.toDate.getDate(), 23, 59, 59).toISOString() : '',
      isEnabled: this.isEnabled,
    };

    // Type 1: Gift — N SP tặng (KM)
    if (isGift && this.giftEntries.length > 0) {
      promoData.giftItems = this.giftEntries.map(e => ({
        productId: String(e.product!.Id),
        code: e.product!.Code,
        name: e.product!.Name,
        basePrice: e.product!.BasePrice || 0,
        quantity: e.quantity || 1,
      } as GiftEntry));
      // Backward compat: scalar fields = first gift entry
      const first = this.giftEntries[0];
      promoData.giftProductId = String(first.product!.Id);
      promoData.giftProductCode = first.product!.Code;
      promoData.giftProductName = first.product!.Name;
      promoData.giftProductBasePrice = first.product!.BasePrice || 0;
      promoData.giftQuantity = first.quantity || 1;
    }

    // Type 3: Buy A Get B — SP B được giảm giá (dùng cùng giftProduct fields)
    if (this.promoType === 'buyAGetB' && this.selectedDiscountProduct) {
      promoData.giftProductId = String(this.selectedDiscountProduct.Id);
      promoData.giftProductCode = this.selectedDiscountProduct.Code;
      promoData.giftProductName = this.selectedDiscountProduct.Name;
      promoData.giftProductBasePrice = this.selectedDiscountProduct.BasePrice || 0;
      promoData.giftQuantity = this.giftQuantity || 1;
    }

    // Type 2: Direct discount — KHÔNG có giftProductId (clear nếu edit từ type khác)
    if (this.promoType === 'directDiscount') {
      promoData.giftProductId = '';
      promoData.giftProductCode = '';
      promoData.giftProductName = '';
      promoData.giftProductBasePrice = 0;
      promoData.giftQuantity = 0;
    }

    if (hasPercentDiscount) {
      promoData.discountPercent = this.discountPercent!;
    }
    if (hasFixedDiscount) {
      promoData.discountAmount = this.discountAmount!;
    }

    this.isLoading = true;

    try {
      let savedPromoId = this.data.promotion?.id;
      if (this.mode === 'create') {
        const res = await this.promotionService.createPromotion(promoData).toPromise();
        savedPromoId = res?.id;
        this.snackBar.open('Tạo khuyến mại thành công!', 'OK', { duration: 3000 });
      } else {
        await this.promotionService.updatePromotion(this.data.promotion!.id, promoData).toPromise();
        this.snackBar.open('Cập nhật khuyến mại thành công!', 'OK', { duration: 3000 });
      }

      // Sync campaign lên KiotViet — chỉ Type 1 (gift) và Type 3 (buy A get B)
      // Type 2 (direct discount) KHÔNG có API KiotViet tương ứng
      if (this.promoType !== 'directDiscount') {
        // Khi edit: gắn existing kiotViet IDs để backend nhận biết đây là update (Campaign.Id > 0)
        if (this.mode === 'edit' && this.data.promotion) {
          const existing = this.data.promotion as any;
          if (existing.kiotVietCampaignId) {
            (promoData as any).kiotVietCampaignId = existing.kiotVietCampaignId;
            (promoData as any).kiotVietCampaignCode = existing.kiotVietCampaignCode;
            (promoData as any).kiotVietSalePromotionId = existing.kiotVietSalePromotionId;
            (promoData as any).kiotVietSalePromotionIds = existing.kiotVietSalePromotionIds;
          }
        }
        await this.syncCampaignToKiotViet(promoData, savedPromoId);
      }

      this.dialogRef.close({ saved: true });
    } catch (err) {
      console.error('Save promotion error:', err);
      this.snackBar.open('Lỗi khi lưu khuyến mại', 'OK', { duration: 3000 });
    } finally {
      this.isLoading = false;
    }
  }

  private async syncCampaignToKiotViet(promoData: Partial<Promotion>, promoId?: string): Promise<void> {
    try {
      const url = `${environment.domainUrl}/api/kiotviet/campaigns`;
      const res = await firstValueFrom(this.http.post<any>(url, { promotion: promoData }));

      if (res.success && res.kiotVietCampaignId) {
        console.log('KiotViet campaign synced:', res.kiotVietCampaignId, 'SalePromoId:', res.kiotVietSalePromotionId);
        this.snackBar.open('Đã đồng bộ KM lên KiotViet', 'OK', { duration: 2000 });

        if (promoId) {
          const kvPromotionType: 5 | 6 = promoData.hasGift ? 6 : 5;
          const update: any = {
            kiotVietCampaignId: res.kiotVietCampaignId,
            kiotVietCampaignCode: res.kiotVietCampaignCode ?? null,
            kiotVietSalePromotionId: res.kiotVietSalePromotionId,
            kiotVietPromotionType: kvPromotionType,
            kiotVietSynced: true,
          };
          if (res.kiotVietSalePromotionIds && Object.keys(res.kiotVietSalePromotionIds).length > 0) {
            update.kiotVietSalePromotionIds = res.kiotVietSalePromotionIds;
          }
          await firstValueFrom(this.promotionService.updatePromotion(promoId, update));
        }
      } else {
        console.warn('KiotViet campaign sync failed:', res);
      }
    } catch (err) {
      console.error('KiotViet campaign sync error:', err);
    }
  }

  onCancel() {
    this.dialogRef.close();
  }
}
