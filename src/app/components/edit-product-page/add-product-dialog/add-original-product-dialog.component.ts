import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { BaseUnitDialogComponent } from './add-product-dialog-base-unit.component';
import { UnitDialogComponent } from './add-product-dialog-unit.component';
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
import { ProductUnit } from './add-product-dialog.component';

const TAX_OPTIONS = [
  { label: '0%', value: 0 },
  { label: '5%', value: 5 },
  { label: '8%', value: 8 },
  { label: '10%', value: 10 },
];

@Component({
  selector: 'app-add-original-product-dialog',
  standalone: true,
  templateUrl: './add-original-product-dialog.component.html',
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
export class AddOriginalProductDialogComponent implements OnInit {
  selectedTab: 'info' | 'desc' = 'info';
  taxOptions = TAX_OPTIONS;

  product: any = {
    name: '',
    code: '',
    description: '',
    OrderTemplate: '',
    group: null,
    brand: null,
    cost: 0,
    price: 0,
    stock: 0,
    tax: 0,
  };

  productUnits: ProductUnit[] = [];

  groups: Array<any> = [];
  loadingCategories = false;
  saving = false;
  saveError = '';

  trademarks: Array<{ id: number; name: string }> = [];
  loadingTrademarks = false;

  groupSearchText = '';
  trademarkSearchText = '';

  imageDataUrl: string | null = null;

  productCostFormatted: string = '0';
  productPriceFormatted: string = '0';

  constructor(
    private dialogRef: MatDialogRef<AddOriginalProductDialogComponent>,
    private dialog: MatDialog,
    private kiotvietService: KiotvietService,
    private productService: ProductService
  ) {}

  ngOnInit(): void {
    this.loadCategories();
    this.loadTrademarks();
    this.formatCostOnBlur();
    this.formatPriceOnBlur();
  }

  onCostChange(value: string): void {
    const cleanValue = value.replace(/[^0-9]/g, '');
    const numericValue = parseInt(cleanValue, 10);
    this.product.cost = isNaN(numericValue) ? 0 : numericValue;
    this.productCostFormatted = this.product.cost > 0 ? this.product.cost.toLocaleString('en-US') : '';
  }

  formatCostOnBlur(): void {
    this.productCostFormatted = this.product.cost > 0 ? this.product.cost.toLocaleString('en-US') : '0';
  }

  onPriceChange(value: string): void {
    const cleanValue = value.replace(/[^0-9]/g, '');
    const numericValue = parseInt(cleanValue, 10);
    this.product.price = isNaN(numericValue) ? 0 : numericValue;
    this.productPriceFormatted = this.product.price > 0 ? this.product.price.toLocaleString('en-US') : '';
  }

  formatPriceOnBlur(): void {
    this.productPriceFormatted = this.product.price > 0 ? this.product.price.toLocaleString('en-US') : '0';
  }

  async loadCategories(): Promise<void> {
    try {
      this.loadingCategories = true;
      const categories = await this.kiotvietService.getCategories();
      this.groups = categories.map(cat => ({ id: cat.Id, name: cat.Name, path: cat.Path }));
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
      this.trademarks = trademarkList.map((t: any) => ({ id: t.Id, name: t.Name }));
    } catch (error) {
      console.error('❌ Error loading trademarks:', error);
      this.trademarks = [];
    } finally {
      this.loadingTrademarks = false;
    }
  }

  openAddTrademark(): void {
    const dialogRef = this.dialog.open(AddTrademarkDialogComponent, { width: '400px', disableClose: true });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result && result.saved && result.trademark) {
        const newTrademark = { id: result.trademark.Id, name: result.trademark.Name };
        this.trademarks.push(newTrademark);
        this.product.brand = newTrademark;
      }
    });
  }

  compareTrademarks(t1: any, t2: any): boolean {
    return t1 && t2 ? t1.id === t2.id : t1 === t2;
  }

  get filteredGroups(): Array<any> {
    if (!this.groupSearchText.trim()) return this.groups;
    const search = this.groupSearchText.toLowerCase().trim();
    return this.groups.filter(g => g.name.toLowerCase().includes(search));
  }

  get filteredTrademarks(): Array<{ id: number; name: string }> {
    if (!this.trademarkSearchText.trim()) return this.trademarks;
    const search = this.trademarkSearchText.toLowerCase().trim();
    return this.trademarks.filter(t => t.name.toLowerCase().includes(search));
  }

  onGroupDropdownOpened(): void { this.groupSearchText = ''; }
  onTrademarkDropdownOpened(): void { this.trademarkSearchText = ''; }

  selectTab(tab: 'info' | 'desc') { this.selectedTab = tab; }

  openAddBaseUnit() {
    const dialogRef = this.dialog.open(BaseUnitDialogComponent, {
      width: '450px', minHeight: '300px', maxHeight: '90vh',
      panelClass: 'custom-dialog-container',
      data: { defaultPrice: this.product.price }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const base: ProductUnit = { name: res.name, price: Number(res.price || 0), conversion: 1, isBase: true };
        this.productUnits = [base];
      }
    });
  }

  openAddUnit() {
    const base = this.productUnits.find(u => u.isBase);
    if (!base) return;
    const dialogRef = this.dialog.open(UnitDialogComponent, {
      width: '500px', minHeight: '350px', maxHeight: '90vh',
      panelClass: 'custom-dialog-container', disableClose: true,
      data: { baseName: base.name }
    });
    dialogRef.afterClosed().subscribe((res: any) => {
      if (res && res.saved) {
        const unit: ProductUnit = {
          name: res.name,
          conversion: Number(res.conversionValue || 1),
          price: Number(res.price || base.price),
          isBase: false
        };
        this.productUnits.push(unit);
      }
    });
  }

  removeUnit(index: number) {
    if (index < 0 || index >= this.productUnits.length) return;
    this.productUnits.splice(index, 1);
  }

  onFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => { this.imageDataUrl = reader.result as string; };
    reader.readAsDataURL(file);
  }

  async save() {
    try {
      this.saving = true;
      this.saveError = '';

      if (!this.product.name) throw new Error('Tên hàng là bắt buộc');
      if (this.productUnits.length === 0) throw new Error('Cần có ít nhất một đơn vị tính');
      const baseUnit = this.productUnits.find(u => u.isBase);
      if (!baseUnit) throw new Error('Cần có đơn vị cơ bản');

      const payload = {
        name: this.product.name,
        code: this.product.code || '',
        categoryId: this.product.group || null,
        trademarkId: this.product.brand?.id || null,
        taxRate: this.product.tax || 0,
        description: this.product.description || '',
        orderTemplate: this.product.OrderTemplate || '',
        units: this.productUnits.map(u => ({
          unit: u.name,
          price: u.price || this.product.price || 0,
          cost: u.isBase ? (this.product.cost || 0) : ((this.product.cost || 0) * (u.conversion || 1)),
          conversion: u.conversion || 1,
          onHand: u.isBase ? (this.product.stock || 0) : Math.floor((this.product.stock || 0) / (u.conversion || 1)),
          isBase: u.isBase
        }))
      };

      console.log('📦 Calling KiotViet addmany...', payload);
      const result = await this.kiotvietService.addOriginalProductsToKiotViet(payload);

      if (!result || result.error) {
        throw new Error(result?.error || 'Lỗi khi tạo hàng hóa trên KiotViet');
      }

      const createdProducts: any[] = result.Data || [];
      console.log(`✅ KiotViet created ${createdProducts.length} products`);

      // Save returned products to Firebase + IndexedDB
      if (createdProducts.length > 0) {
        const now = new Date().toISOString();
        const payloadUnitMap = new Map(payload.units.map((u: any) => [u.unit, u]));
        const firebaseProducts = createdProducts.map((p: any) => ({
          Id: p.Id,
          Code: p.Code,
          Name: p.Name,
          FullName: p.FullName || p.Name,
          CategoryId: p.CategoryId || null,
          isActive: p.isActive !== false,
          isDeleted: false,
          isClone: false,
          Cost: this.getUnitCost(p, payload.units),
          BasePrice: p.BasePrice,
          OnHand: (p.OnHand != null && p.OnHand > 0) ? p.OnHand : (payloadUnitMap.get(p.Unit)?.onHand ?? 0),
          OnHandNV: 0,
          Unit: p.Unit,
          MasterUnitId: p.MasterUnitId || null,
          MasterProductId: p.MasterProductId || null,
          ConversionValue: p.ConversionValue || 1,
          Description: payload.description,
          IsRewardPoint: p.IsRewardPoint !== false,
          ModifiedDate: now,
          Image: this.imageDataUrl,
          CreatedDate: p.CreatedDate || now,
          ProductAttributes: p.ProductAttributes || [],
          NormalizedName: '',
          NormalizedCode: '',
          OrderTemplate: payload.orderTemplate,
          TradeMarkId: p.TradeMarkId || null,
          TradeMarkName: p.TradeMarkName || null,
          Tax: payload.taxRate,
          KiotVietSync: true
        }));

        // Firebase: exclude image (base64 can exceed Firestore 1MB limit)
        const firebaseProductsNoImage = firebaseProducts.map(({ Image, ...rest }: any) => rest);
        try {
          await this.productService.addProducts(firebaseProductsNoImage);
          console.log('✅ Firebase saved');
        } catch (fbErr) {
          console.warn('⚠️ Firebase save error:', fbErr);
        }

        for (const fp of firebaseProducts) {
          try {
            await this.productService.addProductToIndexedDB(fp);
          } catch (dbErr) {
            console.warn('⚠️ IndexedDB save error:', dbErr);
          }
        }
        console.log('✅ IndexedDB saved');
      }

      this.dialogRef.close({ saved: true, products: createdProducts, count: createdProducts.length });

    } catch (error: any) {
      console.error('❌ Error saving original product:', error);
      // Extract error message from KiotViet response (HttpErrorResponse)
      const kvError = error?.error?.ResponseStatus?.Message || error?.error?.Message || error?.error?.error;
      this.saveError = kvError || error.message || 'Không thể tạo hàng hóa. Vui lòng kiểm tra mạng và thử lại.';
    } finally {
      this.saving = false;
    }
  }

  private getUnitCost(kvProduct: any, units: any[]): number {
    const matchedUnit = units.find(u => u.unit === kvProduct.Unit);
    if (matchedUnit) return matchedUnit.cost;
    return this.product.cost || 0;
  }
}
