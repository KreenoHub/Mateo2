// sync/queue.js - Change queue management

import { idb } from '../data/idb.js';
import { state } from '../core/state.js';
import { reconcile } from './reconcile.js';

class SyncQueue {
    constructor() {
        this.pending = [];
        this.processing = false;
    }

    async enqueue(operation) {
        const id = await idb.addChange(operation);
        this.pending.push({ id, ...operation });
        if (navigator.onLine && this.shouldAutoSync()) {
            this.processPending();
        }
        return id;
    }

    async enqueueTableChange(tableId, op, data) {
        const clientId = await this.getClientId();
        const change = { op, tableId, ...data, ts: Date.now(), clientId };
        return this.enqueue(change);
    }

    async enqueueCellChange(tableId, rowId, col, value) {
        return this.enqueueTableChange(tableId, 'setCell', { rowId, col, value });
    }

    async enqueueRowAdd(tableId, rowId, afterRowId = null) {
        return this.enqueueTableChange(tableId, 'addRow', { rowId, afterRowId });
    }

    async enqueueRowDelete(tableId, rowId) {
        return this.enqueueTableChange(tableId, 'deleteRow', { rowId });
    }

    async enqueueColumnAdd(tableId, colIndex, header = '') {
        return this.enqueueTableChange(tableId, 'addColumn', { colIndex, header });
    }

    async enqueueColumnDelete(tableId, colIndex) {
        return this.enqueueTableChange(tableId, 'deleteColumn', { colIndex });
    }

    async enqueueHeaderChange(tableId, colIndex, header) {
        return this.enqueueTableChange(tableId, 'setHeader', { colIndex, header });
    }

    async enqueueTableRename(tableId, name) {
        return this.enqueueTableChange(tableId, 'renameTable', { name });
    }

    async enqueueTableDelete(tableId) {
        return this.enqueueTableChange(tableId, 'deleteTable', {});
    }

    async loadPending() {
        this.pending = await idb.getUnsyncedChanges();
        return this.pending;
    }

    async processPending() {
        if (this.processing) return;
        this.processing = true;
        try {
            const serverUrl = state.settings.serverUrl;
            if (!serverUrl) throw new Error('Server URL not configured');

            const clientId = await this.getClientId();
            const baseCursor = await idb.getMeta('syncCursor') || '0';
            const ops = this.pending.map(({ id, ...rest }) => rest);

            const res = await fetch(`${serverUrl}/api/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, baseCursor, ops })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.success === false) throw new Error(data.error || 'Sync failed');

            if (this.pending.length) {
                const ids = this.pending.map(c => c.id);
                await idb.markChangesSynced(ids);
                await idb.clearSyncedChanges();
                this.pending = [];
            }

            if (data.deltas && data.deltas.length) {
                await reconcile.applyDeltas(data.deltas);
            }
            if (data.tables && data.tables.length) {
                await state.importData({ tables: data.tables });
            }
            if (data.cursor) {
                await idb.setMeta('syncCursor', data.cursor);
            }
        } catch (err) {
            console.error('Sync failed:', err);
            throw err;
        } finally {
            this.processing = false;
        }
    }

    async getClientId() {
        if (state.clientId) return state.clientId;
        const id = await idb.getMeta('clientId');
        state.clientId = id;
        return id;
    }

    shouldAutoSync() {
        return state.settings.autoSync;
    }
}

export const syncQueue = new SyncQueue();
