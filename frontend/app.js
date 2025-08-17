// app.js - Main application entry point

import { state } from './core/state.js';
import { idb } from './data/idb.js';
import { syncQueue } from './sync/queue.js';
import { TableManager } from './ui/tables.js';
import { SyncStatus } from './ui/status.js';
import { exportToJSON, exportToCSV, importFromJSON, importFromCSV } from './core/io.js';

class App {
    constructor() {
        this.tableManager = null;
        this.syncStatus = null;
        this.currentEditingTable = null;
    }

    async init() {
        await idb.init();
        await state.init();

        // Expose for other modules
        window.state = state;

        this.tableManager = new TableManager();
        this.syncStatus = new SyncStatus();
        window.tableManager = this.tableManager;

        this.setupEventListeners();
        this.setupStateListeners();
        this.setupNetworkListeners();
        this.registerServiceWorker();

        this.render();

        await syncQueue.loadPending();
        if (navigator.onLine && state.settings.serverUrl) {
            this.performSync();
        }
    }

    /* ---------- Event wiring ---------- */
    setupEventListeners() {
        // Settings drawer
        document.getElementById('settings-btn').addEventListener('click', () => this.openSettings());
        document.getElementById('close-settings').addEventListener('click', () => this.closeSettings());

        // Toolbar
        document.getElementById('add-table-btn').addEventListener('click', async () => {
            const table = await state.createTable();
            this.openTableEditor(table.id);
        });
        document.getElementById('import-btn').addEventListener('click', () => this.openImportModal());
        document.getElementById('export-btn').addEventListener('click', () => this.showExportOptions());
        document.getElementById('sync-now-btn').addEventListener('click', () => this.performSync());

        // Settings inputs
        document.getElementById('server-url').addEventListener('change', e => {
            state.updateSettings({ serverUrl: e.target.value });
        });
        document.getElementById('auto-sync').addEventListener('change', e => {
            state.updateSettings({ autoSync: e.target.checked });
        });
        document.getElementById('clear-local').addEventListener('click', async () => {
            if (confirm('This will clear all local data. Are you sure?')) {
                await state.clearAllData();
                this.render();
            }
        });

        // Table modal controls
        document.getElementById('close-modal').addEventListener('click', () => this.closeTableEditor());
        document.getElementById('table-name').addEventListener('change', async e => {
            if (this.currentEditingTable) {
                await state.updateTable(this.currentEditingTable, { name: e.target.value });
                await syncQueue.enqueueTableRename(this.currentEditingTable, e.target.value);
                this.tableManager.updateTableCard(this.currentEditingTable);
            }
        });
        document.getElementById('add-row').addEventListener('click', async () => {
            if (!this.currentEditingTable) return;
            const table = state.tables.find(t => t.id === this.currentEditingTable);
            const lastRowId = table.rows[table.rows.length - 1]?.rowId;
            const newRow = await state.addRow(this.currentEditingTable, lastRowId);
            await syncQueue.enqueueRowAdd(this.currentEditingTable, newRow.rowId, lastRowId);
            this.renderTableEditor();
        });
        document.getElementById('add-col').addEventListener('click', async () => {
            if (!this.currentEditingTable) return;
            const colIndex = await state.addColumn(this.currentEditingTable);
            await syncQueue.enqueueColumnAdd(this.currentEditingTable, colIndex);
            this.renderTableEditor();
        });
        document.getElementById('delete-table').addEventListener('click', async () => {
            if (this.currentEditingTable && confirm('Delete this table?')) {
                await state.deleteTable(this.currentEditingTable);
                await syncQueue.enqueueTableDelete(this.currentEditingTable);
                this.closeTableEditor();
                this.render();
            }
        });

        // Import modal controls
        document.getElementById('close-import').addEventListener('click', () => this.closeImportModal());
        document.getElementById('confirm-import').addEventListener('click', async () => {
            const file = document.getElementById('import-file').files[0];
            if (!file) {
                alert('Please select a file');
                return;
            }
            try {
                const text = await file.text();
                if (file.name.endsWith('.json')) {
                    await importFromJSON(text);
                } else if (file.name.endsWith('.csv')) {
                    await importFromCSV(text);
                } else {
                    alert('Unsupported file format');
                    return;
                }
                this.closeImportModal();
                this.render();
                alert('Import successful!');
            } catch (err) {
                console.error('Import failed', err);
                alert('Import failed: ' + err.message);
            }
        });

        // Click outside modals to close
        document.getElementById('table-modal').addEventListener('click', e => {
            if (e.target.id === 'table-modal') this.closeTableEditor();
        });
        document.getElementById('import-modal').addEventListener('click', e => {
            if (e.target.id === 'import-modal') this.closeImportModal();
        });
    }

