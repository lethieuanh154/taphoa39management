import { Injectable } from '@angular/core';
import { CartItem } from '../models/cart-item.model';
import { InvoiceTab } from '../models/invoice.model';
@Injectable({
  providedIn: 'root'
})
export class LocalStorageService {

  constructor() { }
   public setItem<T>(key: string, value: T): void {
    try {
      const serializedValue = JSON.stringify(value);
      sessionStorage.setItem(key, serializedValue);
    } catch (error) {
      console.error(`Error saving to sessionStorage with key "${key}":`, error);
    }
  }

  public getItem<T>(key: string): T | null {
    try {
      const item = sessionStorage.getItem(key);
      if (item === null) {
        return null;
      }
      return JSON.parse(item) as T;
    } catch (error) {
      console.error(`Error getting from sessionStorage with key "${key}":`, error);
      return null;
    }
  }

  private removeItem(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error(`Error removing from sessionStorage with key "${key}":`, error);
    }
  }

  private hasItem(key: string): boolean {
    return sessionStorage.getItem(key) !== null;
  }

  // CartItems specific methods
  saveCartItems(cartItems: CartItem[], activeTabIndex = 0): void {
    const key = `cartItems_tab_${activeTabIndex}`;
    this.setItem(key, cartItems);
  }

  getCartItems(activeTabIndex = 0): CartItem[] {
    const key = `cartItems_tab_${activeTabIndex}`;
    const cartItems = this.getItem<CartItem[]>(key);
    return cartItems || [];
  }

  clearCartItems(activeTabIndex = 0): void {
    const key = `cartItems_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  hasCartItems(activeTabIndex = 0): boolean {
    const key = `cartItems_tab_${activeTabIndex}`;
    return this.hasItem(key);
  }

  // Invoice tabs specific methods
  saveInvoiceTabs(invoices: InvoiceTab[]): void {
    this.setItem('invoice_tabs', invoices);
  }

  getInvoiceTabs(): InvoiceTab[] {
    const invoices = this.getItem<InvoiceTab[]>('invoice_tabs');
    return invoices || [];
  }

  clearInvoiceTabs(): void {
    this.removeItem('invoice_tabs');
  }

  // Active tab index
  saveActiveTabIndex(index: number): void {
    this.setItem('active_tab_index', index);
  }

  getActiveTabIndex(): number {
    const index = this.getItem<number>('active_tab_index');
    return index !== null ? index : 0;
  }

  clearActiveTabIndex(): void {
    this.removeItem('active_tab_index');
  }

  // Discount amount
  saveDiscountAmount(discountAmount: number, activeTabIndex = 0): void {
    const key = `discount_amount_tab_${activeTabIndex}`;
    this.setItem(key, discountAmount);
  }

  getDiscountAmount(activeTabIndex = 0): number {
    const key = `discount_amount_tab_${activeTabIndex}`;
    const discount = this.getItem<number>(key);
    return discount !== null ? discount : 0;
  }

  clearDiscountAmount(activeTabIndex = 0): void {
    const key = `discount_amount_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  // Selected customer
  saveSelectedCustomer(customer: any, activeTabIndex = 0): void {
    const key = `selected_customer_tab_${activeTabIndex}`;
    this.setItem(key, customer);
  }

  getSelectedCustomer(activeTabIndex = 0): any {
    const key = `selected_customer_tab_${activeTabIndex}`;
    return this.getItem(key);
  }

  clearSelectedCustomer(activeTabIndex = 0): void {
    const key = `selected_customer_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  // Invoice note
  saveInvoiceNote(note: string, activeTabIndex = 0): void {
    const key = `invoice_note_tab_${activeTabIndex}`;
    this.setItem(key, note);
  }

  getInvoiceNote(activeTabIndex = 0): string {
    const key = `invoice_note_tab_${activeTabIndex}`;
    const note = this.getItem<string>(key);
    return note || '';
  }

  clearInvoiceNote(activeTabIndex = 0): void {
    const key = `invoice_note_tab_${activeTabIndex}`;
    this.removeItem(key);
  }

  // Clear all data for a specific tab
  // NOTE: Chỉ xóa dữ liệu riêng của tab, KHÔNG xóa toàn bộ invoice_tabs
  clearTabData(activeTabIndex: number): void {
    this.clearCartItems(activeTabIndex);
    this.clearDiscountAmount(activeTabIndex);
    this.clearSelectedCustomer(activeTabIndex);
    this.clearInvoiceNote(activeTabIndex);
    // ❌ REMOVED: this.clearInvoiceTabs() - Lỗi nghiêm trọng: xóa toàn bộ tabs thay vì 1 tab
    // Invoice tabs sẽ được cập nhật riêng bởi saveInvoiceTabs() sau khi splice
  }

  /**
   * Clear ALL tab-specific sessionStorage keys.
   * Called after invoice tab removal to prevent stale data from old indices.
   */
  clearAllTabSpecificData(): void {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (
          key.startsWith('cartItems_tab_') ||
          key.startsWith('discount_amount_tab_') ||
          key.startsWith('selected_customer_tab_') ||
          key.startsWith('invoice_note_tab_')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => sessionStorage.removeItem(key));
    } catch (error) {
      console.error('Error clearing all tab-specific data:', error);
    }
  }

  /**
   * Rebuild tab-specific localStorage from invoices array.
   * Called after tab removal to ensure localStorage indices match invoices array.
   */
  rebuildTabDataFromInvoices(invoices: InvoiceTab[]): void {
    // DEBUG: Log state before rebuild
    console.log('🔄 rebuildTabDataFromInvoices called', {
      invoicesCount: invoices?.length || 0,
      invoicesData: invoices?.map((inv, i) => ({
        index: i,
        name: inv.name,
        cartItemsLength: inv.cartItems?.length || 0,
        cartItemsSample: inv.cartItems?.slice(0, 2).map(item => ({
          productName: item?.product?.Name,
          quantity: item?.quantity
        }))
      }))
    });

    // First clear all old tab data
    this.clearAllTabSpecificData();

    // Then save data for each invoice
    invoices.forEach((invoice, index) => {
      // Save cart items (redundant since we use invoice.cartItems, but for compatibility)
      if (invoice.cartItems && invoice.cartItems.length > 0) {
        this.saveCartItems(invoice.cartItems, index);
      }
      // Save discount
      if (invoice.discountAmount) {
        this.saveDiscountAmount(invoice.discountAmount, index);
      }
      // Save customer
      if (invoice.customer) {
        this.saveSelectedCustomer(invoice.customer, index);
      }
      // Save note
      if (invoice.note) {
        this.saveInvoiceNote(invoice.note, index);
      }
    });

    // Save invoice tabs
    this.saveInvoiceTabs(invoices);
  }

  // Clear all localStorage data
  // clearAllData(): void {
  //   try {
  //     // Get all keys that start with our prefixes
  //     const keysToRemove: string[] = [];
  //     for (let i = 0; i < localStorage.length; i++) {
  //       const key = localStorage.key(i);
  //       if (key && (
  //         key.startsWith('cartItems_tab_') ||
  //         key.startsWith('discount_amount_tab_') ||
  //         key.startsWith('selected_customer_tab_') ||
  //         key.startsWith('invoice_note_tab_') ||
  //          key.startsWith('grouped_') ||
  //           key.startsWith('search_') ||
  //            key.startsWith('edited_products_') ||
  //         key === 'invoice_tabs' ||
  //         key === 'active_tab_index'
  //       )) {
  //         keysToRemove.push(key);
  //       }
  //     }
      
  //     // Remove all identified keys
  //     keysToRemove.forEach(key => localStorage.removeItem(key));
  //   } catch (error) {
  //     console.error('Error clearing all localStorage data:', error);
  //   }
  // }

  // Utility method to get sessionStorage size (for debugging)
  getStorageSize(): string {
    let total = 0;
    for (const key in sessionStorage) {
      if (sessionStorage.hasOwnProperty(key)) {
        total += sessionStorage[key].length + key.length;
      }
    }
    return (total / 1024).toFixed(2) + ' KB';
  }

  // Method to check if sessionStorage is available
  isStorageAvailable(): boolean {
    try {
      const test = '__sessionStorage_test__';
      sessionStorage.setItem(test, test);
      sessionStorage.removeItem(test);
      return true;
    } catch (error) {
      return false;
    }
  }
}
