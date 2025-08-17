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