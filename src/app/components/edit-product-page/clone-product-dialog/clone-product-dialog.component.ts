import { Component, OnInit, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProductService } from '../../../services/product.service';
import { EditedProduct } from '../services/product-edit.service';

export interface CloneProductDialogData {
  product: EditedProduct;
  childProducts: EditedProduct[];
  existingClones?: EditedProduct[];  // Danh sách clone đã tồn tại trong system
}

export interface ClonedProduct {
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
  CloneSourceId: string;        // ID of the original product this was cloned from (self for master, child for child)
  CloneMasterSourceId: string;  // ID of the MASTER original product (for Code/Name sync)
  KiotVietSync: boolean;
  CloneCreatedDate: string;
}

@Component({
  selector: 'app-clone-product-dialog',
  templateUrl: './clone-product-dialog.component.html',
  styleUrls: ['./clone-product-dialog.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule
  ]
})
export class CloneProductDialogComponent implements OnInit {
  // Product data for cloning
  masterProduct: EditedProduct | null = null;
  childProducts: EditedProduct[] = [];
  existingClones: EditedProduct[] = [];  // Clone đã tồn tại

  // Clone configuration
  cloneOnHandNV: number = 0;

  // Preview of products to be created
  previewProducts: {
    code: string;
    name: string;
    unit: string;
    onHandNV: number;
    conversionValue: number;
    alreadyExists: boolean;  // Đánh dấu clone đã tồn tại
    existingCloneId?: number;  // ID của clone đã tồn tại
  }[] = [];

  saving = false;

  constructor(
    private dialogRef: MatDialogRef<CloneProductDialogComponent>,
    private productService: ProductService,
    @Inject(MAT_DIALOG_DATA) public data: CloneProductDialogData
  ) {
    this.dialogRef.disableClose = true;
  }

  ngOnInit(): void {
    this.initializeFromData();
  }

  private initializeFromData(): void {
    if (this.data && this.data.product) {
      this.masterProduct = { ...this.data.product };
      this.childProducts = this.data.childProducts?.map(c => ({ ...c })) || [];
      this.existingClones = this.data.existingClones?.map(c => ({ ...c })) || [];

      // Debug log để verify data received
      console.log('🔍 [CloneDialog] initializeFromData:');
      console.log('  - Master product:', this.masterProduct.Id, this.masterProduct.Code, this.masterProduct.Name);
      console.log('  - Child products received:', this.childProducts.length);
      console.log('  - Child products details:', this.childProducts.map(c => ({ Id: c.Id, Code: c.Code, Unit: c.Unit })));
      console.log('  - Existing clones:', this.existingClones.length);
      console.log('  - Existing clones details:', this.existingClones.map((c: any) => ({
        Id: c.Id,
        Code: c.Code,
        CloneSourceId: c.CloneSourceId,
        MasterUnitId: c.MasterUnitId
      })));

      // Default OnHandNV from master's OnHand or OnHandNV
      this.cloneOnHandNV = this.masterProduct.OnHand || this.masterProduct.OnHandNV || 0;

      this.updatePreview();
    }
  }

  /**
   * Kiểm tra xem clone cho product gốc đã tồn tại chưa
   * Dựa vào CloneSourceId (ID của product gốc)
   */
  private findExistingClone(originalProductId: number): EditedProduct | undefined {
    return this.existingClones.find(clone =>
      String((clone as any).CloneSourceId) === String(originalProductId)
    );
  }

  /**
   * Update preview when OnHandNV changes
   */
  onOnHandNVChange(): void {
    this.updatePreview();
  }

  /**
   * Generate preview of products to be cloned
   * Đánh dấu những clone đã tồn tại
   */
  private updatePreview(): void {
    if (!this.masterProduct) return;

    this.previewProducts = [];
    const masterConversion = this.masterProduct.ConversionValue || 1;

    // Master product preview - kiểm tra đã có clone chưa
    const existingMasterClone = this.findExistingClone(this.masterProduct.Id);
    this.previewProducts.push({
      code: this.masterProduct.Code || '',
      name: this.masterProduct.Name || this.masterProduct.FullName || '',
      unit: this.masterProduct.Unit || '',
      onHandNV: existingMasterClone ? (existingMasterClone.OnHandNV || 0) : this.cloneOnHandNV,
      conversionValue: masterConversion,
      alreadyExists: !!existingMasterClone,
      existingCloneId: existingMasterClone?.Id
    });

    // Child products preview - kiểm tra từng child đã có clone chưa
    for (const child of this.childProducts) {
      const childConversion = child.ConversionValue || 1;
      const childOnHandNV = (this.cloneOnHandNV * masterConversion) / childConversion;

      const existingChildClone = this.findExistingClone(child.Id);
      this.previewProducts.push({
        code: child.Code || '',
        name: child.Name || child.FullName || '',
        unit: child.Unit || '',
        onHandNV: existingChildClone ? (existingChildClone.OnHandNV || 0) : childOnHandNV,
        conversionValue: childConversion,
        alreadyExists: !!existingChildClone,
        existingCloneId: existingChildClone?.Id
      });
    }
  }

