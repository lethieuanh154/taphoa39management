import { Injectable } from '@angular/core';
import { Product } from '../../../models/product.model';
import { IndexedDBService } from '../../../services/indexed-db.service';
import { ProductService } from '../../../services/product.service';
import { GroupService } from '../../../services/group.service';
import { assignColorsToProductList } from '../utility-functions/app.color';
import { sortByGroup } from '../utility-functions/app.sort';
import { showNotification } from '../utility-functions/app.notification';

export interface EditedProduct extends Partial<Product> {
  Id: number;
  Code: string;
  FullName: string;
  Image?: string | null;
  BasePrice: number;
  FinalBasePrice?: number;
  Cost: number;
  OnHand: number;
  OnHandNV?: number;
  Unit: string;
  ConversionValue: number;
  Master?: boolean; // Master = smallest ConversionValue (base unit, for input and calculation)
  Edited?: boolean;
  _constBasePrice?: number;
  AverageCheckPoint?: boolean;
  Retail?: number;
  Box?: number;
  Discount?: number;
  Discount2?: number;
  TotalPrice?: number;
  ParentCode?: string;
  Description?: string;
  OrderTemplate?: string;
  ListProduct?: any[];
  MasterUnitId?: number | null;
  OriginalCode?: string; // Track original code when edited
  OriginalFullName?: string; // Track original full name when edited
  ProductAttributes: any[];
  CategoryId?: number | null;
  TradeMarkId?: number | null;
  TradeMarkName?: string | null;
  isClone?: boolean;  // ✅ Clone product (NV variant) - dùng để phân biệt khi search
  CloneSourceId?: number | string;  // ✅ ID của product gốc (cho clones)
  KeepBasePrice?: boolean;  // Giữ nguyên giá bán khi cập nhật từ hóa đơn
}

@Injectable({
  providedIn: 'root'
})
export class ProductEditService {
  private dbName = 'SalesDB';
  private dbVersion = 6;
  private storeName = 'products';

  constructor(
    private indexedDBService: IndexedDBService,
    private productService: ProductService,
    private groupService: GroupService
  ) { }

  /**
   * Search products from IndexedDB by search term
   */
  async searchProducts(
    searchTerm: string,
    productColors: Record<string, string>
  ): Promise<EditedProduct[]> {
    if (!searchTerm || searchTerm.trim() === '') {
      return [];
    }

    const normalizedSearch = searchTerm.toLowerCase().trim();

    // Get all products from IndexedDB
    const allProducts = await this.indexedDBService.getAll<Product>(
      this.dbName,
      this.dbVersion,
      this.storeName
    );

    // Filter products by search term (exact Code match OR partial Name match)
    let matchedProducts = allProducts.filter(product => {
      const code = (product.Code || '').toLowerCase();
      const name = (product.FullName || product.Name || '').toLowerCase();
      return code === normalizedSearch || name.includes(normalizedSearch);
    });

    // 🔍 DEBUG: Log matched products with clone info
    console.log(`🔍 [searchProducts] Search term: "${searchTerm}"`);
    console.log(`   Total products in IndexedDB: ${allProducts.length}`);
    console.log(`   Matched products: ${matchedProducts.length}`);
    matchedProducts.forEach(p => {
      console.log(`   - ID: ${p.Id}, Code: ${p.Code}, isClone: ${(p as any).isClone}, MasterUnitId: ${p.MasterUnitId}, CloneMasterSourceId: ${(p as any).CloneMasterSourceId}`);
    });

    if (matchedProducts.length === 0) {
      return [];
    }

    // Verify clone products still exist in Firebase (may have been deleted from BanHang app)
    const cloneIds = matchedProducts
      .filter(p => (p as any).isClone)
      .map(p => p.Id);

    if (cloneIds.length > 0) {
      try {
        const existingIds = new Set(await this.productService.checkCloneProductsExist(cloneIds));
        const deletedIds = cloneIds.filter(id => !existingIds.has(id));
        for (const id of deletedIds) {
          await this.indexedDBService.delete(this.dbName, this.dbVersion, this.storeName, id);
          console.log(`🗑️ [searchProducts] Removed stale clone ${id} from IndexedDB`);
        }
        if (deletedIds.length > 0) {
          matchedProducts = matchedProducts.filter(
            p => !(p as any).isClone || existingIds.has(p.Id)
          );
        }
      } catch {
        // Ignore verification errors — use IndexedDB data as fallback
      }
    }

    // Expand to include all products in the same group
    const expandedProducts = this.expandToFullGroups(matchedProducts, allProducts);

    // 🔍 DEBUG: Log expanded products
    console.log(`🔍 [searchProducts] Expanded products: ${expandedProducts.length}`);
    expandedProducts.forEach(p => {
      console.log(`   [expanded] ID: ${p.Id}, Code: ${p.Code}, isClone: ${(p as any).isClone}, MasterUnitId: ${p.MasterUnitId}`);
    });

    // Group products by MasterUnitId using GroupService
    const groupedByMasterId = this.groupService.group(expandedProducts);

    // 🔍 DEBUG: Log grouped products
    console.log(`🔍 [searchProducts] Grouped: ${Object.keys(groupedByMasterId).length} groups`);
    Object.entries(groupedByMasterId).forEach(([masterId, group]) => {
      console.log(`   [group ${masterId}] ${group.length} products: ${group.map((p: any) => p.Code).join(', ')}`);
    });

    // Identify master (smallest ConversionValue) and flatten
    const flatProducts: EditedProduct[] = [];
    const seenIds = new Set<number>();

    Object.values(groupedByMasterId).forEach((group: any[]) => {
      if (group.length === 0) return;

      // Find master: product with SMALLEST ConversionValue (base unit)
      // e.g., "lon" (ConversionValue=1) is master, "thùng" (ConversionValue=24) is child
      const masterProduct = group.reduce((prev, curr) => {
        const prevConv = Number(prev?.ConversionValue ?? Infinity);
        const currConv = Number(curr?.ConversionValue ?? Infinity);
        return currConv < prevConv ? curr : prev;
      }, group[0]);

      // Transform and mark master
      group.forEach((product: any) => {
        if (!seenIds.has(product.Id)) {
          const editedProduct = this.transformToEditedProduct(product);
          editedProduct.Master = (product.Id === masterProduct.Id);
          flatProducts.push(editedProduct);
          seenIds.add(product.Id);
        }
      });
    });

    // Assign colors (master will get darker color)
    assignColorsToProductList(flatProducts, productColors);

    // Sort by group
    const sortedProducts = sortByGroup(flatProducts);

    // Cache to localStorage for backup
    this.cacheSearchResults(searchTerm, sortedProducts);

    // Cache grouped products for cost calculation (used by cost.service.ts)
    this.cacheGroupedProducts(searchTerm, groupedByMasterId, sortedProducts);

    return sortedProducts;
  }

