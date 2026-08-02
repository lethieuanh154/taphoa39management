import { Component, OnInit, OnDestroy, NgZone, ViewChild, ElementRef } from '@angular/core';
import { Observable, Subscription, fromEvent, firstValueFrom } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ProductEditService, EditedProduct, QueryCondition } from './services/product-edit.service';
import { EditedItemDialog } from './edited-products-dialog.component';
import { InputProductDialogComponent } from './add-product-dialog/add-product-dialog.component';
import { AddOriginalProductDialogComponent } from './add-product-dialog/add-original-product-dialog.component';
import { ProductRowComponent, DeleteProductEvent } from './product-row/product-row.component';
import { CdkVirtualScrollViewport, ScrollingModule } from '@angular/cdk/scrolling';
import { InvoiceProcessingDialogComponent } from './invoice-processing-page/invoice-processing-page.component';
import { ProductService } from '../../services/product.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { InvoiceEmailListenerService } from '../../services/invoice-email-listener.service';
import { InvoicePriceUpdateService } from './invoice-processing-page/invoice-price-update.service';
import { ProductHistoryService } from '../../services/product-history.service';
import { PromotionListDialogComponent } from './promotion-list-dialog/promotion-list-dialog.component';
import { ProductQueryDialogComponent } from './product-query-dialog/product-query-dialog.component';
import { KiotVietPurchaseOrderDialogComponent } from './kiotviet-purchase-order-dialog/kiotviet-purchase-order-dialog.component';
import { CrossTabSyncService, ProductOnHandUpdate } from '../../services/cross-tab-sync.service';
import { GroupService } from '../../services/group.service';
import { IndexedDBService } from '../../services/indexed-db.service';
import { SALES_DB_NAME, SALES_DB_VERSION } from '../../services/sales-db.config';
import { Product } from '../../models/product.model';

interface IWindow extends Window {
  webkitSpeechRecognition: any;
}

interface ProductGroup {
  master: EditedProduct;
  children: EditedProduct[];
}

@Component({
  selector: 'edit-product-page-refactored',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatToolbarModule,
    MatButtonModule,
    MatTooltipModule,
    MatDialogModule,
    RouterModule,
    FormsModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatInputModule,
    ReactiveFormsModule,
    MatIconModule,
    ProductRowComponent,
    ScrollingModule,
    MatSnackBarModule
  ],
  templateUrl: './edit-product-page-refactored.component.html',
  styleUrls: [
    './button.component.css',
    './edit-product-page-refactored.component.css'
  ],
})
export class EditProductPageRefactoredComponent implements OnInit, OnDestroy {
  searchControl = new FormControl('');
  filteredOptions!: Observable<{ value: string; Name: string; Image: string; }[]>;
  options: { Name: string; Image: string }[] = [];

  productColors: Record<string, string> = {};
  isLoading = false;
  isFullReloading = false;

  // Barcode scanning
  @ViewChild('barcodeVideo') barcodeVideo!: ElementRef<HTMLVideoElement>;
  isScanning = false;
  private mediaStream: MediaStream | null = null;
  private scanAnimFrame: number | null = null;
  private barcodeDetector: any = null;

  // New: Grouped products for optimized display
  productGroups: ProductGroup[] = [];

  recognition: any;
  showOfflineHint = false;
  hintMessage = '';
  private isNetworkOffline = false;
  private connectivitySubscriptions = new Subscription();
  private crossTabSubscription: Subscription | null = null;

  searchTerm = '';
  userChangedFinalBasePrice: Record<string, boolean> = {};
  pendingCloneSave = false; // true when clone data is displayed but not yet saved

  // Active advanced-query filter (shown as a chip next to the Query button)
  activeQuery: { conditions: QueryCondition[]; limit: number } | null = null;

  // Per-tab snapshot of the displayed list, so a component re-create
  // (auth state flip, Chrome tab discard, reload) doesn't wipe the results.
  private readonly STATE_KEY = 'edit_product_page_state';

  // Index of first-seen timestamps for editing_childProduct_* keys (TTL cleanup)
  private readonly EDIT_META_KEY = 'edit_page_editing_meta';
  private readonly EDIT_TTL_MS = 12 * 60 * 60 * 1000;

  constructor(
    public dialog: MatDialog,
    private ngZone: NgZone,
    private productEditService: ProductEditService,
    private productService: ProductService,
    private snackBar: MatSnackBar,
    private invoiceEmailListener: InvoiceEmailListenerService,
    private invoicePriceUpdateService: InvoicePriceUpdateService,
    private productHistoryService: ProductHistoryService,
    private crossTabSync: CrossTabSyncService,
    private groupService: GroupService,
    private indexedDBService: IndexedDBService
  ) {
    const { webkitSpeechRecognition }: IWindow = (window as unknown) as IWindow;
    this.recognition = new webkitSpeechRecognition();
    this.recognition.lang = 'vi-VN';
    this.recognition.continuous = false;
    this.recognition.interimResults = false;

    this.recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      this.ngZone.run(() => {
        this.searchControl.setValue(transcript);
      });
    };

