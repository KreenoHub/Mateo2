// data/idb.js - IndexedDB wrapper for offline storage

const DB_NAME = 'TableHubDB';
const DB_VERSION = 1;

class IDBStore {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Tables store
                if (!db.objectStoreNames.contains('tables')) {
                    const tablesStore = db.createObjectStore('tables', { keyPath: 'id' });
                    tablesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }

                // Changes store (outbox queue)
                if (!db.objectStoreNames.contains('changes')) {
                    const changesStore = db.createObjectStore('changes', { keyPath: 'id', autoIncrement: true });
                    changesStore.createIndex('timestamp', 'timestamp', { unique: false });
                    changesStore.createIndex('synced', 'synced', { unique: false });
                }

                // Meta store (sync metadata)
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'key' });
                }
            };
        });
    }

    async transaction(storeNames, mode = 'readonly') {
        if (!this.db) await this.init();
        return this.db.transaction(storeNames, mode);
    }

    // Tables CRUD
    async getAllTables() {
        const tx = await this.transaction(['tables'], 'readonly');
        const store = tx.objectStore('tables');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getTable(id) {
        const tx = await this.transaction(['tables'], 'readonly');
        const store = tx.objectStore('tables');
        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveTable(table) {
        const tx = await this.transaction(['tables'], 'readwrite');
        const store = tx.objectStore('tables');
        return new Promise((resolve, reject) => {
            const request = store.put(table);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteTable(id) {
        const tx = await this.transaction(['tables'], 'readwrite');
        const store = tx.objectStore('tables');
        return new Promise((resolve, reject) => {
            const request = store.delete(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Changes queue
    async addChange(change) {
        const tx = await this.transaction(['changes'], 'readwrite');
        const store = tx.objectStore('changes');
        const changeWithMeta = {
            ...change,
            timestamp: Date.now(),
            synced: false
        };
        return new Promise((resolve, reject) => {
            const request = store.add(changeWithMeta);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getUnsyncedChanges() {
        const tx = await this.transaction(['changes'], 'readonly');
        const store = tx.objectStore('changes');
        const index = store.index('synced');
        return new Promise((resolve, reject) => {
            const request = index.getAll(false);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async markChangesSynced(ids) {
        const tx = await this.transaction(['changes'], 'readwrite');
        const store = tx.objectStore('changes');
        
        const promises = ids.map(id => {
            return new Promise((resolve, reject) => {
                const getRequest = store.get(id);
                getRequest.onsuccess = () => {
                    const change = getRequest.result;
                    if (change) {
                        change.synced = true;
                        const putRequest = store.put(change);
                        putRequest.onsuccess = () => resolve();
                        putRequest.onerror = () => reject(putRequest.error);
                    } else {
                        resolve();
                    }
                };
                getRequest.onerror = () => reject(getRequest.error);
            });
        });
        
        return Promise.all(promises);
    }

    async clearSyncedChanges() {
        const tx = await this.transaction(['changes'], 'readwrite');
        const store = tx.objectStore('changes');
        const index = store.index('synced');
        
        return new Promise((resolve, reject) => {
            const request = index.openCursor(true);
            let deleted = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                } else {
                    resolve(deleted);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // Metadata
    async getMeta(key) {
        const tx = await this.transaction(['meta'], 'readonly');
        const store = tx.objectStore('meta');
        return new Promise((resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value);
            request.onerror = () => reject(request.error);
        });
    }

    async setMeta(key, value) {
        const tx = await this.transaction(['meta'], 'readwrite');
        const store = tx.objectStore('meta');
        return new Promise((resolve, reject) => {
            const request = store.put({ key, value });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // Bulk operations
    async importTables(tables) {
        const tx = await this.transaction(['tables'], 'readwrite');
        const store = tx.objectStore('tables');
        
        const promises = tables.map(table => {
            return new Promise((resolve, reject) => {
                const request = store.put(table);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
        
        return Promise.all(promises);
    }

    async clearAll() {
        const tx = await this.transaction(['tables', 'changes', 'meta'], 'readwrite');
        
        const promises = [
            new Promise((resolve, reject) => {
                const request = tx.objectStore('tables').clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            }),
            new Promise((resolve, reject) => {
                const request = tx.objectStore('changes').clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            }),
            new Promise((resolve, reject) => {
                const request = tx.objectStore('meta').clear();
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            })
        ];
        
        return Promise.all(promises);
    }
}

export const idb = new IDBStore();