  /**
   * Expand matched products to include all products in their groups
   * ✅ FIX: Also handle clone products by CloneSourceId/CloneMasterSourceId
   */
  private expandToFullGroups(matchedProducts: Product[], allProducts: Product[]): Product[] {
    const expandedSet = new Set<number>();
    const masterIdsToInclude = new Set<number>();
    const cloneMasterSourceIds = new Set<string>(); // For clone grouping

    // First pass: collect all master IDs from matched products
    matchedProducts.forEach(product => {
      if (product.Id) {
        expandedSet.add(product.Id);
        // Every product is potentially a master of its own unit group
        masterIdsToInclude.add(Number(product.Id));
      }

      // If this is a child product, we need its master
      if (product.MasterUnitId !== null && product.MasterUnitId !== undefined) {
        masterIdsToInclude.add(Number(product.MasterUnitId));
      }

      // ✅ FIX: For clone products, collect CloneMasterSourceId to find siblings
      const cloneMasterSourceId = (product as any).CloneMasterSourceId;
      if ((product as any).isClone && cloneMasterSourceId) {
        cloneMasterSourceIds.add(String(cloneMasterSourceId));
      }
    });

    // Second pass: include all products with matching master IDs
    allProducts.forEach(product => {
      // Include if this product's MasterUnitId matches any collected master ID
      if (product.MasterUnitId !== null &&
          product.MasterUnitId !== undefined &&
          masterIdsToInclude.has(Number(product.MasterUnitId))) {
        if (product.Id) {
          expandedSet.add(product.Id);
        }
      }

      // Include if this product IS a master we're looking for
      if (product.Id && masterIdsToInclude.has(Number(product.Id))) {
        expandedSet.add(product.Id);
      }

      // ✅ FIX: Include clone siblings (products with same CloneMasterSourceId)
      const cloneMasterSourceId = (product as any).CloneMasterSourceId;
      if ((product as any).isClone && cloneMasterSourceId && cloneMasterSourceIds.has(String(cloneMasterSourceId))) {
        if (product.Id) {
          expandedSet.add(product.Id);
        }
      }
    });

    // Return all products with IDs in the expanded set
    return allProducts.filter(p => p.Id && expandedSet.has(p.Id));
  }

