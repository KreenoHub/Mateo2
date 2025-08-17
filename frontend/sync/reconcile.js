// sync/reconcile.js - Conflict resolution and delta application

import { idb } from '../data/idb.js';
import { state } from '../core/state.js';

class Reconciler {
    constructor() {
        this.conflicts = new Map();
    }

    async applyDeltas(deltas) {
        for (const delta of deltas) {
            await this.applyDelta(delta);
        }
        
        // Refresh UI after applying all deltas
        if (window.tableManager) {
            window.tableManager.refresh();
        }
    }

    async applyDelta(delta) {
        const table = await idb.getTable(delta.tableId);
        if (!table) {
            console.warn(`Table ${delta.tableId} not found for delta`, delta);
            return;
        }

        switch (delta.op) {
            case 'setCell':
                await this.applyCellDelta(table, delta);
                break;
            case 'addRow':
                await this.applyAddRowDelta(table, delta);
                break;
            case 'deleteRow':
                await this.applyDeleteRowDelta(table, delta);
                break;
            case 'addColumn':
                await this.applyAddColumnDelta(table, delta);
                break;
            case 'deleteColumn':
                await this.applyDeleteColumnDelta(table, delta);
                break;
            case 'setHeader':
                await this.applyHeaderDelta(table, delta);
                break;
            case 'renameTable':
                await this.applyRenameDelta(table, delta);
                break;
            case 'deleteTable':
                await this.applyDeleteTableDelta(delta);
                break;
            default:
                console.warn('Unknown delta operation:', delta.op);
        }
    }

    async applyCellDelta(table, delta) {
        const row = table.rows.find(r => r.rowId === delta.rowId);
        if (!row) {
            // Row doesn't exist, might have been deleted
            return;
        }

        const currentCell = row.cells[delta.col];
        const currentMeta = row.cellMeta?.[delta.col];

        // Last-Writer-Wins conflict resolution
        const shouldApply = this.shouldApplyChange(
            currentMeta,
            delta.serverTs || delta.ts,
            delta.by || delta.clientId
        );

        if (shouldApply) {
            // Ensure cells array is long enough
            while (row.cells.length <= delta.col) {
                row.cells.push('');
            }
            
            row.cells[delta.col] = delta.value;
            
            // Store metadata for conflict detection
            if (!row.cellMeta) {
                row.cellMeta = [];
            }
            row.cellMeta[delta.col] = {
                value: delta.value,
                ts: delta.serverTs || delta.ts,
                by: delta.by || delta.clientId
            };

            table.updatedAt = new Date().toISOString();
            await idb.saveTable(table);
        } else {
            // Track conflict for UI indication
            this.trackConflict(table.id, delta.rowId, delta.col, {
                local: currentCell,
                remote: delta.value,
                winner: 'local'
            });
        }
    }

    async applyAddRowDelta(table, delta) {
        // Check if row already exists
        if (table.rows.find(r => r.rowId === delta.rowId)) {
            return;
        }

        const newRow = {
            rowId: delta.rowId,
            cells: new Array(table.headers.length).fill(''),
            cellMeta: []
        };

        if (delta.afterRowId) {
            const index = table.rows.findIndex(r => r.rowId === delta.afterRowId);
            if (index >= 0) {
                table.rows.splice(index + 1, 0, newRow);
            } else {
                table.rows.push(newRow);
            }
        } else {
            table.rows.push(newRow);
        }

        table.updatedAt = new Date().toISOString();
        await idb.saveTable(table);
    }

    async applyDeleteRowDelta(table, delta) {
        const index = table.rows.findIndex(r => r.rowId === delta.rowId);
        if (index >= 0) {
            table.rows.splice(index, 1);
            table.updatedAt = new Date().toISOString();
            await idb.saveTable(table);
        }
    }

    async applyAddColumnDelta(table, delta) {
        // Add header
        if (delta.colIndex >= 0 && delta.colIndex <= table.headers.length) {
            table.headers.splice(delta.colIndex, 0, delta.header || `Col ${delta.colIndex + 1}`);
        } else {
            table.headers.push(delta.header || `Col ${table.headers.length + 1}`);
        }

        // Add empty cell to each row
        table.rows.forEach(row => {
            if (delta.colIndex >= 0 && delta.colIndex <= row.cells.length) {
                row.cells.splice(delta.colIndex, 0, '');
                if (row.cellMeta) {
                    row.cellMeta.splice(delta.colIndex, 0, null);
                }
            } else {
                row.cells.push('');
            }
        });

        table.updatedAt = new Date().toISOString();
        await idb.saveTable(table);
    }

    async applyDeleteColumnDelta(table, delta) {
        if (delta.colIndex >= 0 && delta.colIndex < table.headers.length) {
            table.headers.splice(delta.colIndex, 1);
            
            table.rows.forEach(row => {
                row.cells.splice(delta.colIndex, 1);
                if (row.cellMeta) {
                    row.cellMeta.splice(delta.colIndex, 1);
                }
            });

            table.updatedAt = new Date().toISOString();
            await idb.saveTable(table);
        }
    }

    async applyHeaderDelta(table, delta) {
        if (delta.colIndex >= 0 && delta.colIndex < table.headers.length) {
            table.headers[delta.colIndex] = delta.header;
            table.updatedAt = new Date().toISOString();
            await idb.saveTable(table);
        }
    }

    async applyRenameDelta(table, delta) {
        table.name = delta.name;
        table.updatedAt = new Date().toISOString();
        await idb.saveTable(table);
    }

    async applyDeleteTableDelta(delta) {
        await idb.deleteTable(delta.tableId);
    }

    shouldApplyChange(currentMeta, remoteTs, remoteClientId) {
        if (!currentMeta || !currentMeta.ts) {
            // No local metadata, apply remote
            return true;
        }

        const currentTs = currentMeta.ts;
        const currentClientId = currentMeta.by;

        // Last-Writer-Wins with client ID as tiebreaker
        if (remoteTs > currentTs) {
            return true;
        } else if (remoteTs === currentTs) {
            // Use client ID as tiebreaker (lexicographic comparison)
            return remoteClientId > currentClientId;
        }

        return false;
    }

    trackConflict(tableId, rowId, col, conflict) {
        const key = `${tableId}-${rowId}-${col}`;
        this.conflicts.set(key, {
            ...conflict,
            timestamp: Date.now()
        });

        // Clear old conflicts after 30 seconds
        setTimeout(() => {
            this.conflicts.delete(key);
        }, 30000);
    }

    getConflict(tableId, rowId, col) {
        const key = `${tableId}-${rowId}-${col}`;
        return this.conflicts.get(key);
    }

    hasConflicts() {
        return this.conflicts.size > 0;
    }

    clearConflicts() {
        this.conflicts.clear();
    }
}

export const reconcile = new Reconciler();