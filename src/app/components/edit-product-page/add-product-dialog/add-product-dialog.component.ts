import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BaseUnitDialogComponent } from './add-product-dialog-base-unit.component';
import { UnitDialogComponent } from './add-product-dialog-unit.component';
import { AttributeDialogComponent } from './add-product-dialog-attribute.component';
import { AddTrademarkDialogComponent } from './add-trademark-dialog.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { KiotvietService } from '../../../services/kiotviet.service';
import { ProductService } from '../../../services/product.service';

export interface ProductUnit {
  name: string;
  price: number;
  conversion: number;
  isBase: boolean;
}

export interface ProductAttribute {
  name: string;
  values: string[];
}

export interface GeneratedProduct {
  Id: number;
  Code: string;
  Name: string;
  FullName: string;
  CategoryId: number | null;
  isActive: boolean;
  isDeleted: boolean;
  isClone: boolean;
  Cost: number;
  BasePrice: number;
  OnHand: number;
  OnHandNV: number;
  Unit: string;
  MasterUnitId: number | null;
  MasterProductId: number | null;
  ConversionValue: number;
  Description: string;
  IsRewardPoint: boolean;
  ModifiedDate: string;
  Image: string | null;
  CreatedDate: string;
  ProductAttributes: any[];
  NormalizedName: string;
  NormalizedCode: string;
  OrderTemplate: string;
  TradeMarkId: number | null;
  TradeMarkName: string | null;
  Tax: number;
  // ✅ Thêm fields để group child units với master
  ParentCode?: string;           // Code của master product
  OriginalCode?: string;         // Code gốc (giống Code khi tạo mới)
  CloneSourceId?: string;        // ID của product gốc (để sync giữa master/child)
  CloneMasterSourceId?: string;  // ID của master product gốc
  KiotVietSync?: boolean;        // false = không sync với KiotViet
}

@Component({
  selector: 'app-add-product-dialog',
  standalone: true,
  templateUrl: './add-product-dialog.component.html',
  styleUrls: ['./add-product-dialog.component.css'],
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ]
})
export class InputProductDialogComponent implements OnInit {
  selectedTab: 'info' | 'desc' = 'info';
  
  product: any = {
    code: '',
    name: '',
    description: '',
    OrderTemplate: '',
    group: null,
    brand: null,
    cost: 0,
    price: 0,
    stock: 0,
    tax: 0,
    minStock: 0,
    maxStock: 999999999,
    location: '',
    weight: 0
  };

  productUnits: ProductUnit[] = [];
  productAttributes: ProductAttribute[] = [];

  groups: Array<any> = [];
  loadingCategories = false;
  saving = false;
  saveError = '';

  trademarks: Array<{ id: number; name: string }> = [];
  loadingTrademarks = false;

  // Search filters
  groupSearchText = '';
  trademarkSearchText = '';

  imageDataUrl: string | null = null;

  // Properties for formatted currency inputs
  productCostFormatted: string = '0';
  productPriceFormatted: string = '0';

  constructor(
    private dialogRef: MatDialogRef<InputProductDialogComponent>,
    private dialog: MatDialog,
    private kiotvietService: KiotvietService,
    private productService: ProductService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.loadTrademarks();

    // Initialize formatted currency values
    this.formatCostOnBlur();
    this.formatPriceOnBlur();
  }

  // --- Currency Input Formatting Handlers ---

  /**
   * Handles user input for the cost field with realtime formatting.
   * Format ngay khi user nhập: 20000 -> 20,000
   * @param value The string value from the input field.
   */
  onCostChange(value: string): void {
    // Remove tất cả ký tự không phải số
    const cleanValue = value.replace(/[^0-9]/g, '');
    const numericValue = parseInt(cleanValue, 10);
    this.product.cost = isNaN(numericValue) ? 0 : numericValue;

    // Format realtime với dấu phẩy ngăn cách hàng nghìn
    this.productCostFormatted = this.product.cost > 0
      ? this.product.cost.toLocaleString('en-US')
      : '';
  }

