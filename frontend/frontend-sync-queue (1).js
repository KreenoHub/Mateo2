// sync/queue.js - Change queue management

import { idb } from '../data/idb.js';

class SyncQueue {
    constructor() {
        this.pending = [];
        this.processing = false;
    }

    async enqueue(operation) {
        // Add to IndexedDB
        const id = await idb.addChange(operation);
        
        // Add to memory queue
        this.pending.push({
            id,
            ...operation
        });

        // Trigger sync if online and auto-sync enabled
        if (navigator.onLine && this.shouldAutoSync()) {
            this.processPending();
        }

        return id;
    }

    async enqueueTableChange(tableId, op, data) {
        const clientId = await this.getClientId();
        const change = {
            op,
            tableId,
            ...data,
            ts: Date.now(),
            clientId
        };
        
        return this.enqueue(change);
    }

    async enqueueCellChange(tableId, rowId, col, value) {
        return this.enqueueTableChange(tableId, 'setCell', {
            rowId,
            col,
            value
        });
    }

    async enqueueRowAdd(tableId, rowId, afterRowId = null) {
        return this.enqueueTableChange(tableId, 'addRow', {
            rowId,
            afterRowId
        });
    }

    async enqueueRowDelete(tableId, rowId) {
        return this.enqueueTableChange(tableId, 'deleteRow', {
            rowId
        });
    }

    async enqueueColumnAdd(tableId, colIndex, header = '') {
        return this.enqueueTableChange(tableId, 'addColumn', {
            colIndex,
            header
        });
    }

    async enqueueColumnDelete(tableId, colIndex) {
        return this.enqueueTableChange(tableId, 'deleteColumn', {
            colIndex
        });
    }

    async enqueueHeaderChange(tableId, colIndex, header) {
        return this.enqueueTableChange(tableId, 'setHeader', {
            colIndex,
            header
        });
    }

    async enqueueTableRename(tableId, name) {
        return this.enqueueTableChange(tableId, 'renameTable', {
            name
        });
    }

    async enqueueTableDelete(tableId) {
        return this.enqueueTableChange(tableId, 'deleteTable', {});
    }

    async loadPending() {
        this.pending = await idb.getUnsyncedChanges();
        return this.pending;
    }

    async processPending() {
        if (this.processing || this.pending.length === 0) {
            return;
        }

        this.processing = true;
        
        try {
            // Get batch of changes to sync
            const batch = this.pending.slice(0, 100); // Limit batch size
            const cursor = await idb.getMeta('syncCursor') || '0';
            
            // Prepare sync payload
            const payload = {
                clientId: await this.getClientId(),
                baseCursor: cursor,
                ops: batch.map(change => ({
                    op: change.op,
                    tableId: change.tableId,
                    rowId: change.rowId,
                    col: change.col,
                    value: change.value,
                    afterRowId: change.afterRowId,
                    colIndex: change.colIndex,
                    header: change.header,
                    name: change.name,
                    ts: change.ts || change.timestamp
                }))
            };

            // Send to server
            const response = await this.syncWithServer(payload);
            
            if (response.success) {
                // Mark changes as synced
                const ids = batch.map(c => c.id);
                await idb.markChangesSynced(ids);
                
                // Update cursor
                await idb.setMeta('syncCursor', response.cursor);
                
                // Remove from pending
                this.pending = this.pending.filter(c => !ids.includes(c.id));
                
                // Process any deltas from server
                if (response.deltas && response.deltas.length > 0) {
                    await this.applyServerDeltas(response.deltas);
                }
                
                // Continue if more pending
                if (this.pending.length > 0) {
                    setTimeout(() => this.processPending(), 100);
                }
            }
        } catch (error) {
            console.error('Sync failed:', error);
            // Retry after delay
            setTimeout(() => this.processPending(), 5000);
        } finally {
            this.processing = false;
        }
    }

    async syncWithServer(payload) {
        const serverUrl = await idb.getMeta('serverUrl');
        if (!serverUrl) {
            throw new Error('No server URL configured');
        }

        const response = await fetch(`${serverUrl}/api/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.statusText}`);
        }

        return response.json();
    }

    async applyServerDeltas(deltas) {
        // This will be handled by reconcile.js
        const { reconcile } = await import('./reconcile.js');
        await reconcile.applyDeltas(deltas);
    }

    async getClientId() {
        let clientId = await idb.getMeta('clientId');
        if (!clientId) {
            clientId = this.generateClientId();
            await idb.setMeta('clientId', clientId);
        }
        return clientId;
    }

    generateClientId() {
        return 'client_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    shouldAutoSync() {
        // Check auto-sync setting
        const autoSync = localStorage.getItem('autoSync');
        return autoSync !== 'false';
    }

    async drain() {
        await this.loadPending();
        if (this.pending.length > 0 && navigator.onLine) {
            await this.processPending();
        }
    }

    getPendingCount() {
        return this.pending.length;
    }
}

export const syncQueue = new SyncQueue();