    setupStateListeners() {
        state.subscribe(event => {
            switch (event) {
                case 'init':
                case 'tableCreated':
                case 'tableDeleted':
                case 'dataImported':
                case 'dataCleared':
                    this.render();
                    break;
                case 'tableUpdated':
                case 'cellUpdated':
                case 'rowAdded':
                case 'rowDeleted':
                case 'columnAdded':
                case 'columnDeleted':
                case 'headerUpdated':
                    this.renderTableEditor();
                    break;
            }
        });
    }

    /* ---------- UI helpers ---------- */
    openSettings() {
        const drawer = document.getElementById('settings-drawer');
        drawer.classList.add('open');
        document.getElementById('server-url').value = state.settings.serverUrl || '';
        document.getElementById('auto-sync').checked = state.settings.autoSync;
        document.getElementById('client-id-display').textContent = state.clientId;
    }

    closeSettings() {
        document.getElementById('settings-drawer').classList.remove('open');
    }

    openTableEditor(tableId) {
        this.currentEditingTable = tableId;
        this.renderTableEditor();
        document.getElementById('table-modal').classList.add('open');
    }

    closeTableEditor() {
        this.currentEditingTable = null;
        document.getElementById('table-modal').classList.remove('open');
    }

    openImportModal() {
        document.getElementById('import-modal').classList.add('open');
    }

    closeImportModal() {
        document.getElementById('import-modal').classList.remove('open');
        document.getElementById('import-file').value = '';
    }

    render() {
        this.tableManager.render(state.tables);
    }

    renderTableEditor() {
        if (!this.currentEditingTable) return;
        const table = state.tables.find(t => t.id === this.currentEditingTable);
        if (!table) return;

        document.getElementById('table-name').value = table.name;

        const headersEl = document.getElementById('table-headers');
        headersEl.innerHTML = '';
        const headerRow = document.createElement('tr');
        table.headers.forEach((header, idx) => {
            const th = document.createElement('th');
            const input = document.createElement('input');
            input.value = header;
            input.addEventListener('change', async e => {
                await state.updateHeader(this.currentEditingTable, idx, e.target.value);
                await syncQueue.enqueueHeaderChange(this.currentEditingTable, idx, e.target.value);
                this.tableManager.updateTableCard(this.currentEditingTable);
            });
            th.appendChild(input);
            headerRow.appendChild(th);
        });
        headersEl.appendChild(headerRow);

        const bodyEl = document.getElementById('table-body');
        bodyEl.innerHTML = '';
        table.rows.forEach(row => {
            const tr = document.createElement('tr');
            row.cells.forEach((cell, colIdx) => {
                const td = document.createElement('td');
                const input = document.createElement('input');
                input.value = cell;
                input.addEventListener('change', async e => {
                    await state.updateCell(this.currentEditingTable, row.rowId, colIdx, e.target.value);
                    await syncQueue.enqueueCellChange(this.currentEditingTable, row.rowId, colIdx, e.target.value);
                    this.tableManager.updateTableCard(this.currentEditingTable);
                });
                td.appendChild(input);
                tr.appendChild(td);
            });
            bodyEl.appendChild(tr);
        });
    }

    async showExportOptions() {
        const choice = prompt('Export format? (json/csv)', 'json');
        if (!choice) return;
        try {
            let data, mime, filename;
            if (choice.toLowerCase() === 'csv') {
                data = await exportToCSV();
                mime = 'text/csv';
                filename = 'tablehub-export.csv';
            } else {
                data = await exportToJSON();
                mime = 'application/json';
                filename = 'tablehub-export.json';
            }
            const blob = new Blob([data], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export failed', err);
            alert('Export failed: ' + err.message);
        }
    }

    async performSync() {
        if (!state.settings.serverUrl) {
            alert('Set server URL in Settings');
            return;
        }
        try {
            this.syncStatus.update('syncing');
            await syncQueue.processPending();
            this.syncStatus.update('synced');
        } catch (err) {
            console.error('Sync failed', err);
            this.syncStatus.update('error');
        }
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.syncStatus.update('online');
            if (state.settings.autoSync) {
                this.performSync();
            }
        });
        window.addEventListener('offline', () => {
            this.syncStatus.update('offline');
        });
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(err => {
                console.warn('SW registration failed', err);
            });
        }
    }
}

const app = new App();
window.app = app;
app.init();

