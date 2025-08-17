# backend/sync_engine.py - Sync engine for conflict resolution

import json
import hashlib
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

from database import Database
from models import OperationType, Delta

logger = logging.getLogger(__name__)

class SyncEngine:
    def __init__(self, db: Database):
        self.db = db
    
    async def process_sync(self, client_id: str, base_cursor: str, operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Process sync operations from client"""
        try:
            conflicts = []
            applied_ops = []
            
            for op in operations:
                # Apply operation to database
                success = await self._apply_operation(op, client_id)
                
                if success:
                    applied_ops.append(op)
                    
                    # Generate cursor for this operation
                    cursor = self._generate_cursor(client_id, op)
                    
                    # Store in sync events
                    await self.db.add_sync_event(cursor, client_id, op)
                else:
                    # Track conflict
                    conflicts.append({
                        "operation": op,
                        "reason": "Failed to apply"
                    })
            
            # Get latest cursor
            latest_cursor = await self.db.get_latest_cursor()
            
            # Get any changes from other clients since base_cursor
            other_changes = await self._get_other_client_changes(base_cursor, client_id)
            
            return {
                "cursor": latest_cursor,
                "deltas": other_changes,
                "conflicts": conflicts
            }
        
        except Exception as e:
            logger.error(f"Sync processing failed: {e}")
            raise
    
    async def get_changes_since(self, cursor: str) -> Dict[str, Any]:
        """Get all changes since a cursor"""
        try:
            # Get events since cursor
            events = await self.db.get_events_since(cursor)
            
            # Convert to deltas
            deltas = []
            for event in events:
                delta = self._event_to_delta(event)
                if delta:
                    deltas.append(delta)
            
            # Get latest cursor
            latest_cursor = await self.db.get_latest_cursor()
            
            # If requesting from beginning, also send current table state
            tables = []
            if cursor == "0":
                tables = await self.db.get_all_tables()
            
            return {
                "cursor": latest_cursor,
                "deltas": deltas,
                "tables": tables
            }
        
        except Exception as e:
            logger.error(f"Get changes failed: {e}")
            raise
    
    async def _apply_operation(self, op: Dict[str, Any], client_id: str) -> bool:
        """Apply a single operation to the database"""
        try:
            op_type = op.get("op")
            table_id = op.get("tableId")
            
            if not op_type or not table_id:
                return False
            
            # Get current table
            table = await self.db.get_table(table_id)
            
            if op_type == OperationType.SET_CELL:
                return await self._apply_set_cell(table, op, client_id)
            elif op_type == OperationType.ADD_ROW:
                return await self._apply_add_row(table, op, client_id)
            elif op_type == OperationType.DELETE_ROW:
                return await self._apply_delete_row(table, op, client_id)
            elif op_type == OperationType.ADD_COLUMN:
                return await self._apply_add_column(table, op, client_id)
            elif op_type == OperationType.DELETE_COLUMN:
                return await self._apply_delete_column(table, op, client_id)
            elif op_type == OperationType.SET_HEADER:
                return await self._apply_set_header(table, op, client_id)
            elif op_type == OperationType.RENAME_TABLE:
                return await self._apply_rename_table(table, op, client_id)
            elif op_type == OperationType.DELETE_TABLE:
                return await self._apply_delete_table(table_id)
            else:
                logger.warning(f"Unknown operation type: {op_type}")
                return False
        
        except Exception as e:
            logger.error(f"Failed to apply operation: {e}")
            return False
    
    async def _apply_set_cell(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply set cell operation"""
        if not table:
            return False
        
        row_id = op.get("rowId")
        col = op.get("col")
        value = op.get("value", "")
        ts = op.get("ts")
        
        if row_id is None or col is None:
            return False
        
        # Find the row
        for row in table.get("rows", []):
            if row.get("rowId") == row_id:
                # Ensure cells array is long enough
                cells = row.get("cells", [])
                while len(cells) <= col:
                    cells.append("")
                
                # Apply LWW conflict resolution
                cell_meta = row.get("cellMeta", [])
                while len(cell_meta) <= col:
                    cell_meta.append(None)
                
                current_meta = cell_meta[col]
                
                # Check if we should apply this change (Last Writer Wins)
                if self._should_apply_change(current_meta, ts, client_id):
                    cells[col] = value
                    cell_meta[col] = {
                        "value": value,
                        "ts": ts,
                        "by": client_id
                    }
                    
                    row["cells"] = cells
                    row["cellMeta"] = cell_meta
                    
                    # Update table
                    return await self.db.update_table(table["id"], table)
        
        return False
    
    async def _apply_add_row(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply add row operation"""
        if not table:
            return False
        
        row_id = op.get("rowId")
        after_row_id = op.get("afterRowId")
        
        if not row_id:
            return False
        
        # Check if row already exists
        rows = table.get("rows", [])
        if any(r.get("rowId") == row_id for r in rows):
            return True  # Already exists, consider it successful
        
        # Create new row
        new_row = {
            "rowId": row_id,
            "cells": [""] * len(table.get("headers", [])),
            "cellMeta": []
        }
        
        # Insert row at appropriate position
        if after_row_id:
            for i, row in enumerate(rows):
                if row.get("rowId") == after_row_id:
                    rows.insert(i + 1, new_row)
                    break
            else:
                rows.append(new_row)
        else:
            rows.append(new_row)
        
        table["rows"] = rows
        return await self.db.update_table(table["id"], table)
    
    async def _apply_delete_row(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply delete row operation"""
        if not table:
            return False
        
        row_id = op.get("rowId")
        if not row_id:
            return False
        
        rows = table.get("rows", [])
        table["rows"] = [r for r in rows if r.get("rowId") != row_id]
        
        return await self.db.update_table(table["id"], table)
    
    async def _apply_add_column(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply add column operation"""
        if not table:
            return False
        
        col_index = op.get("colIndex", len(table.get("headers", [])))
        header = op.get("header", f"Column {col_index + 1}")
        
        # Add header
        headers = table.get("headers", [])
        if col_index >= 0 and col_index <= len(headers):
            headers.insert(col_index, header)
        else:
            headers.append(header)
        
        table["headers"] = headers
        
        # Add empty cell to each row
        for row in table.get("rows", []):
            cells = row.get("cells", [])
            if col_index >= 0 and col_index <= len(cells):
                cells.insert(col_index, "")
            else:
                cells.append("")
            row["cells"] = cells
            
            # Update cell metadata
            cell_meta = row.get("cellMeta", [])
            if col_index >= 0 and col_index <= len(cell_meta):
                cell_meta.insert(col_index, None)
            else:
                cell_meta.append(None)
            row["cellMeta"] = cell_meta
        
        return await self.db.update_table(table["id"], table)
    
    async def _apply_delete_column(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply delete column operation"""
        if not table:
            return False
        
        col_index = op.get("colIndex")
        if col_index is None:
            return False
        
        headers = table.get("headers", [])
        if col_index < 0 or col_index >= len(headers):
            return False
        
        # Remove header
        headers.pop(col_index)
        table["headers"] = headers
        
        # Remove cell from each row
        for row in table.get("rows", []):
            cells = row.get("cells", [])
            if col_index < len(cells):
                cells.pop(col_index)
            row["cells"] = cells
            
            # Update cell metadata
            cell_meta = row.get("cellMeta", [])
            if col_index < len(cell_meta):
                cell_meta.pop(col_index)
            row["cellMeta"] = cell_meta
        
        return await self.db.update_table(table["id"], table)
    
    async def _apply_set_header(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply set header operation"""
        if not table:
            return False
        
        col_index = op.get("colIndex")
        header = op.get("header", "")
        
        if col_index is None:
            return False
        
        headers = table.get("headers", [])
        if col_index >= 0 and col_index < len(headers):
            headers[col_index] = header
            table["headers"] = headers
            return await self.db.update_table(table["id"], table)
        
        return False
    
    async def _apply_rename_table(self, table: Dict[str, Any], op: Dict[str, Any], client_id: str) -> bool:
        """Apply rename table operation"""
        if not table:
            return False
        
        name = op.get("name")
        if not name:
            return False
        
        table["name"] = name
        return await self.db.update_table(table["id"], table)
    
    async def _apply_delete_table(self, table_id: str) -> bool:
        """Apply delete table operation"""
        return await self.db.delete_table(table_id)
    
    def _should_apply_change(self, current_meta: Optional[Dict], remote_ts: int, remote_client_id: str) -> bool:
        """Determine if a change should be applied using LWW"""
        if not current_meta or not current_meta.get("ts"):
            return True  # No existing data, apply the change
        
        current_ts = current_meta.get("ts", 0)
        current_client_id = current_meta.get("by", "")
        
        # Last Writer Wins with client ID as tiebreaker
        if remote_ts > current_ts:
            return True
        elif remote_ts == current_ts:
            # Use client ID as tiebreaker (lexicographic comparison)
            return remote_client_id > current_client_id
        
        return False
    
    async def _get_other_client_changes(self, base_cursor: str, client_id: str) -> List[Dict[str, Any]]:
        """Get changes from other clients since base cursor"""
        events = await self.db.get_events_since(base_cursor)
        
        deltas = []
        for event in events:
            # Skip changes from the same client
            if event.get("clientId") == client_id:
                continue
            
            delta = self._event_to_delta(event)
            if delta:
                deltas.append(delta)
        
        return deltas
    
    def _event_to_delta(self, event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Convert a sync event to a delta"""
        operation = event.get("operation", {})
        
        if not operation:
            return None
        
        return {
            "op": operation.get("op"),
            "tableId": operation.get("tableId"),
            "rowId": operation.get("rowId"),
            "col": operation.get("col"),
            "value": operation.get("value"),
            "afterRowId": operation.get("afterRowId"),
            "colIndex": operation.get("colIndex"),
            "header": operation.get("header"),
            "name": operation.get("name"),
            "serverTs": event.get("serverTs"),
            "by": event.get("clientId")
        }
    
    def _generate_cursor(self, client_id: str, operation: Dict[str, Any]) -> str:
        """Generate a unique cursor for an operation"""
        # Create a unique cursor based on timestamp, client ID, and operation
        timestamp = datetime.utcnow().isoformat()
        op_str = json.dumps(operation, sort_keys=True)
        cursor_data = f"{timestamp}:{client_id}:{op_str}"
        
        # Create a hash for a shorter cursor
        cursor_hash = hashlib.sha256(cursor_data.encode()).hexdigest()[:16]
        return f"{int(datetime.utcnow().timestamp() * 1000)}_{cursor_hash}"