// core/state.js - Application state management

import { idb } from '../data/idb.js';

class AppState {
    constructor() {
        this.tables = [];
        this.currentTable = null;
        this.syncStatus = 'offline';
        this.settings = {
            serverUrl: '',
            autoSync: true
        };
        this.listeners = new Set();
    }

    async init() {
        // Load tables from IndexedDB
        this.tables = await idb.getAllTables();
        
        // Initialize with seed data if empty
        if (this.tables.length === 0) {
            await this.seedInitialTables();
        }

        // Load settings
        this.settings.serverUrl = await idb.getMeta('serverUrl') || '';
        this.settings.autoSync = localStorage.getItem('autoSync') !== 'false';
        
        // Get or generate client ID
        let clientId = await idb.getMeta('clientId');
        if (!clientId) {
            clientId = this.generateClientId();
            await idb.setMeta('clientId', clientId);
        }
        this.clientId = clientId;

        this.notifyListeners('init');
    }

    async seedInitialTables() {
        const seedTables = [];
        
        // Create 11 pre-seeded tables
        for (let i = 1; i <= 11; i++) {
            const table = {
                id: this.generateTableId(),
                name: `Table ${i}`,
                headers: ['Column 1', 'Column 2', 'Column 3'],
                rows: [
                    { rowId: this.generateRowId(), cells: ['', '', ''], cellMeta: [] },
                    { rowId: this.generateRowId(), cells: ['', '', ''], cellMeta: [] },
                    { rowId: this.generateRowId(), cells: ['', '', ''], cellMeta: [] }
                ],
                updatedAt: new Date().toISOString(),
                version: 1
            };
            seedTables.push(table);
        }

        await idb.importTables(seedTables);
        this.tables = seedTables;
    }

    generateTableId() {
        return 't' + Math.random().toString(36).substr(2, 9);
    }

    generateRowId() {
        return 'r' + Math.random().toString(36).substr(2, 9);
    }

    generateClientId() {
        return 'client_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    async createTable(name = 'New Table') {
        const table = {
            id: this.generateTableId(),
            name,
            headers: ['Column 1', 'Column 2', 'Column 3'],
            rows: [
                { rowId: this.generateRowId(), cells: ['', '', ''], cellMeta: [] },
                { rowId: this.generateRowId(), cells: ['', '', ''], cellMeta: [] }
            ],
            updatedAt: new Date().toISOString(),
            version: 1
        };

        await idb.saveTable(table);
        this.tables.push(table);
        this.notifyListeners('tableCreated', table);
        
        return table;
    }

    async updateTable(tableId, updates) {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        Object.assign(table, updates);
        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('tableUpdated', table);
        
        return table;
    }

    async deleteTable(tableId) {
        const index = this.tables.findIndex(t => t.id === tableId);
        if (index === -1) return;

        await idb.deleteTable(tableId);
        this.tables.splice(index, 1);
        this.notifyListeners('tableDeleted', tableId);
    }

    async updateCell(tableId, rowId, colIndex, value) {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        const row = table.rows.find(r => r.rowId === rowId);
        if (!row) return;

        row.cells[colIndex] = value;
        
        // Update metadata
        if (!row.cellMeta) row.cellMeta = [];
        row.cellMeta[colIndex] = {
            value,
            ts: Date.now(),
            by: this.clientId
        };

        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('cellUpdated', { tableId, rowId, colIndex, value });
        
        return table;
    }

    async addRow(tableId, afterRowId = null) {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        const newRow = {
            rowId: this.generateRowId(),
            cells: new Array(table.headers.length).fill(''),
            cellMeta: []
        };

        if (afterRowId) {
            const index = table.rows.findIndex(r => r.rowId === afterRowId);
            if (index >= 0) {
                table.rows.splice(index + 1, 0, newRow);
            } else {
                table.rows.push(newRow);
            }
        } else {
            table.rows.push(newRow);
        }

        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('rowAdded', { tableId, row: newRow });
        
        return newRow;
    }

    async deleteRow(tableId, rowId) {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        const index = table.rows.findIndex(r => r.rowId === rowId);
        if (index === -1) return;

        table.rows.splice(index, 1);
        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('rowDeleted', { tableId, rowId });
    }

    async addColumn(tableId, header = '') {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        const colIndex = table.headers.length;
        table.headers.push(header || `Column ${colIndex + 1}`);
        
        table.rows.forEach(row => {
            row.cells.push('');
        });

        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('columnAdded', { tableId, colIndex, header });
        
        return colIndex;
    }

    async deleteColumn(tableId, colIndex) {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        if (colIndex < 0 || colIndex >= table.headers.length) return;

        table.headers.splice(colIndex, 1);
        
        table.rows.forEach(row => {
            row.cells.splice(colIndex, 1);
            if (row.cellMeta) {
                row.cellMeta.splice(colIndex, 1);
            }
        });

        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('columnDeleted', { tableId, colIndex });
    }

    async updateHeader(tableId, colIndex, header) {
        const table = this.tables.find(t => t.id === tableId);
        if (!table) return;

        if (colIndex < 0 || colIndex >= table.headers.length) return;

        table.headers[colIndex] = header;
        table.updatedAt = new Date().toISOString();
        table.version = (table.version || 0) + 1;

        await idb.saveTable(table);
        this.notifyListeners('headerUpdated', { tableId, colIndex, header });
    }

    setSyncStatus(status) {
        this.syncStatus = status;
        this.notifyListeners('syncStatusChanged', status);
    }

    async updateSettings(settings) {
        Object.assign(this.settings, settings);
        
        if (settings.serverUrl !== undefined) {
            await idb.setMeta('serverUrl', settings.serverUrl);
        }
        
        if (settings.autoSync !== undefined) {
            localStorage.setItem('autoSync', settings.autoSync ? 'true' : 'false');
        }

        this.notifyListeners('settingsUpdated', this.settings);
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notifyListeners(event, data) {
        this.listeners.forEach(listener => {
            listener(event, data);
        });
    }

    async exportData() {
        const tables = await idb.getAllTables();
        const meta = {
            exportedAt: new Date().toISOString(),
            clientId: this.clientId,
            tableCount: tables.length
        };
        
        return {
            meta,
            tables
        };
    }

    async importData(data) {
        if (!data.tables || !Array.isArray(data.tables)) {
            throw new Error('Invalid import data format');
        }

        await idb.importTables(data.tables);
        this.tables = await idb.getAllTables();
        this.notifyListeners('dataImported', data);
    }

    async clearAllData() {
        await idb.clearAll();
        this.tables = [];
        await this.seedInitialTables();
        this.notifyListeners('dataCleared');
    }
}

export const state = new AppState();