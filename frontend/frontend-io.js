// core/io.js - Import/Export functionality

import { state } from './state.js';

export async function exportToJSON() {
    const data = await state.exportData();
    return JSON.stringify(data, null, 2);
}

export async function exportToCSV() {
    const tables = state.tables;
    let csv = '';
    
    tables.forEach((table, tableIndex) => {
        // Table name
        csv += `"Table: ${table.name}"\n`;
        
        // Headers
        csv += table.headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\n';
        
        // Rows
        table.rows.forEach(row => {
            csv += row.cells.map(cell => {
                const value = (cell || '').toString();
                return `"${value.replace(/"/g, '""')}"`;
            }).join(',') + '\n';
        });
        
        // Separator between tables
        if (tableIndex < tables.length - 1) {
            csv += '\n';
        }
    });
    
    return csv;
}

export async function importFromJSON(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        
        if (!data.tables || !Array.isArray(data.tables)) {
            throw new Error('Invalid JSON format: missing tables array');
        }
        
        // Validate and sanitize tables
        const validTables = data.tables.map(table => {
            if (!table.id) {
                table.id = state.generateTableId();
            }
            
            if (!table.name) {
                table.name = 'Imported Table';
            }
            
            if (!Array.isArray(table.headers)) {
                table.headers = ['Column 1', 'Column 2', 'Column 3'];
            }
            
            if (!Array.isArray(table.rows)) {
                table.rows = [];
            }
            
            // Ensure each row has rowId and cells
            table.rows = table.rows.map(row => {
                if (!row.rowId) {
                    row.rowId = state.generateRowId();
                }
                
                if (!Array.isArray(row.cells)) {
                    row.cells = new Array(table.headers.length).fill('');
                }
                
                // Ensure cells array matches headers length
                while (row.cells.length < table.headers.length) {
                    row.cells.push('');
                }
                
                if (row.cells.length > table.headers.length) {
                    row.cells = row.cells.slice(0, table.headers.length);
                }
                
                return row;
            });
            
            table.updatedAt = new Date().toISOString();
            table.version = 1;
            
            return table;
        });
        
        await state.importData({ tables: validTables });
        
    } catch (error) {
        throw new Error('Failed to import JSON: ' + error.message);
    }
}

export async function importFromCSV(csvString) {
    try {
        const lines = csvString.split('\n').filter(line => line.trim());
        const tables = [];
        let currentTable = null;
        let isHeader = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Check if this is a table name line
            if (line.startsWith('"Table:') || line.startsWith('Table:')) {
                // Save previous table if exists
                if (currentTable) {
                    tables.push(currentTable);
                }
                
                // Extract table name
                const nameMatch = line.match(/Table:\s*(.+?)["']?$/);
                const tableName = nameMatch ? nameMatch[1].replace(/["']/g, '') : 'Imported Table';
                
                // Create new table
                currentTable = {
                    id: state.generateTableId(),
                    name: tableName,
                    headers: [],
                    rows: [],
                    updatedAt: new Date().toISOString(),
                    version: 1
                };
                
                isHeader = true;
                continue;
            }
            
            // Parse CSV line
            const cells = parseCSVLine(line);
            
            if (!currentTable) {
                // Create default table if none exists
                currentTable = {
                    id: state.generateTableId(),
                    name: 'Imported Table',
                    headers: [],
                    rows: [],
                    updatedAt: new Date().toISOString(),
                    version: 1
                };
                isHeader = true;
            }
            
            if (isHeader) {
                currentTable.headers = cells;
                isHeader = false;
            } else {
                // Add row
                const row = {
                    rowId: state.generateRowId(),
                    cells: cells,
                    cellMeta: []
                };
                
                // Ensure cells match headers length
                while (row.cells.length < currentTable.headers.length) {
                    row.cells.push('');
                }
                
                if (row.cells.length > currentTable.headers.length) {
                    row.cells = row.cells.slice(0, currentTable.headers.length);
                }
                
                currentTable.rows.push(row);
            }
        }
        
        // Add last table
        if (currentTable) {
            tables.push(currentTable);
        }
        
        if (tables.length === 0) {
            throw new Error('No valid data found in CSV');
        }
        
        await state.importData({ tables });
        
    } catch (error) {
        throw new Error('Failed to import CSV: ' + error.message);
    }
}

function parseCSVLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                // Escaped quote
                current += '"';
                i++; // Skip next quote
            } else {
                // Toggle quote mode
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // End of cell
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    // Add last cell
    cells.push(current);
    
    return cells;
}