import { IDBPDatabase } from 'idb';

export const SALES_DB_NAME = 'SalesDB';
export const SALES_DB_VERSION = 7;

/**
 * Centralized upgrade function for SalesDB.
 * Creates ALL required object stores in a single upgrade transaction.
 * Every service that uses SalesDB MUST use this instead of its own upgrade logic.
 */
export function salesDBUpgrade(db: IDBPDatabase): void {
  if (!db.objectStoreNames.contains('products')) {
    db.createObjectStore('products', { keyPath: 'Id' });
  }
  if (!db.objectStoreNames.contains('categories')) {
    const store = db.createObjectStore('categories', { keyPath: 'Id' });
    store.createIndex('Name', 'Name', { unique: false });
    store.createIndex('Path', 'Path', { unique: false });
  }
  if (!db.objectStoreNames.contains('categoriesMeta')) {
    db.createObjectStore('categoriesMeta', { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains('promotions')) {
    db.createObjectStore('promotions', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('invoiceDrafts')) {
    db.createObjectStore('invoiceDrafts', { keyPath: 'sessionId' });
  }
  if (!db.objectStoreNames.contains('invoiceProductMappings')) {
    const store = db.createObjectStore('invoiceProductMappings', { keyPath: 'id' });
    store.createIndex('supplierTaxCode', 'supplierTaxCode', { unique: false });
  }
}