    this.recognition.onerror = (event: any) => {
      console.error('Lỗi khi nhận giọng nói:', event.error);
    };
  }

  startVoiceInput() {
    this.recognition.start();
  }

  ngOnInit() {
    // Clean up old editing data on component init
    this.cleanOldEditingData();

    this.filteredOptions = this.searchControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filter(value || ''))
    );

    this.searchControl.valueChanges.subscribe(value => {
      const selectedOption = this.options.find(option => option.Name === value);
      if (selectedOption) {
        this.searchTerm = selectedOption.Name;
      }
    });

    this.setupConnectivityHint();
    this.setupInvoiceEmailListener();
    this.setupCrossTabSync();

    // Restore the displayed list last, after searchControl wiring is in place
    this.restoreState();
  }

  /**
   * Restore the displayed product list from sessionStorage.
   * sessionStorage is per-tab, so this survives a component re-create
   * without leaking state between browser tabs.
   */
  private restoreState(): void {
    try {
      const raw = sessionStorage.getItem(this.STATE_KEY);
      if (!raw) return;

      const state = JSON.parse(raw);
      if (!Array.isArray(state?.productGroups) || state.productGroups.length === 0) return;

      this.productGroups = state.productGroups;
      this.searchTerm = state.searchTerm || '';
      this.activeQuery = state.activeQuery || null;
      this.pendingCloneSave = !!state.pendingCloneSave;
      this.productColors = state.productColors || {};

      if (this.searchTerm) {
        this.searchControl.setValue(this.searchTerm, { emitEvent: false });
      }

      console.log(`♻️ Khôi phục ${this.productGroups.length} nhóm sản phẩm từ sessionStorage`);
    } catch (error) {
      console.warn('Không khôi phục được state trang:', error);
    }
  }

  /**
   * Snapshot the displayed list to sessionStorage.
   * Called after every mutation of productGroups.
   */
  private persistState(): void {
    try {
      if (this.productGroups.length === 0) {
        sessionStorage.removeItem(this.STATE_KEY);
        return;
      }

      sessionStorage.setItem(this.STATE_KEY, JSON.stringify({
        productGroups: this.productGroups,
        searchTerm: this.searchTerm,
        activeQuery: this.activeQuery,
        pendingCloneSave: this.pendingCloneSave,
        productColors: this.productColors,
        savedAt: Date.now()
      }));
    } catch (error) {
      // Quota exceeded or circular data - drop the snapshot rather than break the page
      console.warn('Không lưu được state trang:', error);
      try { sessionStorage.removeItem(this.STATE_KEY); } catch { /* ignore */ }
    }
  }

  /**
   * Clean up old editing data from localStorage
   * This prevents localStorage from growing indefinitely
   *
   * IMPORTANT: localStorage is shared by every browser tab of this app.
   * Wiping ALL editing_childProduct_* on init destroyed pending clone/price
   * data belonging to another tab. Now only entries older than EDIT_TTL_MS
   * are removed, tracked via a first-seen index.
   */
  private cleanOldEditingData() {
    try {
      const keysToRemove: string[] = [];
      const now = Date.now();

      let meta: Record<string, number> = {};
      try {
        meta = JSON.parse(localStorage.getItem(this.EDIT_META_KEY) || '{}') || {};
      } catch {
        meta = {};
      }
      const nextMeta: Record<string, number> = {};

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('editing_childProduct_')) continue;

        // Keys never seen before are treated as fresh (just written, possibly by another tab)
        const firstSeen = meta[key] ?? now;
        if (now - firstSeen > this.EDIT_TTL_MS) {
          keysToRemove.push(key);
        } else {
          nextMeta[key] = firstSeen;
        }
      }

      localStorage.setItem(this.EDIT_META_KEY, JSON.stringify(nextMeta));

      // Also clean up old search/grouped data if too many entries
      const searchKeys = Object.keys(localStorage).filter(k => k.startsWith('search_'));

      // Keep only the most recent 10 searches
      if (searchKeys.length > 10) {
        const sortedSearchKeys = searchKeys
          .map(key => ({
            key,
            timestamp: this.getKeyTimestamp(key)
          }))
          .sort((a, b) => b.timestamp - a.timestamp);

        // Remove old searches (keep only latest 10)
        sortedSearchKeys.slice(10).forEach(item => {
          keysToRemove.push(item.key);
          // Also remove corresponding grouped_ data
          const groupedKey = item.key.replace('search_', 'grouped_');
          if (localStorage.getItem(groupedKey)) {
            keysToRemove.push(groupedKey);
          }
        });
      }

      // Remove all marked keys
      keysToRemove.forEach(key => localStorage.removeItem(key));

      if (keysToRemove.length > 0) {
        console.log(`🧹 Cleaned up ${keysToRemove.length} old localStorage entries`);
      }
    } catch (error) {
      console.error('Error cleaning old editing data:', error);
    }
  }

  /**
   * Get timestamp from localStorage key or creation time
   * Fallback to 0 if unable to determine
   */
  private getKeyTimestamp(key: string): number {
    try {
      const data = localStorage.getItem(key);
      if (data) {
        const parsed = JSON.parse(data);
        // If data is an array, check first item's timestamp
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].timestamp) {
          return parsed[0].timestamp;
        }
      }
    } catch (error) {
      // Ignore parsing errors
    }
    return 0;
  }

  ngOnDestroy(): void {
    this.persistState();
    this.connectivitySubscriptions.unsubscribe();
    this.crossTabSubscription?.unsubscribe();
    this.stopBarcodeScan();
    this.invoiceEmailListener.stopListening();
  }

  // ============= BARCODE SCANNING =============

  async startBarcodeScan() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Camera không khả dụng.\nCần truy cập qua HTTPS.');
      return;
    }

    try {
      const { BarcodeDetector } = await import('barcode-detector/pure');
      this.barcodeDetector = new BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code']
      });

      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      });

      this.isScanning = true;

      setTimeout(() => {
        if (this.barcodeVideo?.nativeElement) {
          const video = this.barcodeVideo.nativeElement;
          video.srcObject = this.mediaStream;
          video.onloadedmetadata = () => {
            video.play();
            this.scanLoop(video);
          };
          if (video.readyState >= 1) {
            video.play();
            this.scanLoop(video);
          }
        }
      }, 100);
    } catch (err: any) {
      console.error('[Barcode] Error:', err);
      if (err.name === 'NotAllowedError') {
        alert('Vui lòng cho phép truy cập camera để quét mã vạch.');
      } else {
        alert('Lỗi quét mã vạch: ' + (err.message || String(err)));
      }
      this.stopBarcodeScan();
    }
  }

  private scanLoop(video: HTMLVideoElement) {
    if (!this.isScanning || !this.barcodeDetector) return;

    this.barcodeDetector.detect(video).then((barcodes: any[]) => {
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue;
        console.log('[Barcode] Detected:', code);
        this.stopBarcodeScan();

        // Fill search and trigger search
        this.ngZone.run(() => {
          this.searchControl.setValue(code);
          this.searchTerm = code;
          this.triggerSearchWithCode(code);
        });
        return;
      }
      this.scanAnimFrame = requestAnimationFrame(() => this.scanLoop(video));
    }).catch(() => {
      this.scanAnimFrame = requestAnimationFrame(() => this.scanLoop(video));
    });
  }

  private async triggerSearchWithCode(code: string) {
    this.isLoading = true;
    try {
      const products = await this.productEditService.searchProducts(code, this.productColors);
      this.productGroups = this.groupProductsByMaster(products);
    } catch (error) {
      console.error('Search error:', error);
      this.productGroups = [];
    } finally {
      this.isLoading = false;
      this.persistState();
    }
  }

  stopBarcodeScan() {
    this.isScanning = false;
    if (this.scanAnimFrame) {
      cancelAnimationFrame(this.scanAnimFrame);
      this.scanAnimFrame = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    this.barcodeDetector = null;
  }

  private _filter(value: string): any[] {
    const filterValue = value.toLowerCase();
    const searchKeys = Object.keys(localStorage).filter((key) => key.startsWith('search_'));

    const allGroupedProducts = searchKeys.map((key) => JSON.parse(localStorage.getItem(key) || '[]'));

    this.options = allGroupedProducts.flatMap(product =>
      product.map((item: { Name: any; Image: string; }) => ({
        Name: item.Name,
        Image: item.Image
      }))
    );
    return this.options.filter(option => option.Name.toLowerCase().includes(filterValue));
  }

  async onSearch(event: Event) {
    this.searchTerm = (event.target as HTMLInputElement).value.trim();
    this.activeQuery = null; // text search clears the advanced-query filter

    if (!this.searchTerm) {
      this.productGroups = [];
      this.persistState();
      return;
    }

    this.isLoading = true;

    try {
      const products = await this.productEditService.searchProducts(
        this.searchTerm,
        this.productColors
      );

      // Group products by master
      this.productGroups = this.groupProductsByMaster(products);

      console.log('✅ Grouped products:', this.productGroups.length, 'groups');
    } catch (error) {
      console.error('❌ Search error:', error);
      this.productGroups = [];
    } finally {
      this.isLoading = false;
      this.persistState();
    }
  }

  /**
   * Group products by MasterUnitId (for originals) or CloneMasterSourceId (for clones)
   * Master = product with MasterUnitId === null OR MasterUnitId === Id (self-reference, e.g., clones)
   * Children = products with MasterUnitId === master.Id OR same CloneMasterSourceId (for clones)
   *
   * IMPORTANT: Clone products (isClone=true) are treated as SEPARATE groups from originals,
   * even if they have the same Code. This ensures both appear in search results.
   *
   * FIX: Clone children are grouped by CloneMasterSourceId instead of MasterUnitId
   * because MasterUnitId may point to old/deleted master clone IDs.
   *
   * Returns array of { master, children[] }
   */
  private groupProductsByMaster(products: EditedProduct[]): ProductGroup[] {
    const groups: ProductGroup[] = [];
    const processedIds = new Set<number>();

    // Helper to check if product is a clone
    const isCloneProduct = (p: EditedProduct): boolean => {
      const isClone = (p as any).isClone;
      if (typeof isClone === 'boolean') return isClone;
      if (typeof isClone === 'string') return isClone.toLowerCase() === 'true';
      return false;
    };

    // Helper to get CloneMasterSourceId
    const getCloneMasterSourceId = (p: EditedProduct): string | null => {
      return (p as any).CloneMasterSourceId || null;
    };

    // Helper to get CloneSourceId
    const getCloneSourceId = (p: EditedProduct): string | null => {
      return (p as any).CloneSourceId || null;
    };

    // Build set of IDs that are referenced as MasterUnitId by other products
    // (these products act as masters, even if they themselves have MasterUnitId set - attribute variants)
    const referencedAsMaster = new Set<number>();
    products.forEach(p => {
      if (p.MasterUnitId && Number(p.MasterUnitId) !== Number(p.Id)) {
        referencedAsMaster.add(Number(p.MasterUnitId));
      }
    });

    // ✅ FIX: For clone products with same CloneMasterSourceId, pick the one with smallest ConversionValue as master
    // Group clones by CloneMasterSourceId first to determine the TRUE master
    const cloneGroups = new Map<string, EditedProduct[]>();
    products.forEach(p => {
      if (isCloneProduct(p)) {
        const cmId = getCloneMasterSourceId(p);
        if (cmId) {
          if (!cloneGroups.has(cmId)) {
            cloneGroups.set(cmId, []);
          }
          cloneGroups.get(cmId)!.push(p);
        }
      }
    });

    // Determine true master for each clone group (smallest ConversionValue)
    const trueCloneMasterIds = new Set<number>();
    cloneGroups.forEach((group) => {
      if (group.length <= 1) {
        if (group.length === 1) trueCloneMasterIds.add(group[0].Id);
        return;
      }
      const trueMaster = group.reduce((prev, curr) => {
        const prevConv = Number(prev?.ConversionValue ?? Infinity);
        const currConv = Number(curr?.ConversionValue ?? Infinity);
        return currConv < prevConv ? curr : prev;
      }, group[0]);
      trueCloneMasterIds.add(trueMaster.Id);
    });

    // First pass: Find all masters
    const masters = products.filter(p => {
      // Original products: MasterUnitId is null or not set
      if (!p.MasterUnitId || p.MasterUnitId === null) {
        return true;
      }
      // ✅ FIX: Clone products - only treat as master if it's the TRUE master (smallest ConversionValue)
      if (isCloneProduct(p)) {
        const cmId = getCloneMasterSourceId(p);
        if (cmId && cloneGroups.has(cmId) && cloneGroups.get(cmId)!.length > 1) {
          return trueCloneMasterIds.has(p.Id);
        }
        // Single clone or no CloneMasterSourceId: use old logic
        if (Number(p.MasterUnitId) === Number(p.Id)) {
          return true;
        }
        const cloneSourceId = getCloneSourceId(p);
        if (cmId && cloneSourceId && cmId === cloneSourceId) {
          return true;
        }
        return false;
      }
      // Clone products: MasterUnitId === Id (self-reference)
      if (Number(p.MasterUnitId) === Number(p.Id)) {
        return true;
      }
      // Attribute variant: has MasterUnitId pointing elsewhere, but other products point to this as master
      if (referencedAsMaster.has(Number(p.Id))) {
        return true;
      }
      return false;
    });

    masters.forEach(master => {
      if (processedIds.has(master.Id)) return;

      const masterIsClone = isCloneProduct(master);
      let children: EditedProduct[] = [];

      if (masterIsClone) {
        // For CLONE products: Group by CloneMasterSourceId OR MasterUnitId
        const masterCloneMasterId = getCloneMasterSourceId(master);
        const masterId = Number(master.Id);

        children = products.filter(p => {
          if (p.Id === master.Id) return false;
          if (processedIds.has(p.Id)) return false;
          if (!isCloneProduct(p)) return false;

          // Match by CloneMasterSourceId (existing clone children)
          if (masterCloneMasterId) {
            const childCloneMasterId = getCloneMasterSourceId(p);
            if (childCloneMasterId === masterCloneMasterId) return true;
          }

          // Fallback: match by MasterUnitId (newly created clone child units without CloneMasterSourceId)
          if (Number(p.MasterUnitId) === masterId && Number(p.MasterUnitId) !== Number(p.Id)) {
            return true;
          }

          return false;
        });
      } else {
        // For ORIGINAL products: Group by MasterUnitId
        const masterId = Number(master.Id);
        children = products.filter(p => {
          if (Number(p.MasterUnitId) !== masterId) return false;
          if (p.Id === master.Id) return false;
          if (processedIds.has(p.Id)) return false;
          if (isCloneProduct(p)) return false;
          // Exclude attribute variants: they are separate masters (have their own children)
          if (referencedAsMaster.has(Number(p.Id))) return false;
          return true;
        });
      }

      // Sort children by ConversionValue (ascending)
      children.sort((a, b) => {
        const convA = Number(a.ConversionValue) || 0;
        const convB = Number(b.ConversionValue) || 0;
        return convA - convB;
      });

      groups.push({
        master: master,
        children: children
      });

      processedIds.add(master.Id);
      children.forEach(c => processedIds.add(c.Id));
    });

    // Handle orphan products (have MasterUnitId but master not in list)
    products.forEach(product => {
      if (!processedIds.has(product.Id)) {
        groups.push({
          master: product,
          children: []
        });
        processedIds.add(product.Id);
      }
    });

    return groups;
  }

  onProductChange(updatedProduct: EditedProduct, groupIndex: number) {
    this.productGroups[groupIndex].master = updatedProduct;
    this.saveToLocalStorage(updatedProduct);
    this.persistState();
  }

  onChildrenChange(updatedChildren: EditedProduct[], groupIndex: number) {
    this.productGroups[groupIndex].children = updatedChildren;
    updatedChildren.forEach(child => this.saveToLocalStorage(child));
    this.persistState();
  }

  /**
   * Handle delete product event from product-row component
   *
   * ✅ FIX: For clone products (isClone=true), use deleteProductWithSiblings()
   * to delete ALL related units (master + children) from Firebase in one call.
   */
  async onDeleteProduct(event: DeleteProductEvent, groupIndex: number) {
    const { product, childProducts } = event;

    // Check if this is a clone product
    const isClone = (product as any).isClone === true;

    console.log('🗑️ [onDeleteProduct] Deleting product:', product.Code, product.Name);
    console.log('🗑️ [onDeleteProduct] Is clone product:', isClone);
    console.log('🗑️ [onDeleteProduct] Child products to delete:', childProducts.length);

    try {
      // Collect all product IDs to delete (master + children)
      const productIds: number[] = [product.Id];
      childProducts.forEach(child => {
        if (child.Id) {
          productIds.push(child.Id);
        }
      });

      // 1. Delete from Firebase
      console.log('📤 Deleting from Firebase...');

      if (isClone) {
        // ✅ Clone product: Use deleteProductWithSiblings to delete ALL siblings
        // This ensures all related units (master + children) are deleted together
        const result = await this.productService.deleteProductWithSiblings(product.Id);
        console.log('📤 deleteProductWithSiblings result:', result);

        // Update productIds with all deleted IDs from backend response
        if (result.deleted_ids && result.deleted_ids.length > 0) {
          // Clear and add all deleted IDs
          productIds.length = 0;
          result.deleted_ids.forEach((id: string) => {
            const numId = parseInt(id, 10);
            if (!isNaN(numId)) {
              productIds.push(numId);
            }
          });
          console.log('📤 Deleted IDs from backend:', productIds);
        }
      } else {
        // Original product: Delete only the master product
        await this.productService.deleteProduct(product.Id);
      }

      // 2. Delete master and all children from IndexedDB
      console.log('📤 Deleting from IndexedDB:', productIds.length, 'products');
      for (const id of productIds) {
        await this.productService.deleteProductFromIndexedDB(id);
        // Also clean up localStorage
        localStorage.removeItem(`editing_childProduct_${id}`);
      }

      // 3. Remove from current productGroups list (create new array to trigger change detection)
      this.productGroups = [
        ...this.productGroups.slice(0, groupIndex),
        ...this.productGroups.slice(groupIndex + 1)
      ];
      this.persistState();

      // 4. Show success notification
      const deletedCount = productIds.length;
      this.snackBar.open(
        `Đã xóa ${deletedCount} sản phẩm: ${product.Code} - ${product.Name}`,
        'Đóng',
        {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['success-snackbar']
        }
      );

      console.log('✅ [onDeleteProduct] Successfully deleted', deletedCount, 'products');

    } catch (error) {
      console.error('❌ [onDeleteProduct] Error deleting product:', error);

      this.snackBar.open(
        `Lỗi khi xóa sản phẩm: ${(error as Error).message || 'Không xác định'}`,
        'Đóng',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: ['error-snackbar']
        }
      );
    }
  }

  private saveToLocalStorage(product: EditedProduct) {
    try {
      localStorage.setItem(`editing_childProduct_${product.Id}`, JSON.stringify(product));
    } catch (err) {
      console.error('Failed to save product to localStorage:', err);
    }
  }

  onUpdate() {
    console.log('🔍 [onUpdate] Starting update process');

    // Flatten all products from groups
    const allProducts: EditedProduct[] = [];
    this.productGroups.forEach(group => {
      allProducts.push(group.master);
      allProducts.push(...group.children);
    });

    // Save to edited_products_*
    this.productEditService.saveEditedProducts(this.searchTerm);

    // Filter only EDITED products, exclude clones
    const editedProducts = allProducts.filter(p => {
      if (!p.Edited) return false;
      const isClone = (p as any).isClone;
      if (isClone === true || isClone === 'true') return false;
      return true;
    });

    console.log('🚀 [onUpdate] Opening dialog with', editedProducts.length, 'edited products');

    this.dialog.open(EditedItemDialog, {
      width: '70vw',
      height: 'auto',
      maxWidth: '100vw',
      data: { products: editedProducts }
    });
  }

  /**
   * Clear all cache data from localStorage
   * Includes: editing_*, search_*, grouped_*, edited_products_*
   */
  clearAllCache() {

    try {
      this.productEditService.clearCache();
      localStorage.removeItem(this.EDIT_META_KEY);

      // Also clear current editing session
      this.productGroups = [];
      this.searchTerm = '';
      this.activeQuery = null;
      this.pendingCloneSave = false;
      this.searchControl.setValue('');
      this.persistState();

      console.log('✅ All cache cleared successfully');
    } catch (error) {
      console.error('❌ Error clearing cache:', error);
      alert('❌ Lỗi khi xóa cache!');
    }
  }

  /**
   * Full Reload: KiotViet → Sync Firebase → Fetch Firebase (fresh) → IndexedDB
   * Đồng bộ toàn bộ products từ KiotViet + Firebase vào IndexedDB
   */
  async fullReload(): Promise<void> {
    if (this.isFullReloading) return;
    this.isFullReloading = true;

    try {
      console.log('🔄 ========== FULL RELOAD (Edit Product Page) ==========');

      // 1. Force clear cache
      this.productService.forceClearCache();

      // 2. Fetch từ KiotViet
      console.log('📥 BƯỚC 1: Lấy dữ liệu từ KiotViet...');
      const kiotvietProducts = await this.productService.fetchAllProductsFromBackend();
      if (!kiotvietProducts || kiotvietProducts.length === 0) {
        this.snackBar.open('Không tải được sản phẩm từ KiotViet', 'Đóng', {
          duration: 5000, panelClass: ['error-snackbar']
        });
        return;
      }
      console.log(`✅ KiotViet: ${kiotvietProducts.length} sản phẩm`);

      // 3. Sync KiotViet → Firebase
      console.log('☁️ BƯỚC 2: Sync KiotViet → Firebase...');
      const syncResult = await this.productService.fetchAndSaveMergedProductsFromBackend(false);
      console.log(`✅ Sync: ${syncResult.success ? 'Thành công' : 'Thất bại'}`);

      // 4. Fetch Firebase fresh (sau sync, OnHand đã mới)
      console.log('📥 BƯỚC 3: Lấy dữ liệu từ Firebase (FRESH)...');
      const firebaseProducts = await firstValueFrom(
        this.productService.getAllProductsFromFirebaseFresh({
          includeInactive: true,
          includeDeleted: false
        })
      ).catch(err => {
        console.error('Lỗi fetch Firebase fresh:', err);
        return [] as Product[];
      });
      console.log(`✅ Firebase (fresh): ${firebaseProducts.length} sản phẩm`);

      // 5. Merge: KiotViet base + OnHand/OnHandNV/Tax từ Firebase
      console.log('💾 BƯỚC 4: Merge và lưu IndexedDB...');
      const firebaseOnHandMap = new Map<number, number>();
      const firebaseOnHandNVMap = new Map<number, number>();
      const firebaseTaxMap = new Map<number, number | string>();

      for (const p of firebaseProducts) {
        if (p?.Id != null) {
          const onHand = Number(p.OnHand);
          if (Number.isFinite(onHand)) firebaseOnHandMap.set(p.Id, onHand);
          if (p.OnHandNV !== undefined && p.OnHandNV !== null) {
            const onHandNV = Number(p.OnHandNV);
            if (Number.isFinite(onHandNV)) firebaseOnHandNVMap.set(p.Id, onHandNV);
          }
          if (p.Tax !== undefined && p.Tax !== null) {
            const taxStr = String(p.Tax).trim();
            if (taxStr === 'KCT' || taxStr === 'KKKNT') {
              firebaseTaxMap.set(p.Id, taxStr);
            } else {
              const tax = Number(p.Tax);
              if (Number.isFinite(tax)) firebaseTaxMap.set(p.Id, tax);
            }
          }
        }
      }

      const mergedProductsMap = new Map<number, Product>();
      for (const p of kiotvietProducts) {
        if (p?.Id) {
          const copy = { ...p };
          const fbOnHand = firebaseOnHandMap.get(p.Id);
          if (fbOnHand !== undefined) copy.OnHand = fbOnHand;
          const fbOnHandNV = firebaseOnHandNVMap.get(p.Id);
          if (fbOnHandNV !== undefined) copy.OnHandNV = fbOnHandNV;
          const fbTax = firebaseTaxMap.get(p.Id);
          if (fbTax !== undefined) copy.Tax = fbTax;
          mergedProductsMap.set(p.Id, copy);
        }
      }
      for (const p of firebaseProducts) {
        if (p?.Id && !mergedProductsMap.has(p.Id)) {
          mergedProductsMap.set(p.Id, p);
        }
      }

      const mergedProducts = Array.from(mergedProductsMap.values());
      console.log(`📦 Merged: ${mergedProducts.length} products`);

      // 6. Clear + Save IndexedDB
      await this.indexedDBService.clear(SALES_DB_NAME, SALES_DB_VERSION, 'products');
      await this.indexedDBService.putMany(SALES_DB_NAME, SALES_DB_VERSION, 'products', mergedProducts);
      const savedCount = await this.indexedDBService.count(SALES_DB_NAME, SALES_DB_VERSION, 'products');
      console.log(`✅ Đã lưu ${savedCount} products vào IndexedDB`);

      // 7. Cleanup orphaned
      const cleanupResult = await this.productService.cleanupOrphanedProductsFromAPI(mergedProducts);
      console.log(`✅ Cleanup: Đã xóa ${cleanupResult.deletedCount} orphaned`);

      // 8. Save lastSyncTime
      this.productService.forceClearCache();
      this.productService.saveLastSyncTime();

      console.log('✅ ========== FULL RELOAD HOÀN TẤT ==========');
      this.snackBar.open(
        `Full Reload thành công! ${savedCount} sản phẩm đã được cập nhật.`,
        'Đóng',
        { duration: 4000, panelClass: ['success-snackbar'] }
      );

    } catch (error) {
      console.error('Lỗi khi full reload:', error);
      this.snackBar.open(
        `Lỗi: ${error instanceof Error ? error.message : 'Lỗi không xác định'}`,
        'Đóng',
        { duration: 5000, panelClass: ['error-snackbar'] }
      );
    } finally {
      this.isFullReloading = false;
    }
  }

  addProduct() {
    const dialogRef = this.dialog.open(InputProductDialogComponent, {
      width: '900px',
      maxWidth: '96vw'
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result && result.saved) {
        console.log('✅ New clone product added:', result.count, 'products');
        if (this.searchTerm) {
          this.onSearch({ target: { value: this.searchTerm } } as any);
        }
      }
    });
  }

  addOriginalProduct() {
    const dialogRef = this.dialog.open(AddOriginalProductDialogComponent, {
      width: '900px',
      maxWidth: '96vw'
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result && result.saved) {
        console.log('✅ New original product added to KiotViet:', result.count, 'products');
        if (this.searchTerm) {
          this.onSearch({ target: { value: this.searchTerm } } as any);
        }
      }
    });
  }

  openPromotionList() {
    this.dialog.open(PromotionListDialogComponent, {
      width: '900px',
      maxHeight: '85vh',
    });
  }

  /**
   * Mở dialog nhập hàng KiotViet: import XML hóa đơn → tạo phiếu nhập (Lưu tạm / Hoàn thành).
   */
  openKiotVietPurchaseOrder() {
    const dialogRef = this.dialog.open(KiotVietPurchaseOrderDialogComponent, {
      width: '1200px',
      maxWidth: '96vw',
      maxHeight: '92vh',
    });

    dialogRef.afterClosed().subscribe((result: any) => {
      if (result?.created) {
        const label = result.complete ? 'Hoàn thành' : 'Lưu tạm';
        this.snackBar.open(
          `Đã tạo phiếu nhập ${result.purchaseOrder?.Code || ''} (${label})`,
          'Đóng',
          { duration: 4000 }
        );
      }
    });
  }

  /**
   * Open the advanced query builder. Builds AND conditions on product fields,
   * runs them client-side over the IndexedDB cache, and displays up to 10 results.
   */
  async openQueryDialog(): Promise<void> {
    const fields = await this.productEditService.getQueryableFields();
    const dialogRef = this.dialog.open(ProductQueryDialogComponent, {
      width: '640px',
      maxWidth: '96vw',
      maxHeight: '85vh',
      data: { fields }
    });

    dialogRef.afterClosed().subscribe(async (result: any) => {
      if (!result?.conditions?.length) return;

      this.isLoading = true;
      try {
        const limit = result.limit || 10;
        const products = await this.productEditService.queryProducts(
          result.conditions,
          limit,
          this.productColors
        );
        this.productGroups = this.groupProductsByMaster(products);
        this.activeQuery = { conditions: result.conditions, limit };
        this.searchTerm = '';
        this.searchControl.setValue('');
        console.log('✅ Query results:', this.productGroups.length, 'groups');
      } catch (error) {
        console.error('❌ Query error:', error);
        this.productGroups = [];
      } finally {
        this.isLoading = false;
        this.persistState();
      }
    });
  }

  /**
   * Human-readable summary of the active query filter, e.g. "Tax = 0 AND OnHand > 0".
   */
  get activeQueryText(): string {
    if (!this.activeQuery) return '';
    const opLabels: Record<string, string> = {
      '=': '=', '!=': '≠', '>': '>', '<': '<', '>=': '≥', '<=': '≤', 'contains': 'chứa'
    };
    return this.activeQuery.conditions
      .map(c => `${c.field} ${opLabels[c.operator] || c.operator} ${c.value}`)
      .join(' AND ');
  }

  /**
   * Clear the active query filter and its results.
   */
  clearQuery(): void {
    this.activeQuery = null;
    this.productGroups = [];
    this.searchTerm = '';
    this.searchControl.setValue('');
    this.persistState();
  }

  openInvoiceProcessing() {
    const dialogRef = this.dialog.open(InvoiceProcessingDialogComponent, {
      width: '95vw',
      height: '95vh',
      maxWidth: '100vw',
      panelClass: 'invoice-processing-dialog'
    });

    dialogRef.afterClosed().subscribe(async (result: any) => {
      if (result?.action === 'updatePrices' || result?.action === 'updateClonePrices') {
        const isCloneUpdate = result.action === 'updateClonePrices';
        const label = isCloneUpdate ? 'CẬP NHẬT CLONE' : 'CẬP NHẬT GIÁ';

        this.isLoading = true;
        try {
          // Clear stale editing_childProduct_ entries from previous runs
          const keysToRemove: string[] = [];
          for (let k = 0; k < localStorage.length; k++) {
            const key = localStorage.key(k);
            if (key?.startsWith('editing_childProduct_')) keysToRemove.push(key);
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
          localStorage.removeItem(this.EDIT_META_KEY);
          console.log(`[${label}] Cleared ${keysToRemove.length} stale editing_childProduct_ entries`);

          const updateResult = isCloneUpdate
            ? await this.invoicePriceUpdateService.updateClonePricesFromInvoice(
                result.invoiceItems,
                result.matchedProducts
              )
            : await this.invoicePriceUpdateService.updatePricesFromInvoice(
                result.invoiceItems,
                result.matchedProducts
              );

          // LOG: Update results
          console.group(`%c[${label}] Kết quả từ InvoicePriceUpdateService`, 'color: #4CAF50; font-weight: bold');
          updateResult.results.forEach(r => {
            console.log(`[${r.itemIndex}] ${r.status} ${r.productCode || ''} ${r.reason || ''} newCost=${r.newCost || '-'}`);
          });
          console.log(`Tổng cập nhật: ${updateResult.totalUpdated}, searchTerms:`, updateResult.updatedSearchTerms);
          console.groupEnd();

          // Refresh display for all updated products at once
          if (result.searchTerms?.length) {
            const allProducts: any[] = [];
            for (const term of result.searchTerms) {
              const products = await this.productEditService.searchProducts(term, this.productColors);
              allProducts.push(...products);
            }
            // Deduplicate by product Id
            const seen = new Set<string>();
            const unique = allProducts.filter(p => {
              const id = String(p.Id);
              if (seen.has(id)) return false;
              seen.add(id);
              return true;
            });

            // LOG: Products after search & dedup
            console.group(`%c[${label}] Sản phẩm sau khi search`, 'color: #FF9800; font-weight: bold');
            unique.forEach(p => {
              const edited = localStorage.getItem(`editing_childProduct_${p.Id}`);
              const editedData = edited ? JSON.parse(edited) : null;
              console.log(
                `Id=${p.Id} Code=${p.Code} "${p.Name}" isClone=${p.isClone} MasterUnitId=${p.MasterUnitId}`,
                editedData ? `| EDITED: Box=${editedData.Box} Retail=${editedData.Retail} TotalPrice=${editedData.TotalPrice} Cost=${editedData.Cost}` : '| no edit'
              );
            });
            console.groupEnd();

            this.productGroups = this.groupProductsByMaster(unique);
          }

          // For clone: apply localStorage data to displayed products (no auto-save)
          if (isCloneUpdate) {
            this.applyCloneDataToProductGroups();
            this.pendingCloneSave = true;
          }

          this.persistState();

          this.snackBar.open(
            isCloneUpdate ? 'Đã cập nhật Clone - Ấn nút Lưu để xác nhận!' : 'Đã cập nhật giá thành công!',
            'Đóng', { duration: isCloneUpdate ? 5000 : 3000 }
          );
        } catch (error) {
          console.error(`Error updating ${isCloneUpdate ? 'clone' : ''} prices:`, error);
          this.snackBar.open(
            isCloneUpdate ? 'Lỗi khi cập nhật Clone' : 'Lỗi khi cập nhật giá',
            'Đóng', { duration: 5000 }
          );
        } finally {
          this.isLoading = false;
        }
      }
    });
  }

  /**
   * Apply clone data from localStorage to displayed product groups.
   * Shows updated Cost/OnHandNV in the UI without saving to Firestore.
   */
  private applyCloneDataToProductGroups(): void {
    // Helper to check if product is a clone
    const isCloneProduct = (p: any): boolean => {
      if (typeof p.isClone === 'boolean') return p.isClone;
      if (typeof p.isClone === 'string') return p.isClone.toLowerCase() === 'true';
      if (p.OnHandNV > 0 && (p.OnHand === 0 || !p.OnHand)) return true;
      if (p.KiotVietSync === false) return true;
      return false;
    };

    // Helper to find clone data from localStorage by Id or Code
    const findCloneData = (product: any): any | null => {
      if (product.Id) {
        const byId = localStorage.getItem(`editing_childProduct_${product.Id}`);
        if (byId) {
          try {
            const data = JSON.parse(byId);
            if (data?.IsCloneUpdate) return data;
          } catch { /* skip */ }
        }
      }
      if (product.Code) {
        const byCode = localStorage.getItem(`editing_childProduct_${product.Code}`);
        if (byCode) {
          try {
            const data = JSON.parse(byCode);
            if (data?.IsCloneUpdate) return data;
          } catch { /* skip */ }
        }
      }
      return null;
    };

    const parseNum = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    // Helper to apply clone data to a product, preserving originals for diff hints
    const applyToProduct = (product: any, data: any, childProducts: any[] = []) => {
      // Save original values BEFORE modifying, so diff-indicator hints work
      const oldCost = parseNum(product.Cost);
      const oldBasePrice = parseNum(product.BasePrice);
      // For clone children: use derived original from master stock (child may have OnHandNV=0 in DB)
      const derivedOrig = (product as any)._derivedOriginalOnHand;
      const oldOnHandNV = derivedOrig !== undefined ? derivedOrig : parseNum(product.OnHandNV ?? product.OnHand);
      (product as any)._originalCost = oldCost;
      (product as any)._originalBasePrice = oldBasePrice;
      (product as any)._originalOnHand = oldOnHandNV;

      // FIX: For IsCloneUpdate data from updateClonePricesFromInvoice,
      // use the PRE-CALCULATED Cost/OnHandNV directly instead of recalculating.
      // This fixes two bugs:
      // 1. Children don't have Box/Retail/TotalPrice → recalc gives 0 → no update
      // 2. Master's largestConversion may differ between full group and displayed group
      if (data.IsCloneUpdate && (data.Cost !== undefined || data.OnHandNV !== undefined)) {
        const preCalcCost = parseNum(data.Cost);
        const preCalcOnHandNV = parseNum(data.OnHandNV);
        const preCalcBasePrice = data.BasePrice !== undefined ? parseNum(data.BasePrice) : oldBasePrice;

        product.Cost = preCalcCost;
        product.BasePrice = preCalcBasePrice;
        (product as any).OnHandNV = preCalcOnHandNV;
        product.OnHand = preCalcOnHandNV; // For getOnHandDiff()
        product.Box = parseNum(data.Box);
        product.Retail = parseNum(data.Retail);
        product.TotalPrice = parseNum(data.TotalPrice);
        product.Edited = true;
        (product as any).IsCloneUpdate = true;
        if (data.KeepBasePrice) product.KeepBasePrice = true;
        return;
      }

      // FALLBACK: Recalculate from Box/Retail/TotalPrice (for non-IsCloneUpdate data)
      const conversionValue = parseNum(product.ConversionValue) || 1;
      const allConversions = [conversionValue, ...childProducts.map((c: any) => parseNum(c.ConversionValue) || 1)];
      const largestConversion = Math.max(...allConversions);
      const box = parseNum(data.Box);
      const retail = parseNum(data.Retail);
      const totalPrice = parseNum(data.TotalPrice);
      const totalUnits = (box * largestConversion) + retail;
      const addedOnHand = conversionValue > 0 ? totalUnits / conversionValue : 0;

      let newCost = oldCost;
      let newBasePrice = oldBasePrice;
      if (totalPrice > 0 && totalUnits > 0) {
        if (product.AverageCheckPoint === true) {
          // WEIGHTED AVERAGE MODE (same as product-row recalculateCost)
          const newCostPerUnit = addedOnHand > 0 ? totalPrice / addedOnHand : 0;
          const combinedOnHand = oldOnHandNV + addedOnHand;
          if (addedOnHand > 0 && combinedOnHand > 0) {
            newCost = ((oldCost * oldOnHandNV) + (newCostPerUnit * addedOnHand)) / combinedOnHand;
          } else if (addedOnHand > 0) {
            newCost = newCostPerUnit || oldCost;
          }
        } else {
          // SIMPLE MODE (same as product-row recalculateCost)
          newCost = totalUnits > 0 ? (totalPrice / totalUnits) * conversionValue : oldCost;
        }
        // Calculate BasePrice change (same as original: BasePrice += costDiff)
        if (!data.KeepBasePrice) {
          newBasePrice = Math.round((oldBasePrice + (newCost - oldCost)) / 100) * 100;
        }
      } else if ((box > 0 || retail > 0) && totalPrice === 0) {
        // Only Box/Retail (promo) - keep Cost, just update OnHandNV
        newCost = oldCost;
      }

      // Apply calculated values
      product.Cost = newCost;
      product.BasePrice = newBasePrice;
      (product as any).OnHandNV = oldOnHandNV + addedOnHand;
      product.OnHand = oldOnHandNV + addedOnHand; // For getOnHandDiff()
      product.Box = box;
      product.Retail = retail;
      product.TotalPrice = totalPrice;
      product.Edited = true;
      (product as any).IsCloneUpdate = true;
      if (data.KeepBasePrice) product.KeepBasePrice = true;
    };

    let appliedCount = 0;
    for (const group of this.productGroups) {
      // Only apply to clone product groups
      if (!isCloneProduct(group.master)) continue;

      const masterData = findCloneData(group.master);
      if (masterData) {
        applyToProduct(group.master, masterData, group.children);
        appliedCount++;
      }

      // For children: derive _originalOnHand from master's original stock
      // (children may have OnHandNV=0 in IndexedDB even though master has stock)
      const masterCV = parseNum(group.master.ConversionValue) || 1;
      const masterOrigOnHand = (group.master as any)._originalOnHand;

      for (const child of group.children) {
        const childData = findCloneData(child);
        if (childData) {
          // Pre-set correct _originalOnHand derived from master before applyToProduct overwrites it
          if (masterOrigOnHand !== undefined && childData.IsCloneUpdate) {
            const childCV = parseNum(child.ConversionValue) || 1;
            (child as any)._derivedOriginalOnHand = (masterOrigOnHand * masterCV) / childCV;
          }
          applyToProduct(child, childData);
          appliedCount++;
        }
      }
    }
    console.log(`[ApplyClone] Applied clone data to ${appliedCount} products across ${this.productGroups.length} groups`);
  }

  /**
   * Save pending clone products to Firestore.
   * Called when user clicks the Save button on clone product rows.
   */
  async saveCloneProducts(): Promise<void> {
    const cloneUpdates: any[] = [];

    // Strategy 1: Read from localStorage (primary source)
    for (let k = 0; k < localStorage.length; k++) {
      const key = localStorage.key(k);
      if (!key?.startsWith('editing_childProduct_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '');
        if (data?.IsCloneUpdate && data?.Id) {
          if (!cloneUpdates.find(u => String(u.Id) === String(data.Id))) {
            cloneUpdates.push(data);
          }
        }
      } catch { /* skip */ }
    }

    // Strategy 2: Fallback - collect from productGroups if localStorage was cleared
    if (cloneUpdates.length === 0) {
      for (const group of this.productGroups) {
        const allProducts = [group.master, ...group.children];
        for (const p of allProducts) {
          if ((p as any).IsCloneUpdate && p.Id) {
            if (!cloneUpdates.find(u => String(u.Id) === String(p.Id))) {
              cloneUpdates.push({
                Id: p.Id,
                Code: p.Code,
                Name: p.Name,
                Cost: p.Cost,
                BasePrice: p.BasePrice,
                OnHandNV: (p as any).OnHandNV,
                IsCloneUpdate: true
              });
            }
          }
        }
      }
    }

    if (cloneUpdates.length === 0) {
      this.snackBar.open('Không có Clone nào cần lưu', 'Đóng', { duration: 3000 });
      return;
    }

    this.isLoading = true;
    console.group('%c[SAVE CLONE] Lưu Clone vào Firestore', 'color: #E91E63; font-weight: bold');
    console.log(`Saving ${cloneUpdates.length} clone products`);

    try {
      const now = new Date().toISOString();
      const firestoreUpdates = cloneUpdates.map(p => ({
        Id: p.Id,
        Cost: p.Cost,
        BasePrice: p.BasePrice,
        OnHandNV: p.OnHandNV,
        ModifiedDate: now
      }));

      firestoreUpdates.forEach(u => {
        console.log(`  Id=${u.Id} Cost=${u.Cost} OnHandNV=${u.OnHandNV}`);
      });

      await this.productService.updateProducts(firestoreUpdates);

      // Update IndexedDB + record product history
      for (const update of cloneUpdates) {
        try {
          const existing = await this.productService.getProductByIdFromIndexedDB(update.Id);
          if (existing) {
            // Record history BEFORE updating IndexedDB (compare old vs new)
            const masterId = existing.MasterUnitId || existing.Id;
            this.productHistoryService.compareAndRecord(
              masterId,
              existing.Code || '',
              existing.Name || '',
              { Cost: existing.Cost || 0, BasePrice: existing.BasePrice || 0, OnHandNV: existing.OnHandNV || 0 },
              { Cost: update.Cost, BasePrice: update.BasePrice, OnHandNV: update.OnHandNV },
              undefined,
              'edit'
            );

            const merged = {
              ...existing,
              Cost: update.Cost,
              BasePrice: update.BasePrice ?? existing.BasePrice,
              OnHandNV: update.OnHandNV,
              OnHand: existing.OnHand,
              ModifiedDate: now
            };
            await this.productService.updateProductFromIndexedDB(merged);
          }
        } catch (dbErr) {
          console.warn(`Failed to update IndexedDB for ${update.Id}:`, dbErr);
        }
      }

      // Clear IsCloneUpdate flags from localStorage
      for (let k = localStorage.length - 1; k >= 0; k--) {
        const key = localStorage.key(k);
        if (key?.startsWith('editing_childProduct_')) {
          try {
            const data = JSON.parse(localStorage.getItem(key) || '');
            if (data?.IsCloneUpdate) localStorage.removeItem(key);
          } catch { /* skip */ }
        }
      }

      // Clear IsCloneUpdate flag on product objects
      for (const group of this.productGroups) {
        if ((group.master as any).IsCloneUpdate) {
          (group.master as any).IsCloneUpdate = false;
        }
        for (const child of group.children) {
          if ((child as any).IsCloneUpdate) {
            (child as any).IsCloneUpdate = false;
          }
        }
      }

      this.pendingCloneSave = false;
      this.persistState();
      this.snackBar.open('Đã lưu Clone thành công!', 'Đóng', { duration: 3000 });
      console.log('Clone save complete!');
    } catch (err) {
      console.error('Clone save failed:', err);
      this.snackBar.open('Lỗi khi lưu Clone', 'Đóng', { duration: 5000 });
    } finally {
      this.isLoading = false;
      console.groupEnd();
    }
  }

  private setupCrossTabSync(): void {
    this.crossTabSubscription = this.crossTabSync.onHandUpdated$.subscribe(updates => {
      if (!updates || updates.length === 0 || this.productGroups.length === 0) return;

      const updateMap = new Map<number, ProductOnHandUpdate>();
      updates.forEach(u => updateMap.set(u.Id, u));

      let updated = 0;
      for (const group of this.productGroups) {
        const allProducts = [group.master, ...group.children];
        for (const product of allProducts) {
          const u = updateMap.get(product.Id);
          if (u) {
            product.OnHand = u.OnHand;
            if (u.OnHandNV !== undefined) (product as any).OnHandNV = u.OnHandNV;
            if (u.BasePrice !== undefined) product.BasePrice = u.BasePrice;
            if (u.Cost !== undefined) product.Cost = u.Cost;
            updated++;
          }
        }
      }

      if (updated > 0) {
        // Trigger change detection by creating new array reference
        this.productGroups = [...this.productGroups];
        this.persistState();
        console.log(`[CrossTab] Updated ${updated} products from another tab`);
      }
    });
  }

  private setupInvoiceEmailListener() {
    this.invoiceEmailListener.startListening();
    this.connectivitySubscriptions.add(
      this.invoiceEmailListener.newInvoiceEmail$.subscribe(() => {
        const snackRef = this.snackBar.open('Có hóa đơn mua vào mới', 'Xem', {
          duration: 8000,
          horizontalPosition: 'end',
          verticalPosition: 'top'
        });
        snackRef.onAction().subscribe(() => {
          this.openInvoiceProcessing();
        });
      })
    );
  }

  private setupConnectivityHint() {
    if (typeof window === 'undefined') {
      return;
    }

    this.isNetworkOffline = !this.getNavigatorOnlineStatus();
    this.updateOfflineHint();

    this.connectivitySubscriptions.add(fromEvent(window, 'online').subscribe(() => {
      this.isNetworkOffline = false;
      this.updateOfflineHint();
    }));

    this.connectivitySubscriptions.add(fromEvent(window, 'offline').subscribe(() => {
      this.isNetworkOffline = true;
      this.updateOfflineHint();
    }));
  }

  private getNavigatorOnlineStatus(): boolean {
    return typeof navigator === 'undefined' ? true : navigator.onLine;
  }

  private updateOfflineHint() {
    if (this.isNetworkOffline) {
      this.showOfflineHint = true;
      this.hintMessage = 'Không thể kết nối internet, dữ liệu sẽ được đồng bộ khi có mạng trở lại.';
      return;
    }

    this.showOfflineHint = false;
    this.hintMessage = '';
  }

  getProductColor(productId: string | number): string {
    const key = String(productId);
    return this.productColors[key] || '#ffffff';
  }

  trackByGroup(index: number, group: ProductGroup): number {
    return group.master.Id;
  }
}
