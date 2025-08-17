// ui/tables.js - Table cards UI management

export class TableManager {
    constructor() {
        this.container = document.getElementById('tables-container');
    }

    render(tables) {
        this.container.innerHTML = '';
        
        tables.forEach(table => {
            this.container.appendChild(this.createTableCard(table));
        });
    }

    createTableCard(table) {
        const card = document.createElement('div');
        card.className = 'table-card';
        card.dataset.tableId = table.id;
        
        // Header
        const header = document.createElement('div');
        header.className = 'table-card-header';
        header.textContent = table.name;
        card.appendChild(header);
        
        // Preview table
        const preview = document.createElement('div');
        preview.className = 'table-preview';
        
        const previewTable = document.createElement('table');
        
        // Preview headers (max 3 columns)
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const maxCols = Math.min(3, table.headers.length);
        
        for (let i = 0; i < maxCols; i++) {
            const th = document.createElement('th');
            th.textContent = table.headers[i] || '';
            headerRow.appendChild(th);
        }
        
        if (table.headers.length > 3) {
            const th = document.createElement('th');
            th.textContent = '...';
            headerRow.appendChild(th);
        }
        
        thead.appendChild(headerRow);
        previewTable.appendChild(thead);
        
        // Preview rows (max 3 rows)
        const tbody = document.createElement('tbody');
        const maxRows = Math.min(3, table.rows.length);
        
        for (let i = 0; i < maxRows; i++) {
            const tr = document.createElement('tr');
            const row = table.rows[i];
            
            for (let j = 0; j < maxCols; j++) {
                const td = document.createElement('td');
                td.textContent = row.cells[j] || '';
                tr.appendChild(td);
            }
            
            if (table.headers.length > 3) {
                const td = document.createElement('td');
                td.textContent = '...';
                tr.appendChild(td);
            }
            
            tbody.appendChild(tr);
        }
        
        if (table.rows.length > 3) {
            const tr = document.createElement('tr');
            for (let j = 0; j <= Math.min(maxCols, table.headers.length); j++) {
                const td = document.createElement('td');
                td.textContent = '...';
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        
        previewTable.appendChild(tbody);
        preview.appendChild(previewTable);
        card.appendChild(preview);
        
        // Footer
        const footer = document.createElement('div');
        footer.className = 'table-card-footer';
        footer.textContent = `${table.rows.length} rows × ${table.headers.length} columns`;
        card.appendChild(footer);
        
        // Click handler
        card.addEventListener('click', () => {
            const event = new CustomEvent('tableOpen', { detail: { tableId: table.id } });
            document.dispatchEvent(event);
        });
        
        return card;
    }

    updateTableCard(tableId) {
        const card = this.container.querySelector(`[data-table-id="${tableId}"]`);
        if (card) {
            const table = window.state.tables.find(t => t.id === tableId);
            if (table) {
                const newCard = this.createTableCard(table);
                card.replaceWith(newCard);
            }
        }
    }

    refresh() {
        if (window.state) {
            this.render(window.state.tables);
        }
    }
}

// Listen for table open events
document.addEventListener('tableOpen', (e) => {
    if (window.app) {
        window.app.openTableEditor(e.detail.tableId);
    }
});