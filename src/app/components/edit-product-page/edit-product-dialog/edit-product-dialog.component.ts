import { Component, OnInit, Inject } from '@angular/core';
import { MatDialog, MAT_DIALOG_DATA } from '@angular/material/dialog';
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
import { EditedProduct } from '../services/product-edit.service';
import { ProductHistoryService } from '../../../services/product-history.service';
import { TrackedField } from '../../../models/product-history.model';
import { UnitDialogComponent } from '../add-product-dialog/add-product-dialog-unit.component';

export interface EditProductDialogData {
  product: EditedProduct;
  childProducts: EditedProduct[];
}

@Component({
  selector: 'app-edit-product-dialog',
  templateUrl: './edit-product-dialog.component.html',
  styleUrls: ['./edit-product-dialog.component.css'],
  standalone: true,
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
export class EditProductDialogComponent implements OnInit {
  selectedTab: 'info' | 'desc' = 'info';

  // Product data for editing
  product: any = {
    id: 0,
    code: '',
    name: '',
    description: '',
    OrderTemplate: '',
    group: null,
    brand: null,
    cost: 0,
    price: 0,
    stock: 0, // This will be OnHandNV
    tax: 0,
    unit: ''
  };

  // Child products for editing
  childProducts: any[] = [];

  groups: Array<any> = [];
  loadingCategories = false;
  saving = false;

  trademarks: Array<{ id: number; name: string }> = [];
  loadingTrademarks = false;

  imageDataUrl: string | null = null;

  // Properties for formatted currency/number inputs
  productCostFormatted: string = '0';
  productPriceFormatted: string = '0';
  productStockFormatted: string = '0';
  productTaxFormatted: string = '0';

  // Original product for reference
  private originalProduct: EditedProduct | null = null;
  private originalChildProducts: EditedProduct[] = [];

  // Track added/removed units
  private removedChildIds: number[] = [];

  constructor(
    private dialogRef: MatDialogRef<EditProductDialogComponent>,
    private dialog: MatDialog,
    private kiotvietService: KiotvietService,
    private productService: ProductService,
    private productHistoryService: ProductHistoryService,
    @Inject(MAT_DIALOG_DATA) public data: EditProductDialogData
  ) {
    this.dialogRef.disableClose = true;
  }

  ngOnInit(): void {
    this.loadCategories();
    this.loadTrademarks();
    this.initializeFromData();
    // Initialize all formatted values after data is loaded
    this.formatAllFieldsOnBlur();
  }

  private initializeFromData(): void {
    if (this.data && this.data.product) {
      this.originalProduct = { ...this.data.product };
      this.originalChildProducts = this.data.childProducts?.map(c => ({ ...c })) || [];

      // Map product data to form
      this.product = {
        id: this.data.product.Id,
        code: this.data.product.Code || '',
        name: this.data.product.Name || '',
        description: this.data.product.Description || '',
        OrderTemplate: this.data.product.OrderTemplate || '',
        group: this.data.product.CategoryId || null,
        brand: this.data.product.TradeMarkId ? {
          id: this.data.product.TradeMarkId,
          name: this.data.product.TradeMarkName || ''
        } : null,
        cost: this.data.product.Cost || 0,
        price: this.data.product.BasePrice || 0,
        stock: this.data.product.OnHandNV || 0, // Edit OnHandNV only
        tax: (this.data.product as any).Tax || 0,
        unit: this.data.product.Unit || ''
      };

      // Map child products and add formatted properties
      this.childProducts = (this.data.childProducts || []).map(child => ({
        id: child.Id,
        code: child.Code || '',
        name: child.Name || '',
        unit: child.Unit || '',
        price: child.BasePrice || 0,
        cost: child.Cost || 0,
        stock: child.OnHandNV || 0, // Edit OnHandNV only
        conversionValue: child.ConversionValue || 1,
        originalOnHandNV: child.OnHandNV || 0,
        // Add formatted properties for children
        priceFormatted: '0',
        costFormatted: '0',
        stockFormatted: '0'
      }));

      // Set image
      this.imageDataUrl = this.data.product.Image || null;
    }
  }

  // --- Start of new formatting methods ---

  private formatAllFieldsOnBlur(): void {
    this.formatCostOnBlur();
    this.formatPriceOnBlur();
    this.formatStockOnBlur();
    this.formatTaxOnBlur();
    this.childProducts.forEach((_, index) => {
        this.formatChildPriceOnBlur(index);
        this.formatChildCostOnBlur(index);
        this.formatChildStockOnBlur(index);
    });
  }

  // Master product cost - realtime formatting
  onCostChange(value: string): void {
    const cleanValue = value.replace(/[^0-9]/g, '');
    this.product.cost = parseInt(cleanValue, 10) || 0;
    this.productCostFormatted = this.product.cost > 0 ? this.product.cost.toLocaleString('en-US') : '';
    this.onMasterCostChange(); // Auto-update child costs
  }
  formatCostOnBlur(): void {
    this.productCostFormatted = this.product.cost > 0 ? this.product.cost.toLocaleString('en-US') : '0';
  }

  // Master product price - realtime formatting
  onPriceChange(value: string): void {
    const cleanValue = value.replace(/[^0-9]/g, '');
    this.product.price = parseInt(cleanValue, 10) || 0;
    this.productPriceFormatted = this.product.price > 0 ? this.product.price.toLocaleString('en-US') : '';
  }
  formatPriceOnBlur(): void {
    this.productPriceFormatted = this.product.price > 0 ? this.product.price.toLocaleString('en-US') : '0';
  }

  // Master product stock (OnHandNV) - realtime formatting (cho phép số thập phân)
  onStockChange(value: string): void {
    const cleanValue = value.replace(/[^0-9.]/g, '');
    this.product.stock = parseFloat(cleanValue) || 0;
    this.productStockFormatted = this.product.stock > 0 ? this.formatDecimalNumber(this.product.stock) : '';
    this.onMasterStockChange(); // Keep original logic
  }
  formatStockOnBlur(): void {
    this.productStockFormatted = this.product.stock > 0 ? this.formatDecimalNumber(this.product.stock) : '0';
  }

  // Master product tax - realtime formatting (cho phép số thập phân)
  onTaxChange(value: string): void {
    const cleanValue = value.replace(/[^0-9.]/g, '');
    this.product.tax = parseFloat(cleanValue) || 0;
    this.productTaxFormatted = this.product.tax > 0 ? this.product.tax.toLocaleString('en-US') : '';
  }
  formatTaxOnBlur(): void {
    this.productTaxFormatted = this.product.tax > 0 ? this.product.tax.toLocaleString('en-US') : '0';
  }

  // Child product price - realtime formatting
  onChildPriceChange(value: string, index: number): void {
    const cleanValue = value.replace(/[^0-9]/g, '');
    this.childProducts[index].price = parseInt(cleanValue, 10) || 0;
    this.childProducts[index].priceFormatted = this.childProducts[index].price > 0
      ? this.childProducts[index].price.toLocaleString('en-US') : '';
  }
  formatChildPriceOnBlur(index: number): void {
    const child = this.childProducts[index];
    child.priceFormatted = child.price > 0 ? child.price.toLocaleString('en-US') : '0';
  }

  // Child product cost - realtime formatting
  onChildCostChange(value: string, index: number): void {
    const cleanValue = value.replace(/[^0-9]/g, '');
    this.childProducts[index].cost = parseInt(cleanValue, 10) || 0;
    this.childProducts[index].costFormatted = this.childProducts[index].cost > 0
      ? this.childProducts[index].cost.toLocaleString('en-US') : '';
  }
  formatChildCostOnBlur(index: number): void {
    const child = this.childProducts[index];
    child.costFormatted = child.cost > 0 ? child.cost.toLocaleString('en-US') : '0';
  }

  // Child product stock - realtime formatting (cho phép số thập phân)
  onChildStockChange(value: string, index: number): void {
    const cleanValue = value.replace(/[^0-9.]/g, '');
    this.childProducts[index].stock = parseFloat(cleanValue) || 0;
    this.childProducts[index].stockFormatted = this.childProducts[index].stock > 0
      ? this.formatDecimalNumber(this.childProducts[index].stock) : '';
  }
  formatChildStockOnBlur(index: number): void {
    const child = this.childProducts[index];
    child.stockFormatted = child.stock > 0 ? this.formatDecimalNumber(child.stock) : '0';
  }

  // --- End of new formatting methods ---

  async loadCategories(): Promise<void> {
    try {
      this.loadingCategories = true;
      const categories = await this.kiotvietService.getCategories();
      this.groups = categories.map(cat => ({
        id: cat.Id,
        name: cat.Name,
        path: cat.Path
      }));
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
    } catch (error) {
      console.error('❌ Error loading trademarks:', error);
      this.trademarks = [];
    } finally {
      this.loadingTrademarks = false;
    }
  }

  compareTrademarks(t1: any, t2: any): boolean {
    return t1 && t2 ? t1.id === t2.id : t1 === t2;
  }

  selectTab(tab: 'info' | 'desc') {
    this.selectedTab = tab;
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      this.imageDataUrl = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  onMasterStockChange(): void {
    const masterStock = this.product.stock || 0;

    if (!this.childProducts || this.childProducts.length === 0) {
      return;
    }

    this.childProducts.forEach((child, index) => {
      const conversionValue = child.conversionValue || 1;
      if (conversionValue > 0) {
        child.stock = masterStock / conversionValue;
        this.formatChildStockOnBlur(index);
      } else {
        child.stock = 0;
      }
    });
  }

  /**
   * Auto-update child costs when master cost changes
   * Child cost = Master cost * conversion value
   */
  onMasterCostChange(): void {
    const masterCost = this.product.cost || 0;

    if (!this.childProducts || this.childProducts.length === 0) {
      return;
    }

    this.childProducts.forEach((child, index) => {
      const conversionValue = child.conversionValue || 1;
      if (conversionValue > 0) {
        child.cost = masterCost * conversionValue;
        this.formatChildCostOnBlur(index);
      } else {
        child.cost = 0;
      }
    });
  }

  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '';
    return Math.round(num).toLocaleString('en-US');
  }

  /**
   * Format số thập phân - giữ tối đa 1 chữ số thập phân nếu có
   */
  formatDecimalNumber(value: number): string {
    if (isNaN(value)) return '0';
    // Làm tròn đến 1 chữ số thập phân
    const rounded = Math.round(value * 10) / 10;
    // Nếu là số nguyên thì không hiển thị .0
    if (rounded % 1 === 0) {
      return rounded.toLocaleString('en-US');
    }
    return rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  /**
   * Track changes for clone products before saving
   */
  private trackCloneProductChanges(): void {
    // Only track if this is a clone product
    if (!this.originalProduct?.isClone) {
      return;
    }

    const masterId = this.originalProduct.MasterUnitId || this.originalProduct.Id;
    const productCode = this.product.code || this.originalProduct.Code || '';
    const productName = this.product.name || this.originalProduct.Name || '';

    // Build old and new product objects for comparison
    const oldProduct = {
      Code: this.originalProduct.Code || '',
      Name: this.originalProduct.Name || '',
      BasePrice: this.originalProduct.BasePrice || 0,
      Cost: this.originalProduct.Cost || 0,
      OnHandNV: this.originalProduct.OnHandNV || 0
    };

    const newProduct = {
      Code: this.product.code || '',
      Name: this.product.name || '',
      BasePrice: this.product.price || 0,
      Cost: this.product.cost || 0,
      OnHandNV: this.product.stock || 0
    };

    // Use compareAndRecord to track all changes
    this.productHistoryService.compareAndRecord(
      masterId,
      productCode,
      productName,
      oldProduct,
      newProduct,
      undefined,
      'edit'
    );

    console.log('📝 Tracked changes for clone product:', {
      masterId,
      productCode,
      oldProduct,
      newProduct
    });
  }

  addUnit(): void {
    const dialogRef = this.dialog.open(UnitDialogComponent, {
      width: '500px',
      minHeight: '350px',
      maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      data: { baseName: this.product.unit }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const conversionValue = Number(res.conversionValue || 1);
        const newChild = {
          id: Date.now(),
          code: this.product.code + '-' + (this.childProducts.length + 1),
          name: this.product.name.replace(/\s*\([^)]*\)\s*$/, '') + ' (' + res.name + ')',
          unit: res.name,
          price: Number(res.price || 0),
          cost: (this.product.cost || 0) * conversionValue,
          stock: conversionValue > 0 ? (this.product.stock || 0) / conversionValue : 0,
          conversionValue: conversionValue,
          originalOnHandNV: 0,
          priceFormatted: '0',
          costFormatted: '0',
          stockFormatted: '0',
          isNew: true
        };
        this.childProducts.push(newChild);
        const idx = this.childProducts.length - 1;
        this.formatChildPriceOnBlur(idx);
        this.formatChildCostOnBlur(idx);
        this.formatChildStockOnBlur(idx);
      }
    });
  }

  removeUnit(index: number): void {
    if (index < 0 || index >= this.childProducts.length) return;
    const child = this.childProducts[index];
    if (!confirm(`Xóa đơn vị "${child.unit}"?`)) return;
    if (!child.isNew) {
      this.removedChildIds.push(child.id);
    }
    this.childProducts.splice(index, 1);
  }

  /**
   * Save edited product - updates OnHandNV only (not OnHand)
   */
  async save() {
    try {
      this.saving = true;

      // Track changes for clone products before saving
      this.trackCloneProductChanges();

      const now = new Date().toISOString();
      const updatedProducts: any[] = [];

      // Update master product
      const masterUpdate: any = {
        Id: this.product.id,
        Code: this.product.code,
        Name: this.product.name,
        FullName: this.product.name,
        Description: this.product.description,
        OrderTemplate: this.product.OrderTemplate,
        CategoryId: this.product.group,
        TradeMarkId: this.product.brand?.id || null,
        TradeMarkName: this.product.brand?.name || null,
        Cost: this.product.cost,
        BasePrice: this.product.price,
        OnHandNV: this.product.stock, // Only update OnHandNV
        Tax: this.product.tax || 0,
        Unit: this.product.unit,
        Image: this.imageDataUrl,
        ModifiedDate: now
      };

      updatedProducts.push(masterUpdate);

      // Separate existing vs new children
      const existingChildren = this.childProducts.filter(c => !c.isNew);
      const newChildren = this.childProducts.filter(c => c.isNew);

      // Update existing child products
      for (const child of existingChildren) {
        const childUpdate: any = {
          Id: child.id,
          Code: child.code,
          Name: child.name,
          BasePrice: child.price,
          Cost: child.cost,
          OnHandNV: child.stock,
          Unit: child.unit,
          Description: this.product.description,
          OrderTemplate: this.product.OrderTemplate,
          ModifiedDate: now
        };
        updatedProducts.push(childUpdate);
      }

      console.log(`📦 Updating ${updatedProducts.length} products...`);

      // Update Firebase (existing products)
      const result = await this.productService.updateProducts(updatedProducts);
      console.log('✅ Firebase updated:', result);

      // Update IndexedDB (existing products)
      for (const product of updatedProducts) {
        try {
          const existing = await this.productService.getProductByIdFromIndexedDB(product.Id);
          if (existing) {
            const merged = {
              ...existing,
              ...product,
              OnHand: existing.OnHand
            };
            await this.productService.updateProductFromIndexedDB(merged);
          }
        } catch (dbError) {
          console.warn('⚠️ Error updating IndexedDB:', dbError);
        }
      }

      // Add new children to Firebase + IndexedDB
      if (newChildren.length > 0) {
        const newProducts = newChildren.map(child => ({
          Id: child.id,
          Code: child.code,
          Name: child.name,
          FullName: child.name,
          Unit: child.unit,
          BasePrice: child.price,
          Cost: child.cost,
          OnHand: 0,
          OnHandNV: child.stock,
          ConversionValue: child.conversionValue,
          MasterUnitId: this.product.id,
          MasterProductId: null,
          CategoryId: this.product.group,
          isClone: true,
          KiotVietSync: false,
          CloneSourceId: this.product.id,
          CloneMasterSourceId: (this.data.product as any).CloneMasterSourceId || this.product.id,
          Image: this.imageDataUrl || '',
          ModifiedDate: now,
          CreatedDate: now
        }));
        try {
          await this.productService.addProducts(newProducts as any);
          for (const p of newProducts) {
            await this.productService.updateProductFromIndexedDB(p as any);
          }
          console.log(`✅ Added ${newProducts.length} new child units`);
        } catch (err) {
          console.error('❌ Error adding new children:', err);
        }
      }

      // Delete removed children from Firebase + IndexedDB
      for (const removedId of this.removedChildIds) {
        try {
          await this.productService.deleteProduct(removedId);
          await this.productService.deleteProductFromIndexedDB(removedId);
          console.log(`🗑️ Deleted child unit ${removedId}`);
        } catch (err) {
          console.error(`❌ Error deleting child ${removedId}:`, err);
        }
      }

      console.log(`✅ IndexedDB updated: ${updatedProducts.length} products`);

      // Close dialog with result
      this.dialogRef.close({
        saved: true,
        products: updatedProducts,
        count: updatedProducts.length,
        addedChildren: newChildren.length,
        removedChildren: this.removedChildIds.length
      });

    } catch (error: any) {
      console.error('❌ Error saving products:', error);
      alert(`Lỗi: ${error.message || 'Không thể lưu sản phẩm'}`);
    } finally {
      this.saving = false;
    }
  }

  cancel() {
    this.dialogRef.close(null);
  }
}