  /**
   * Transform Product to EditedProduct with additional fields
   */
  private transformToEditedProduct(product: Product): EditedProduct {
    // Construct proper FullName: ProductName + ProductAttributes.Value + Unit
    let fullName = product.Name || '';

    if (Array.isArray(product.ProductAttributes) && product.ProductAttributes.length > 0) {
      const attributeValue = product.ProductAttributes
        .map((attr: any) => attr.Value || attr.value)
        .filter(Boolean)
        .join(' ');
      if (attributeValue) {
        fullName += ' ' + attributeValue;
      }
    }

    // Only append Unit if Name doesn't already end with it (avoid duplication like "(gói)(gói)")
    if (product.Unit) {
      const unitSuffix = `(${product.Unit})`;
      const unitSuffixPlain = product.Unit;
      if (!fullName.endsWith(unitSuffix) && !fullName.endsWith(unitSuffixPlain)) {
        fullName += ' ' + product.Unit;
      }
    }

    // CRITICAL: Check if there's an existing edited version in localStorage
    // Use Id as the unique key (immutable, unlike Code which can change)
    let existingEdit: any = null;
    try {
      const stored = localStorage.getItem(`editing_childProduct_${product.Id}`);
      if (stored) {
        existingEdit = JSON.parse(stored);
        console.log(`🔍 [transformToEditedProduct] Found edit by Id for ${product.Code} (Id=${product.Id})`);
      }
    } catch (err) {
      console.warn('Failed to parse existing edit for Id', product.Id, err);
    }

    // CRITICAL: Strip runtime-only _original* properties that may have leaked into IndexedDB.
    // These must be recalculated fresh each session by product-row's loadOriginalValues().
    // Without this, stale originals from previous sessions cause wrong delta calculations.
    const cleanProduct = { ...product };
    delete (cleanProduct as any)._originalOnHand;
    delete (cleanProduct as any)._originalCost;
    delete (cleanProduct as any)._originalBasePrice;
    delete (cleanProduct as any)._derivedOriginalOnHand;

    const editedProduct: EditedProduct = {
      ...cleanProduct,
      FullName: fullName.trim() || product.FullName || product.Name || '',
      Master: false,
      Edited: existingEdit?.Edited || false, // PRESERVE existing Edited flag!
      AverageCheckPoint: false,
      FinalBasePrice: product.BasePrice || 0,
      Retail: 0,
      Box: 0,
      Discount: 0,
      Discount2: 0,
      TotalPrice: 0
    };

    // If there was an existing edit, restore important fields
    if (existingEdit) {
      // Restore edited Code if it was changed
      if (existingEdit.Code && existingEdit.Code !== product.Code) {
        editedProduct.Code = existingEdit.Code;
      }
      // Restore edited Name if it was changed
      if (existingEdit.Name && existingEdit.Name !== product.Name) {
        editedProduct.Name = existingEdit.Name;
      }
      // IMPORTANT: Do NOT restore FullName - it's auto-generated from Name + ProductAttributes + Unit
      // FullName will be automatically updated by the system when Name changes

      // Restore OriginalCode/OriginalName tracking
      if (existingEdit.OriginalCode) {
        editedProduct.OriginalCode = existingEdit.OriginalCode;
      }
      if (existingEdit.OriginalName) {
        (editedProduct as any).OriginalName = existingEdit.OriginalName;
      }
      // Restore Old* values for comparison
      if (existingEdit.OldBasePrice !== undefined) {
        (editedProduct as any).OldBasePrice = existingEdit.OldBasePrice;
      }
      if (existingEdit.OldCost !== undefined) {
        (editedProduct as any).OldCost = existingEdit.OldCost;
      }
      if (existingEdit.OldOnHand !== undefined) {
        (editedProduct as any).OldOnHand = existingEdit.OldOnHand;
      }
      // Restore invoice input fields only (Box/Retail/TotalPrice/Discount)
      // Do NOT restore Cost/OnHand/BasePrice - let product-row's recalculateCost() handle them
      if (existingEdit.Edited) {
        if (existingEdit.Box !== undefined) editedProduct.Box = existingEdit.Box;
        if (existingEdit.Retail !== undefined) editedProduct.Retail = existingEdit.Retail;
        if (existingEdit.TotalPrice !== undefined) editedProduct.TotalPrice = existingEdit.TotalPrice;
        if (existingEdit.Discount !== undefined) editedProduct.Discount = existingEdit.Discount;
        if (existingEdit.Discount2 !== undefined) editedProduct.Discount2 = existingEdit.Discount2;
        if (existingEdit.KeepBasePrice) editedProduct.KeepBasePrice = true;
      }
      console.log(`🔄 [transformToEditedProduct] Restored edit for ${product.Code}:`, {
        Edited: editedProduct.Edited,
        NewCode: editedProduct.Code,
        OriginalCode: editedProduct.OriginalCode,
        NewName: editedProduct.Name,
        OriginalName: (editedProduct as any).OriginalName
      });
    }

    // Set immutable _constBasePrice
    Object.defineProperty(editedProduct, '_constBasePrice', {
      value: product.BasePrice,
      writable: false,
      enumerable: false,
      configurable: false
    });

    return editedProduct;
  }

