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
                                this.renderTableEditor();
                                break;
                        }
                    });
                }