  /**
   * Formats the cost input field when the user leaves the field.
   */
  formatCostOnBlur(): void {
    const value = this.product.cost || 0;
    this.productCostFormatted = value > 0
      ? value.toLocaleString('en-US')
      : '0';
  }

  /**
   * Handles user input for the price field with realtime formatting.
   * Format ngay khi user nhập: 20000 -> 20,000
   * @param value The string value from the input field.
   */
  onPriceChange(value: string): void {
    // Remove tất cả ký tự không phải số
    const cleanValue = value.replace(/[^0-9]/g, '');
    const numericValue = parseInt(cleanValue, 10);
    this.product.price = isNaN(numericValue) ? 0 : numericValue;

    // Format realtime với dấu phẩy ngăn cách hàng nghìn
    this.productPriceFormatted = this.product.price > 0
      ? this.product.price.toLocaleString('en-US')
      : '';
  }

  /**
   * Formats the price input field when the user leaves the field.
   */
  formatPriceOnBlur(): void {
    const value = this.product.price || 0;
    this.productPriceFormatted = value > 0
      ? value.toLocaleString('en-US')
      : '0';
  }

  // --- End Currency Handlers ---

  async loadCategories(): Promise<void> {
    try {
      this. loadingCategories = true;
      const categories = await this. kiotvietService.getCategories();
      this.groups = categories.map(cat => ({
        id: cat.Id,
        name: cat.Name,
        path: cat.Path
      }));
      console.log(`✅ Đã tải ${this.groups.length} categories`);
    } catch (error) {
      console.error('❌ Error loading categories:', error);
      this.groups = [];
    } finally {
      this.loadingCategories = false;
    }
  }

  async loadTrademarks(): Promise<void> {
    try {
      this.loadingTrademarks = true;
      const trademarkList = await this.kiotvietService.getTrademarks();
      this.trademarks = trademarkList.map((t: any) => ({
        id: t.Id,
        name: t.Name
      }));
      console.log(`✅ Đã tải ${this.trademarks.length} trademarks`);
    } catch (error) {
      console.error('❌ Error loading trademarks:', error);
      this.trademarks = [];
    } finally {
      this.loadingTrademarks = false;
    }
  }