  /**
   * Cache search results to localStorage
   */
  private cacheSearchResults(searchTerm: string, products: EditedProduct[]): void {
    try {
      const key = `search_${searchTerm.replace(/ /g, '_')}`;
      localStorage.setItem(key, JSON.stringify(products));
    } catch (error) {
      console.warn('Failed to cache search results:', error);
    }
  }

  /**
   * Cache grouped products to localStorage for cost.service.ts
   * Groups products by Code of Master (smallest ConversionValue = base unit)
   */
  private cacheGroupedProducts(
    searchTerm: string,
    groupedByMasterId: Record<number, any[]>,
    sortedProducts: EditedProduct[]
  ): void {
    try {
      // Create grouped structure by Master Code for cost.service.ts
      const groupedByCode: Record<string, EditedProduct[]> = {};

      Object.values(groupedByMasterId).forEach((group: any[]) => {
        if (group.length === 0) return;

        // Find the master (smallest ConversionValue = base unit)
        const master = sortedProducts.find(p =>
          group.some(g => g.Id === p.Id) && p.Master
        );

        if (master && master.Code) {
          // Group all products under the master's Code
          const groupProducts = sortedProducts.filter(p =>
            group.some(g => g.Id === p.Id)
          );

          // Add ListProduct to master for compatibility
          const masterWithList = {
            ...master,
            ListProduct: groupProducts.filter(p => p.Id !== master.Id)
          };

          groupedByCode[master.Code] = groupProducts.map(p =>
            p.Id === master.Id ? masterWithList : p
          );
        }
      });

      const key = `grouped_${searchTerm.replace(/ /g, '_')}`;
      localStorage.setItem(key, JSON.stringify(groupedByCode));
    } catch (error) {
      console.warn('Failed to cache grouped products:', error);
    }
  }

  /**
   * Save edited products to localStorage
   */
  saveEditedProducts(searchTerm: string): void {
    console.log('🔵 [saveEditedProducts] Starting for searchTerm:', searchTerm);

    // Get all edited products from editing_childProduct_*
    const editedProductsMap = new Map<string, any>();
    const editedProductsByIdMap = new Map<string, any>(); // Map by Id for reliable lookup

    Object.entries(localStorage)
      .filter(([key]) => key.startsWith('editing_childProduct_'))
      .forEach(([key, value]) => {
        const product = JSON.parse(value);
        // Map by OriginalCode (OLD Code) for lookup
        const mapKey = product.OriginalCode || product.Code;
        editedProductsMap.set(mapKey, product);

        // Also map by Id for reliable lookup when Code has changed
        if (product.Id) {
          editedProductsByIdMap.set(String(product.Id), product);
        }

        console.log(`  📝 Loaded edited product from ${key}:`, {
          Code: product.Code,
          OriginalCode: product.OriginalCode,
          Name: product.Name,
          OriginalName: product.OriginalName,
          Id: product.Id,
          Edited: product.Edited
        });
      });

    // Get the original grouped structure from grouped_*
    const groupedKey = `grouped_${searchTerm.replace(/ /g, '_')}`;
    const originalGrouped = localStorage.getItem(groupedKey);

    if (!originalGrouped) {
      console.warn('No grouped products found for search term:', searchTerm);
      showNotification('Không tìm thấy dữ liệu gốc để lưu!');
      return;
    }

    const groupedProducts: Record<string, any[]> = JSON.parse(originalGrouped);

    // Update the grouped structure with edited values
    Object.keys(groupedProducts).forEach(masterCode => {
      groupedProducts[masterCode] = groupedProducts[masterCode].map(product => {
        // CRITICAL: Try multiple lookup strategies
        // 1. Try lookup by Code (OLD Code from grouped_*)
        let editedProduct = editedProductsMap.get(product.Code);

        // 2. If not found, try lookup by Id (most reliable)
        if (!editedProduct && product.Id) {
          editedProduct = editedProductsByIdMap.get(String(product.Id));
          if (editedProduct) {
            console.log(`  ✅ Found edited product by Id for ${product.Code} → ${editedProduct.Code}`);
          }
        }

        if (editedProduct) {
          console.log(`  🔄 Merging edited product into grouped:`, {
            OldCode: product.Code,
            NewCode: editedProduct.Code,
            OldName: product.Name,
            NewName: editedProduct.Name,
            Edited: editedProduct.Edited
          });

          // Merge edited values into the product
          return {
            ...product,
            ...editedProduct,
            // Preserve ListProduct structure if it's the master
            ListProduct: product.Master ? product.ListProduct : undefined
          };
        }
        return product;
      });
    });

    console.log('✅ [saveEditedProducts] Final grouped structure:', groupedProducts);

    const allEditedProducts = [groupedProducts];
    this.saveToLocalStorage(searchTerm, allEditedProducts);
    this.cleanEditingLocalStorage();
  }