  /**
   * Generate a unique product ID.
   * This uses the current timestamp in milliseconds and a random number to ensure a high degree of uniqueness,
   * which is critical for preventing ID collisions when creating multiple clones in quick succession.
   */
  private generateProductId(): number {
    const timestamp = Date.now(); // Milliseconds
    const random = Math.floor(Math.random() * 1000); // Random number between 0-999
    // Combine them and ensure it's an integer. Example: 1678886400000_123
    return parseInt(`${timestamp}${random}`);
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
   * Create clone products from original products
   * Key: Clone child units have SAME Code as original child units
   * CHỈ tạo những clone CHƯA tồn tại (dựa vào CloneSourceId)
   */
  generateCloneProducts(): ClonedProduct[] {
    if (!this.masterProduct) return [];

    console.log('🔄 [generateCloneProducts] Starting...');
    console.log('  - Master product:', this.masterProduct.Id, this.masterProduct.Code);
    console.log('  - Child products to clone:', this.childProducts.length);
    console.log('  - Child products:', this.childProducts.map(c => ({ Id: c.Id, Code: c.Code, Unit: c.Unit })));

    const now = new Date().toISOString();
    let masterCloneId = 0; // Initialize with 0
    const clonedProducts: ClonedProduct[] = [];

    const masterConversion = this.masterProduct.ConversionValue || 1;

    // Kiểm tra master đã có clone chưa
    const existingMasterClone = this.findExistingClone(this.masterProduct.Id);

    // Chỉ tạo master clone nếu CHƯA tồn tại
    if (!existingMasterClone) {
      masterCloneId = this.generateProductId(); // Generate a unique ID for the new master clone
      const masterClone: ClonedProduct = {
        Id: masterCloneId,
        Code: this.masterProduct.Code || '',  // SAME Code as original
        Name: this.masterProduct.Name || '',
        FullName: this.masterProduct.FullName || this.masterProduct.Name || '',
        CategoryId: this.masterProduct.CategoryId || null,
        isActive: true,
        isDeleted: false,
        isClone: true,
        Cost: this.masterProduct.Cost || 0,
        BasePrice: this.masterProduct.BasePrice || 0,
        OnHand: 0,  // Clone has no KiotViet inventory
        OnHandNV: this.cloneOnHandNV,
        Unit: this.masterProduct.Unit || '',
        MasterUnitId: masterCloneId,  // Self-reference for master
        MasterProductId: null,
        ConversionValue: masterConversion,
        Description: this.masterProduct.Description || '',
        IsRewardPoint: false,
        ModifiedDate: now,
        Image: this.masterProduct.Image || null,
        CreatedDate: now,
        ProductAttributes: (this.masterProduct as any).ProductAttributes || [],
        NormalizedName: this.normalizeString(this.masterProduct.FullName || this.masterProduct.Name || ''),
        NormalizedCode: this.normalizeString(this.masterProduct.Code || ''),
        OrderTemplate: this.masterProduct.OrderTemplate || '',
        TradeMarkId: this.masterProduct.TradeMarkId || null,
        TradeMarkName: this.masterProduct.TradeMarkName || null,
        Tax: (this.masterProduct as any).Tax || 0,
        CloneSourceId: String(this.masterProduct.Id),
        CloneMasterSourceId: String(this.masterProduct.Id),  // Master's CloneMasterSourceId points to itself
        KiotVietSync: false,
        CloneCreatedDate: now
      };

      clonedProducts.push(masterClone);
    } else {
      masterCloneId = existingMasterClone.Id; // Use the ID of the existing clone
      console.log(`⏭️ Bỏ qua master clone - đã tồn tại (CloneSourceId: ${this.masterProduct.Id}, ExistingId: ${existingMasterClone.Id})`);
    }

    // Clone child products - CHỈ những child chưa có clone
    for (const child of this.childProducts) {
      const existingChildClone = this.findExistingClone(child.Id);

      // Bỏ qua nếu clone đã tồn tại
      if (existingChildClone) {
        console.log(`⏭️ Bỏ qua child clone - đã tồn tại (CloneSourceId: ${child.Id}, ExistingId: ${existingChildClone.Id})`);
        continue;
      }

      const childConversion = child.ConversionValue || 1;
      const childOnHandNV = (this.cloneOnHandNV * masterConversion) / childConversion;
      const childCloneId = this.generateProductId(); // Generate a unique ID for each child

      const childClone: ClonedProduct = {
        Id: childCloneId, // Use the newly generated unique ID
        Code: child.Code || '',  // SAME Code as original child
        Name: child.Name || '',
        FullName: child.FullName || child.Name || '',
        CategoryId: child.CategoryId || null,
        isActive: true,
        isDeleted: false,
        isClone: true,
        Cost: child.Cost || 0,
        BasePrice: child.BasePrice || 0,
        OnHand: 0,  // Clone has no KiotViet inventory
        OnHandNV: childOnHandNV,
        Unit: child.Unit || '',
        MasterUnitId: masterCloneId,  // Points to master clone (existing or new)
        MasterProductId: null,
        ConversionValue: childConversion,
        Description: child.Description || '',
        IsRewardPoint: false,
        ModifiedDate: now,
        Image: child.Image || null,
        CreatedDate: now,
        ProductAttributes: (child as any).ProductAttributes || [],
        NormalizedName: this.normalizeString(child.FullName || child.Name || ''),
        NormalizedCode: this.normalizeString(child.Code || ''),
        OrderTemplate: child.OrderTemplate || '',
        TradeMarkId: child.TradeMarkId || null,
        TradeMarkName: child.TradeMarkName || null,
        Tax: (child as any).Tax || 0,
        CloneSourceId: String(child.Id),
        CloneMasterSourceId: String(this.masterProduct.Id),  // Child's CloneMasterSourceId points to MASTER original
        KiotVietSync: false,
        CloneCreatedDate: now
      };

      clonedProducts.push(childClone);
    }

    console.log('🔄 [generateCloneProducts] Result:', clonedProducts.length, 'products to create');
    console.log('  - Products:', clonedProducts.map(p => ({ Id: p.Id, Code: p.Code, Unit: p.Unit, MasterUnitId: p.MasterUnitId })));

    return clonedProducts;
  }

  /**
   * Save cloned products to Firebase and IndexedDB
   */
  /**
   * Kiểm tra xem tất cả products đã được clone chưa
   */
  allProductsAlreadyCloned(): boolean {
    if (!this.masterProduct) return false;

    // Kiểm tra master đã có clone chưa
    const existingMasterClone = this.findExistingClone(this.masterProduct.Id);
    if (!existingMasterClone) return false;

    // Kiểm tra tất cả children đã có clone chưa
    for (const child of this.childProducts) {
      const existingChildClone = this.findExistingClone(child.Id);
      if (!existingChildClone) return false;
    }

    return true;
  }

  async save(): Promise<void> {
    if (this.saving) {
      return; // Prevent multiple clicks
    }
    try {
      this.saving = true;

      const products = this.generateCloneProducts();

      if (products.length === 0) {
        // Kiểm tra nếu tất cả đã được clone → thông báo và đóng dialog
        if (this.allProductsAlreadyCloned()) {
          alert('Tất cả sản phẩm đã được clone trước đó. Không cần tạo mới.');
          this.dialogRef.close(null);
          return;
        }
        throw new Error('Không có sản phẩm nào để clone');
      }

      console.log(`📦 Cloning ${products.length} products to Firebase...`);

      // Step 1: Save to Firebase
      const result = await this.productService.addProducts(products);

      if (result.status === 'error') {
        throw new Error(result.message || 'Lỗi khi lưu sản phẩm clone');
      }

      console.log('✅ Firebase saved:', result);

      // Step 2: Save to IndexedDB
      try {
        for (const product of products) {
          await this.productService.addProductToIndexedDB(product);
        }
        console.log(`✅ IndexedDB saved: ${products.length} products`);
      } catch (dbError) {
        console.warn('⚠️ Lỗi khi lưu vào IndexedDB:', dbError);
        // Don't throw, Firebase already saved
      }

      // Step 3: Close dialog with result
      this.dialogRef.close({
        saved: true,
        products: products,
        count: products.length,
        result: result,
        skipSync: true
      });

    } catch (error: any) {
      console.error('❌ Error cloning products:', error);
      alert(`Lỗi: ${error.message || 'Không thể clone sản phẩm'}`);
    } finally {
      this.saving = false;
    }
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '0';
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
}
