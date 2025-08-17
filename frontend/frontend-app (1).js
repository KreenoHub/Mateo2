// app.js - Main application entry point

import { state } from './core/state.js';
import { idb } from './data/idb.js';
import { syncQueue } from './sync/queue.js';
import { reconcile } from './sync/reconcile.js';
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
        // Initialize IndexedDB
        await idb.init();
        
        // Initialize state
        await state.init();
        
        // Initialize UI components
        this.tableManager = new TableManager();
        this.syncStatus = new SyncStatus();
        
        // Make tableManager globally available for reconciler
        window.tableManager = this.tableManager;
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Setup state listeners
        this.setupStateListeners();
        
        // Setup online/offline listeners
        this.setupNetworkListeners();
        
        // Register service worker
        this.registerServiceWorker();
        
        // Initial render
        this.render();
        
        // Load pending sync queue
        await syncQueue.loadPending();
        
        // Attempt initial sync if online
        if (navigator.onLine && state.settings.serverUrl) {
            this.performSync();
        }
    }

    setupEventListeners() {
        // Settings
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.openSettings();
        });
        
        document.getElementById('close-settings').addEventListener('click', () => {
            this.closeSettings();
        });
        
        // Toolbar actions
        document.getElementById('add-table-btn').addEventListener('click', async () => {
            const table = await state.createTable();
            this.openTableEditor(table.id);
        });
        
        document.getElementById('import-btn').addEventListener('click', () => {
            this.openImportModal();
        });
        
        document.getElementById('export-btn').addEventListener('click', () => {
            this.showExportOptions();
        });
        
        document.getElementById('sync-now-btn').addEventListener('click', () => {
            this.performSync();
        });
        
        // Settings inputs
        document.getElementById('server-url').addEventListener('change', (e) => {
            state.updateSettings({ serverUrl: e.target.value });
        });
        
        document.getElementById('auto-sync').addEventListener('change', (e) => {
            state.updateSettings({ autoSync: e.target.checked });
        });
        
        document.getElementById('clear-local').addEventListener('click', async () => {
            if (confirm('This will clear all local data. Are you sure?')) {
                await state.clearAllData();
                this.render();
            }
        });
        
        // Table modal
        document.getElementById('close-modal').addEventListener('click', () => {
            this.closeTableEditor();
        });
        
        document.getElementById('table-name').addEventListener('change', async (e) => {
            if (this.currentEditingTable) {
                await state.updateTable(this.currentEditingTable, { name: e.target.value });
                await syncQueue.enqueueTableRename(this.currentEditingTable, e.target.value);
            }
        });
        
        document.getElementById('add-row').addEventListener('click', async () => {
            if (this.currentEditingTable) {
                const table = state.tables.find(t => t.id === this.currentEditingTable);
                const lastRowId = table.rows[table.rows.length - 1]?.rowId;
                const newRow = await state.addRow(this.currentEditingTable, lastRowId);
                await syncQueue.enqueueRowAdd(this.currentEditingTable, newRow.rowId, lastRowId);
                this.renderTableEditor();
            }
        });
        
        document.getElementById('add-col').addEventListener('click', async () => {
            if (this.currentEditingTable) {
                const colIndex = await state.addColumn(this.currentEditingTable);
                await syncQueue.enqueueColumnAdd(this.currentEditingTable, colIndex);
                this.renderTableEditor();
            }
        });
        
        document.getElementById('delete-table').addEventListener('click', async () => {
            if (this.currentEditingTable && confirm('Delete this table?')) {
                await state.deleteTable(this.currentEditingTable);
                await syncQueue.enqueueTableDelete(this.currentEditingTable);
                this.closeTableEditor();
                this.render();
            }
        });
        
        // Import modal
        document.getElementById('close-import').addEventListener('click', () => {
            this.closeImportModal();
        });
        
        document.getElementById('confirm-import').addEventListener('click', async () => {
            const fileInput = document.getElementById('import-file');
            const file = fileInput.files[0];
            
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
            } catch (error) {
                console.error('Import failed:', error);
                alert('Import failed: ' + error.message);
            }
        });
        
        // Click outside modal to close
        document.getElementById('table-modal').addEventListener('click', (e) => {
            if (e.target.id === 'table-modal') {
                this.closeTableEditor();
            }
        });
        
        document.getElementById('import-modal').addEventListener('click', (e) => {
            if (e.target.id === 'import-modal') {
                this.closeImportModal();
            }
        });
    }

    setupStateListeners() {
        state.subscribe((event, data) => {
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
                    if (this.currentEditingTable === data.tableId || data.id === this.currentEditingTable) {
                        this.renderTableEditor();
                    }
                    this.tableManager.updateTableCard(data.tableId || data.id);
                    break;
                case 'syncStatusChanged':
                    this.syncStatus.update(data);
                    break;
                case 'settingsUpdated':
                    this.updateSettingsUI(data);
                    break;
            }
        });
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => {
            state.setSyncStatus('online');
            if (state.settings.autoSync && state.settings.serverUrl) {
                this.performSync();
            }
        });

        window.addEventListener('offline', () => {
            state.setSyncStatus('offline');
        });
    }

    async registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js');
                console.log('Service Worker registered:', registration);
            } catch (error) {
                console.error('Service Worker registration failed:', error);
            }
        }
    }

    render() {
        // Display client ID
        document.getElementById('client-id-display').textContent = state.clientId;
        
        // Render tables
        this.tableManager.render(state.tables);
        
        // Update settings UI
        this.updateSettingsUI(state.settings);
    }

    updateSettingsUI(settings) {
        document.getElementById('server-url').value = settings.serverUrl || '';
        document.getElementById('auto-sync').checked = settings.autoSync;
    }

    openSettings() {
        document.getElementById('settings-drawer').classList.add('open');
    }

    closeSettings() {
        document.getElementById('settings-drawer').classList.remove('open');
    }

    openTableEditor(tableId) {
        this.currentEditingTable = tableId;
        const modal = document.getElementById('table-modal');
        modal.classList.add('open');
        this.renderTableEditor();
    }

    closeTableEditor() {
        this.currentEditingTable = null;
        document.getElementById('table-modal').classList.remove('open');
    }

    renderTableEditor() {
        if (!this.currentEditingTable) return;
        
        const table = state.tables.find(t => t.id === this.currentEditingTable);
        if (!table) return;
        
        // Set table name
        document.getElementById('table-name').value = table.name;
        
        // Render headers
        const headersEl = document.getElementById('table-headers');
        headersEl.innerHTML = '';
        
        const headerRow = document.createElement('tr');
        table.headers.forEach((header, index) => {
            const th = document.createElement('th');
            const input = document.createElement('input');
            input.type = 'text';
            input.value = header;
            input.addEventListener('change', async (e) => {
                await state.updateHeader(this.currentEditingTable, index, e.target.value);
                await syncQueue.enqueueHeaderChange(this.currentEditingTable, index, e.target.value);
            });
            th.appendChild(input);
            
            // Delete column button
            if (table.headers.length > 1) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.textContent = '×';
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm('Delete this column?')) {
                        await state.deleteColumn(this.currentEditingTable, index);
                        await syncQueue.enqueueColumnDelete(this.currentEditingTable, index);
                        this.renderTableEditor();
                    }
                });
                th.appendChild(deleteBtn);
            }
            
            headerRow.appendChild(th);
        });
        headersEl.appendChild(headerRow);
        
        // Render body
        const bodyEl = document.getElementById('table-body');
        bodyEl.innerHTML = '';
        
        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            
            row.cells.forEach((cell, colIndex) => {
                const td = document.createElement('td');
                const input = document.createElement('input');
                input.type = 'text';
                input.value = cell;
                
                // Check for conflicts
                const conflict = reconcile.getConflict(table.id, row.rowId, colIndex);
                if (conflict) {
                    td.classList.add('cell-conflict');
                    td.title = `Conflict: Local="${conflict.local}" vs Remote="${conflict.remote}"`;
                }
                
                input.addEventListener('change', async (e) => {
                    await state.updateCell(this.currentEditingTable, row.rowId, colIndex, e.target.value);
                    await syncQueue.enqueueCellChange(this.currentEditingTable, row.rowId, colIndex, e.target.value);
                });
                
                td.appendChild(input);
                tr.appendChild(td);
            });
            
            // Add delete row button
            const td = document.createElement('td');
            td.style.border = 'none';
            td.style.padding = '0.25rem';
            
            if (table.rows.length > 1) {
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-btn';
                deleteBtn.style.position = 'static';
                deleteBtn.style.opacity = '1';
                deleteBtn.textContent = '×';
                deleteBtn.addEventListener('click', async () => {
                    if (confirm('Delete this row?')) {
                        await state.deleteRow(this.currentEditingTable, row.rowId);
                        await syncQueue.enqueueRowDelete(this.currentEditingTable, row.rowId);
                        this.renderTableEditor();
                    }
                });
                td.appendChild(deleteBtn);
            }
            
            tr.appendChild(td);
            bodyEl.appendChild(tr);
        });
    }

    openImportModal() {
        document.getElementById('import-modal').classList.add('open');
        document.getElementById('import-file').value = '';
    }

    closeImportModal() {
        document.getElementById('import-modal').classList.remove('open');
    }

    showExportOptions() {
        const menu = document.createElement('div');
        menu.className = 'export-menu';
        menu.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: 0.5rem;
            padding: 1rem;
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            z-index: 1000;
        `;
        
        menu.innerHTML = `
            <h3 style="margin-bottom: 1rem;">Export Format</h3>
            <button id="export-json" class="btn" style="display: block; width: 100%; margin-bottom: 0.5rem;">Export as JSON</button>
            <button id="export-csv" class="btn" style="display: block; width: 100%; margin-bottom: 0.5rem;">Export as CSV</button>
            <button id="close-export" class="btn" style="display: block; width: 100%;">Cancel</button>
        `;
        
        document.body.appendChild(menu);
        
        document.getElementById('export-json').addEventListener('click', async () => {
            const data = await state.exportData();
            const json = JSON.stringify(data, null, 2);
            this.downloadFile(json, 'tablehub-export.json', 'application/json');
            document.body.removeChild(menu);
        });
        
        document.getElementById('export-csv').addEventListener('click', async () => {
            const csv = await exportToCSV();
            this.downloadFile(csv, 'tablehub-export.csv', 'text/csv');
            document.body.removeChild(menu);
        });
        
        document.getElementById('close-export').addEventListener('click', () => {
            document.body.removeChild(menu);
        });
    }

    downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async performSync() {
        if (!state.settings.serverUrl) {
            alert('Please configure server URL in settings');
            return;
        }

        if (!navigator.onLine) {
            alert('No internet connection');
            return;
        }

        state.setSyncStatus('syncing');
        
        try {
            // Push local changes
            await syncQueue.drain();
            
            // Pull server changes
            await this.pullServerChanges();
            
            state.setSyncStatus('synced');
            
            // Clear synced changes from IndexedDB
            await idb.clearSyncedChanges();
            
            // Refresh UI
            this.render();
            
            if (reconcile.hasConflicts()) {
                alert('Sync completed with conflicts. Conflicted cells are highlighted.');
            }
        } catch (error) {
            console.error('Sync failed:', error);
            state.setSyncStatus('error');
            alert('Sync failed: ' + error.message);
        }
    }

    async pullServerChanges() {
        const cursor = await idb.getMeta('syncCursor') || '0';
        const serverUrl = state.settings.serverUrl;
        
        const response = await fetch(`${serverUrl}/api/sync?since=${cursor}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Pull failed: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.deltas && data.deltas.length > 0) {
            await reconcile.applyDeltas(data.deltas);
        }
        
        if (data.cursor) {
            await idb.setMeta('syncCursor', data.cursor);
        }
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new App();
        app.init();
    });
} else {
    const app = new App();
    app.init();
}