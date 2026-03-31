import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';

@Injectable({
  providedIn: 'root'
})
export class IndexedDBService {
  private dbs: Record<string, Promise<IDBPDatabase>> = {};
  private dbConnections: Record<string, IDBPDatabase | null> = {};
  private connectionStatus: Record<string, boolean> = {};

  // No constructor needed

  async getDB(dbName: string, version: number, upgradeFn?: (db: IDBPDatabase) => void): Promise<IDBPDatabase> {
    // Return existing open connection if still valid
    if (this.dbConnections[dbName] && this.connectionStatus[dbName]) {
      return this.dbConnections[dbName]!;
    }

    // Helper to actually open the DB and store references
    const openAndStore = async (targetVersion?: number, upgrade?: (db: IDBPDatabase) => void) => {
      const vText = targetVersion ? ` v${targetVersion}` : '';
      console.log(`🔄 Opening DB ${dbName}${vText}`);
      this.dbs[dbName] = targetVersion ? openDB(dbName, targetVersion, {
        upgrade: upgrade,
        blocked: (event) => console.warn(`⚠️ Database ${dbName} blocked (version conflict). Event:`, event),
        blocking: (event) => {
          console.warn(`⚠️ Database ${dbName} received blocking event, closing old connection. Event:`, event);
          try { this.closeDB(dbName); } catch (err) { console.error(`❌ Error while closing DB ${dbName} during blocking:`, err); }
        }
      }) : openDB(dbName);

      try {
        this.dbConnections[dbName] = await this.dbs[dbName];
        this.connectionStatus[dbName] = true;
        console.log(`✅ Connection opened for ${dbName} v${this.dbConnections[dbName]?.version}`);
        return this.dbConnections[dbName]!;
      } catch (err) {
        console.error(`❌ Failed to open DB ${dbName}:`, err);
        this.dbConnections[dbName] = null;
        this.connectionStatus[dbName] = false;
        delete this.dbs[dbName];
        throw err;
      }
    };

    // If DB already exists with a higher version than requested, open the current DB instead
    try {
      // Check if DB exists first by trying to get its info
      // Note: indexedDB.databases() may not be available in all browsers
      let dbExists = true; // Assume exists by default for fallback
      if (typeof indexedDB.databases === 'function') {
        const databases = await indexedDB.databases();
        dbExists = databases.some((db: any) => db.name === dbName);
      }

      if (!dbExists) {
        // DB does not exist - create it with requested version and upgradeFn
        console.log(`📦 DB ${dbName} does not exist, creating with v${version}`);
        return await openAndStore(version, upgradeFn);
      }

      // Try opening without specifying version to get the existing DB/version
      const existing = await openDB(dbName).catch(() => null);
      if (existing) {
        const existingVersion = existing.version;
        const stores = Array.from(existing.objectStoreNames);
        // If the existing version is greater than requested and no upgradeFn provided,
        // return the existing DB to avoid VersionError
        if (existingVersion > version) {
          console.warn(`⚠️ Requested version (${version}) is less than existing DB version (${existingVersion}). Using existing DB version.`);
          // close the temporary handle and use openAndStore without version to reuse same version
          existing.close();
          return await openAndStore();
        }

        // If existing version equals requested but stores may be missing, and an upgradeFn is provided,
        // bump version to force upgrade and run upgradeFn
        if (existingVersion === version && upgradeFn) {
          // Check if object stores are empty - this indicates DB was created but upgrade never ran
          const storesExist = stores.length > 0;
          existing.close();

          if (!storesExist) {
            // Object stores don't exist - need to bump version and run upgrade
            console.log(`⚠️ DB ${dbName} has no object stores, bumping version to force upgrade`);
            return await openAndStore(existingVersion + 1, upgradeFn);
          }
          return await openAndStore();
        }

        // If existingVersion < requested version, open with requested version and run upgradeFn
        if (existingVersion < version) {
          existing.close();
          return await openAndStore(version, upgradeFn);
        }

        // Otherwise, return existing
        existing.close();
        return await openAndStore();
      } else {
        // DB does not exist yet — open with requested version (may create object stores in upgrade)
        return await openAndStore(version, upgradeFn);
      }
    } catch (err) {
      // Fallback: try to open with requested version directly; this will raise VersionError if lower than existing
      console.warn(`⚠️ Error while probing existing DB version for ${dbName}:`, err);
      return await openAndStore(version, upgradeFn);
    }
  }