  openAddTrademark(): void {
    const dialogRef = this.dialog.open(AddTrademarkDialogComponent, {
      width: '400px',
      disableClose: true
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result && result.saved && result.trademark) {
        // Add the new trademark to the list
        const newTrademark = {
          id: result.trademark.Id,
          name: result.trademark.Name
        };
        this.trademarks.push(newTrademark);
        // Auto-select the newly created trademark
        this.product.brand = newTrademark;
        console.log('✅ Đã thêm thương hiệu mới:', newTrademark);
      }
    });
  }

  compareTrademarks(t1: any, t2: any): boolean {
    return t1 && t2 ? t1.id === t2.id : t1 === t2;
  }

  get filteredGroups(): Array<any> {
    if (!this.groupSearchText.trim()) {
      return this.groups;
    }
    const search = this.groupSearchText.toLowerCase().trim();
    return this.groups.filter(g => g.name.toLowerCase().includes(search));
  }

  get filteredTrademarks(): Array<{ id: number; name: string }> {
    if (!this.trademarkSearchText.trim()) {
      return this.trademarks;
    }
    const search = this.trademarkSearchText.toLowerCase().trim();
    return this.trademarks.filter(t => t.name.toLowerCase().includes(search));
  }

  onGroupDropdownOpened(): void {
    this.groupSearchText = '';
  }

  onTrademarkDropdownOpened(): void {
    this.trademarkSearchText = '';
  }

  /**
   * Generate unique product ID using current timestamp (seconds)
   */
  private generateProductId(): number {
    return Math.floor(Date. now() / 1000);
  }

  /**
   * Generate normalized string for search (remove diacritics, uppercase)
   */
  private normalizeString(str: string): string {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_');
  }

  /**
   * Generate all product variants based on units and attributes
   */
  generateAllProducts(): GeneratedProduct[] {
    const now = new Date(). toISOString();
    const baseId = this.generateProductId();
    const generatedProducts: GeneratedProduct[] = [];

    // Validate required fields
    if (! this.product.code || !this.product.name) {
      throw new Error('Mã hàng và tên hàng là bắt buộc');
    }

    if (this.productUnits.length === 0) {
      throw new Error('Cần có ít nhất một đơn vị tính');
    }

    // Get base unit
    const baseUnit = this.productUnits.find(u => u.isBase);
    if (!baseUnit) {
      throw new Error('Cần có đơn vị cơ bản');
    }

    // Collect all units (base + others)
    const allUnits = this.productUnits;

    // Collect all attribute combinations
    const attributeCombinations = this. generateAttributeCombinations();

    let productIndex = 0;

    // ✅ Lưu master code để truyền cho child units
    const masterCode = this.product.code;

    // If no attributes, just create products for each unit
    if (attributeCombinations.length === 0) {
      for (const unit of allUnits) {
        const productId = baseId + productIndex;
        const masterId = unit.isBase ? null : baseId;

        const product = this.createProductObject({
          id: productId,
          masterId: masterId,
          masterProductId: null,
          unit: unit,
          attributeValues: [],
          now: now,
          masterCode: masterCode  // ✅ Truyền masterCode
        });

        generatedProducts.push(product);
        productIndex++;
      }
    } else {
      // Create products for each combination of unit × attribute values
      // ✅ FIX: Track master ID cho mỗi attribute combination
      // Mỗi attribute combo có master riêng (base unit), child units phải trỏ về master đó
      for (const attrCombo of attributeCombinations) {
        // ID của master (base unit) cho attribute combination này
        let comboMasterId: number | null = null;
        // Code của master cho attribute combination này
        let comboMasterCode: string | null = null;

        for (const unit of allUnits) {
          const productId = baseId + productIndex;

          let masterUnitId: number | null = null;
          let masterProductId: number | null = null;

          if (unit.isBase) {
            // ✅ Đây là master của attribute combination này
            comboMasterId = productId;
            // Build master code cho combination này
            comboMasterCode = this.product.code;
            if (attrCombo.length > 0) {
              comboMasterCode += `-${attrCombo.map(v => this.normalizeString(v)).join('-')}`;
            }
          } else {
            // ✅ FIX: Child unit phải trỏ về master của CÙNG attribute combination
            masterUnitId = comboMasterId;
          }

          if (attrCombo.length > 0) {
            masterProductId = baseId;
          }

          const product = this.createProductObject({
            id: productId,
            masterId: masterUnitId,
            masterProductId: masterProductId,
            unit: unit,
            attributeValues: attrCombo,
            now: now,
            masterCode: comboMasterCode || masterCode  // ✅ Dùng master code của combo
          });

          // ✅ DEBUG: Log để verify MasterUnitId assignments
          console.log(`📦 Product: ${product.Code}, ID: ${product.Id}, MasterUnitId: ${product.MasterUnitId}, ParentCode: ${product.ParentCode || 'N/A'}, isBase: ${unit.isBase}, comboMasterId: ${comboMasterId}`);

          generatedProducts.push(product);
          productIndex++;
        }
      }
    }

    console.log(`✅ Generated ${generatedProducts. length} products`);
    return generatedProducts;
  }

  /**
   * Generate all combinations of attribute values
   */
  private generateAttributeCombinations(): string[][] {
    if (this.productAttributes.length === 0) {
      return [];
    }

    const attributes = this.productAttributes. filter(attr => attr. values.length > 0);
    if (attributes.length === 0) {
      return [];
    }

    let combinations: string[][] = [[]];

    for (const attr of attributes) {
      const newCombinations: string[][] = [];
      for (const combo of combinations) {
        for (const value of attr.values) {
          newCombinations.push([...combo, value]);
        }
      }
      combinations = newCombinations;
    }

    return combinations;
  }

  /**
   * Create a single product object
   */
  private createProductObject(params: {
    id: number;
    masterId: number | null;
    masterProductId: number | null;
    unit: ProductUnit;
    attributeValues: string[];
    now: string;
    masterCode?: string;  // ✅ Thêm masterCode để link child với master
  }): GeneratedProduct {
    const { id, masterId, masterProductId, unit, attributeValues, now, masterCode } = params;

    // Build full name with unit and attributes
    let fullName = this.product.name;
    if (unit.name && ! unit.isBase) {
      fullName += ` - ${unit.name}`;
    }
    if (attributeValues.length > 0) {
      fullName += ` - ${attributeValues. join(' - ')}`;
    }

    // Build code with unit and attributes
    let code = this.product.code;
    if (! unit.isBase) {
      code += `-${this.normalizeString(unit.name)}`;
    }
    if (attributeValues.length > 0) {
      code += `-${attributeValues.map(v => this. normalizeString(v)).join('-')}`;
    }

    // --- Calculate scaled values for child units ---
    const masterStock = this.product.stock || 0;
    const masterCost = this.product.cost || 0;
    const conversionValue = unit.conversion || 1;
    let onHandNvValue = 0;
    let costValue = 0;

    if (unit.isBase) {
      onHandNvValue = masterStock;
      costValue = masterCost;
    } else {
      // For child units, scale stock and cost
      if (conversionValue > 0) {
        onHandNvValue = masterStock / conversionValue;
      }
      costValue = masterCost * conversionValue;
    }
    // --- End calculation ---

    // Build ProductAttributes array
    const productAttributes: any[] = [];
    if (attributeValues.length > 0) {
      this.productAttributes.forEach((attr, index) => {
        if (attributeValues[index]) {
          productAttributes.push({
            AttributeName: attr.name,
            Value: attributeValues[index]
          });
        }
      });
    }

    // ✅ Xác định ParentCode và CloneSourceId cho child units
    const isChildUnit = !unit.isBase && masterId !== null;
    const parentCode = isChildUnit ? (masterCode || this.product.code) : undefined;

    // ✅ CloneMasterSourceId: Master trỏ về chính nó, Child trỏ về Master
    // Điều này giúp groupProductsByMaster nhận biết relationship
    const cloneMasterSourceId = isChildUnit ? String(masterId) : String(id);
    const cloneSourceId = String(id);

    return {
      Id: id,
      Code: code,
      Name: this.product.name,
      FullName: fullName,
      CategoryId: this.product.group || null,
      isActive: true,
      isDeleted: false,
      isClone: true,  // ✅ Local products behave like clone products - they use OnHandNV, not OnHand
      Cost: costValue,
      BasePrice: unit.price || this.product.price || 0,
      OnHand: 0, // Local products always have OnHand = 0 (not synced with KiotViet)
      OnHandNV: onHandNvValue, // Tồn kho user nhập (scaled for child units)
      Unit: unit.name,
      MasterUnitId: isChildUnit ? masterId : id,  // ✅ Master tự trỏ về mình, Child trỏ về Master
      MasterProductId: masterProductId,
      ConversionValue: unit.conversion || 1,
      Description: this.product.description || '',
      IsRewardPoint: false,
      ModifiedDate: now,
      Image: this.imageDataUrl,
      CreatedDate: now,
      ProductAttributes: productAttributes,
      NormalizedName: this. normalizeString(fullName),
      NormalizedCode: this.normalizeString(code),
      OrderTemplate: this.product.OrderTemplate || '',
      TradeMarkId: this.product.brand?.id || null,
      TradeMarkName: this.product.brand?.name || null,
      Tax: this.product.tax || 0,
      // ✅ Thêm fields để group child units với master
      ParentCode: parentCode,
      OriginalCode: code,
      CloneSourceId: cloneSourceId,
      CloneMasterSourceId: cloneMasterSourceId,
      // ✅ Flag để không sync với KiotViet
      KiotVietSync: false
    } as GeneratedProduct;
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (! input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader. onload = () => {
      this.imageDataUrl = reader.result as string;
    };
    reader. readAsDataURL(file);
  }

  /**
   * ✅ FIXED: Chỉ lưu vào Firebase và IndexedDB, KHÔNG trigger sync từ KiotViet
   */
  async save() {
    try {
      this. saving = true;
      this.saveError = '';

      // 🔍 DEBUG: Log productUnits trước khi generate
      console.log(`🔍 [AddProduct] productUnits trước khi generate: ${this.productUnits.length} đơn vị`);
      this.productUnits.forEach((u, i) => {
        console.log(`   [${i}] name: "${u.name}", isBase: ${u.isBase}, conversion: ${u.conversion}, price: ${u.price}`);
      });

      // Generate all product variants
      const products = this.generateAllProducts();

      console.log(`📦 Saving ${products.length} products to Firebase...`);

      // ✅ Step 1: Lưu vào Firebase qua API /api/firebase/add/products/batch
      // OnHand = 0 (tồn kho KiotViet), OnHandNV = stock (tồn kho user nhập)
      const result = await this.productService.addProducts(products);

      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi khi lưu sản phẩm');
      }

      console.log('✅ Firebase saved:', result);

      // ✅ Step 2: Lưu vào IndexedDB local
      try {
        for (const product of products) {
          // OnHand = 0, OnHandNV = stock đã được set đúng trong createProductObject
          await this.productService.addProductToIndexedDB(product);
        }
        console.log(`✅ IndexedDB saved: ${products.length} products`);
      } catch (dbError) {
        console.warn('⚠️ Lỗi khi lưu vào IndexedDB:', dbError);
        // Không throw error, vì đã lưu thành công vào Firebase
      }

      // ✅ Step 3: Đóng dialog với kết quả - KHÔNG trigger sync
      this.dialogRef.close({ 
        saved: true, 
        products: products,
        count: products.length,
        result: result,
        // ✅ Flag để component cha biết không cần sync
        skipSync: true 
      });

    } catch (error: any) {
      console.error('❌ Error saving products:', error);
      this.saveError = error.message || 'Không thể lưu sản phẩm. Vui lòng kiểm tra mạng và thử lại.';
    } finally {
      this.saving = false;
    }
  }

  // Open base unit dialog
  openAddBaseUnit() {
    const dialogRef = this.dialog.open(BaseUnitDialogComponent, {
      width: '450px',
      minHeight: '300px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      data: { defaultPrice: this.product.price }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const base: ProductUnit = { 
          name: res.name, 
          price: Number(res.price || 0), 
          conversion: 1, 
          isBase: true 
        };
        this.productUnits = [base];
      }
    });
  }

  openAddUnit() {
    console.log('🔍 [AddProduct] openAddUnit() called. Current productUnits:', this.productUnits.length, this.productUnits.map(u => u.name));
    const base = this.productUnits.find(u => u.isBase);
    if (! base) {
      console.warn('⚠️ [AddProduct] Không tìm thấy đơn vị cơ bản, không thể thêm đơn vị mới');
      return;
    }
    const dialogRef = this. dialog.open(UnitDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      disableClose: true,
      data: { baseName: base.name }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      console.log('🔍 [AddProduct] UnitDialog closed with:', res);
      if (res && res.saved) {
        const unit: ProductUnit = {
          name: res.name,
          conversion: Number(res.conversionValue || 1),
          price: Number(res.price || base.price),
          isBase: false
        };
        this.productUnits.push(unit);
        console.log(`✅ [AddProduct] Đã thêm đơn vị "${unit.name}" (quy đổi: ${unit.conversion}). Tổng: ${this.productUnits.length} đơn vị`);
      }
    });
  }

  selectTab(tab: 'info' | 'desc') {
    this.selectedTab = tab;
  }

  removeUnit(index: number) {
    if (index < 0 || index >= this.productUnits.length) return;
    this. productUnits.splice(index, 1);
  }

  openAddAttribute() {
    const dialogRef = this. dialog.open(AttributeDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container'
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const attribute: ProductAttribute = { 
          name: res.attributeName, 
          values: res.values 
        };
        this.productAttributes. push(attribute);
      }
    });
  }

  removeAttribute(index: number) {
    if (index < 0 || index >= this.productAttributes.length) return;
    this.productAttributes. splice(index, 1);
  }
}