  /**
   * Save to localStorage
   */
  private saveToLocalStorage(searchTerm: string, data: any): void {
    localStorage.setItem(`edited_products_${searchTerm}`, JSON.stringify(data));
  }

  /**
   * Clean editing localStorage entries
   */
  private cleanEditingLocalStorage(): void {
    Object.keys(localStorage).forEach((key) => {
      if (key && key.startsWith('editing_')) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('grouped_') ||
          key.startsWith('search_') ||
          key.startsWith('edited_products_') ||
          key.startsWith('editing_childProduct_')
        )) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => localStorage.removeItem(key));
      showNotification('Đã xóa cache thành công!');
    } catch (error) {
      console.error('Error clearing localStorage:', error);
    }
  }

  /**
   * Get edited products for display in dialog
   */
  getEditedProductsForDialog(): any[] {
    const editedProducts = Object.keys(localStorage)
      .filter((key) => key.startsWith('edited_products_'))
      .map((key) => JSON.parse(localStorage.getItem(key) || '[]'));

    const oldProducts = Object.keys(localStorage)
      .filter((key) => key.startsWith('grouped_'))
      .map((key) => JSON.parse(localStorage.getItem(key) || '[]'));

    const editedProductKeys: any[] = [];
    editedProducts.forEach((editedProduct: any) => {
      editedProduct.forEach((i: any) => {
        editedProductKeys.push(Object.keys(i));
      });
    });

    // Process and filter only products that actually changed
    const filteredEditedProducts: any[] = [];

    editedProducts.forEach((editedProduct: any) => {
      editedProductKeys.forEach((keys) => {
        oldProducts.forEach((oldProduct) => {
          keys.forEach((key: any) => {
            if (oldProduct[key]) {
              editedProduct.forEach((editedItem: any) => {
                const filteredGroup: any = {};

                Object.entries(editedItem).forEach(([groupKey, productList]: [string, any]) => {
                  const changedProducts: any[] = [];

                  productList.forEach((p: any) => {
                    if (p.FinalBasePrice > 0) {
                      p.BasePrice = p.FinalBasePrice;
                    }
                    // Remove FinalBasePrice from object - it's only for UI calculation
                    delete p.FinalBasePrice;

                    const matchingOldItem = oldProduct[key].find(
                      (oldItem: any) => oldItem.Code === p.Code
                    );

                    if (matchingOldItem) {
                      p['OldCost'] = matchingOldItem.Cost;
                      p['OldBasePrice'] = matchingOldItem.BasePrice;

                      // Check if product actually changed
                      const hasChanged =
                        p.BasePrice !== matchingOldItem.BasePrice ||
                        p.Cost !== matchingOldItem.Cost ||
                        p.OnHand !== matchingOldItem.OnHand ||
                        p.FullName !== matchingOldItem.FullName ||
                        p.Code !== matchingOldItem.Code;

                      if (hasChanged) {
                        changedProducts.push(p);
                      }
                    }
                  });

                  if (changedProducts.length > 0) {
                    filteredGroup[groupKey] = changedProducts;
                  }
                });

                if (Object.keys(filteredGroup).length > 0) {
                  filteredEditedProducts.push(filteredGroup);
                }
              });
            }
          });
        });
      });
    });

    return filteredEditedProducts.length > 0 ? filteredEditedProducts : editedProducts;
  }

  /**
   * Format number with thousand separator
   */
  formatNumber(value: any): string {
    const num = Number(value);
    if (isNaN(num)) return '';
    return num.toLocaleString('en-US');
  }
}