  // Đóng connection
  async closeDB(dbName: string): Promise<void> {
    if (this.dbConnections[dbName]) {
      this.dbConnections[dbName]!.close();
      console.log(`🔌 Đã đóng connection cho database: ${dbName}`);
    }
    this.dbConnections[dbName] = null;
    this.connectionStatus[dbName] = false;
    delete this.dbs[dbName];
  }

  // Retry mechanism
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    delay = 100
  ): Promise<T> {
    let lastError: unknown;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error;
        const msg = (error as any)?.message ?? String(error);
        console.warn(`⚠️ Lần thử ${i + 1}/${maxRetries} thất bại:`, msg);

        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
      }
    }

    throw lastError;
  }

  // Đọc tất cả với retry (generic)
  async getAll<T = unknown>(dbName: string, version: number, storeName: string): Promise<T[]> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB GETALL -> db=${dbName} v=${db.version} stores=${Array.from(db.objectStoreNames).join(',')}`);
      const tx = db.transaction(storeName, 'readonly');
      const result = await tx.store.getAll();
      await tx.done;
      return result as T[];
    });
  }

  async count(dbName: string, version: number, storeName: string): Promise<number> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB COUNT -> db=${dbName} v=${db.version} store=${storeName}`);
      const tx = db.transaction(storeName, 'readonly');
      const total = await tx.store.count();
      await tx.done;
      return total;
    });
  }

  // Đọc theo key với retry
  async getByKey<T = unknown>(dbName: string, version: number, storeName: string, key: IDBValidKey | unknown): Promise<T | undefined> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB GETBYKEY -> db=${dbName} v=${db.version} store=${storeName} key=${key}`);
      const tx = db.transaction(storeName, 'readonly');
      const result = await tx.store.get(key as IDBValidKey);
      await tx.done;
      return result as T | undefined;
    });
  }

  // Ghi (put) với retry
  async put<T = unknown>(dbName: string, version: number, storeName: string, value: T): Promise<void> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB PUT -> db=${dbName} v=${db.version} store=${storeName}`);
      const tx = db.transaction(storeName, 'readwrite');
      await tx.store.put(value as any);
      await tx.done;
    });
  }

  // Ghi nhiều với retry
  async putMany<T = unknown>(dbName: string, version: number, storeName: string, values: T[]): Promise<void> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB PUTMANY -> db=${dbName} v=${db.version} store=${storeName} count=${values.length}`);
      const tx = db.transaction(storeName, 'readwrite');
      for (const value of values) {
        await tx.store.put(value as any);
      }
      await tx.done;
    });
  }

  // Xóa theo key với retry
  async delete(dbName: string, version: number, storeName: string, key: IDBValidKey | unknown): Promise<void> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB DELETE -> db=${dbName} v=${db.version} store=${storeName} key=${key}`);
      const tx = db.transaction(storeName, 'readwrite');
      await tx.store.delete(key as IDBValidKey);
      await tx.done;
    });
  }

  // Xóa tất cả với retry
  async clear(dbName: string, version: number, storeName: string): Promise<void> {
    return this.retryOperation(async () => {
      const db = await this.getDB(dbName, version);
      console.log(`DB CLEAR -> db=${dbName} v=${db.version} store=${storeName}`);
      const tx = db.transaction(storeName, 'readwrite');
      await tx.store.clear();
      await tx.done;
    });
  }

  // Kiểm tra trạng thái connection
  isConnectionOpen(dbName: string): boolean {
    return this.connectionStatus[dbName] || false;
  }

  // Lấy thông tin connection
  getConnectionInfo(dbName: string): { isOpen: boolean; version?: number } {
    const connection = this.dbConnections[dbName];
    return {
      isOpen: this.connectionStatus[dbName] || false,
      version: connection?.version
    };
  }

  // Kiểm tra xem object store có tồn tại không
  async checkObjectStoreExists(dbName: string, version: number, storeName: string): Promise<boolean> {
    try {
      const db = await this.getDB(dbName, version);
      return db.objectStoreNames.contains(storeName);
    } catch (error) {
      console.error(`❌ Lỗi khi kiểm tra object store '${storeName}':`, error);
      return false;
    }
  }

  // Lấy danh sách tất cả object stores trong database
  async getObjectStoreNames(dbName: string, version: number): Promise<string[]> {
    try {
      const db = await this.getDB(dbName, version);
      return Array.from(db.objectStoreNames);
    } catch (error) {
      console.error(`❌ Lỗi khi lấy danh sách object stores cho '${dbName}':`, error);
      return [];
    }
  }
}