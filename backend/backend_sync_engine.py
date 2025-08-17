# backend/sync_engine.py - Sync engine for conflict resolution

import json
import hashlib
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

from backend_database import Database
from backend_models import OperationType, Delta

logger = logging.getLogger(__name__)

class SyncEngine:
    def __init__(self, db: Database):
        self.db = db
    
    async def process_sync(self, client_id: str, base_cursor: str, operations: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Process sync operations from client"""
        conflicts = []
        applied_ops = []
        
        for op in operations:
            # Apply operation to database
            try:
                success = await self._apply_operation(op, client_id)
            except Exception as e:
                logger.error(f"Error applying operation: {e}")
                success = False
            
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
        op_type = op.get("op")
        table_id = op.get("tableId")
        
        if not op_type or not table_id:
            return False
        
        # Get current table
        table = await self.db.get_table(table_id)
        
        try:
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
            else:
                logger.warning(f"Unknown operation type: {op_type}")
                return False
        except Exception as e:
            logger.error(f"Error applying operation {op_type}: {e}")
            return False

    # Placeholder methods for the actual operation implementations
    async def _apply_set_cell(self, table, op, client_id):
        pass

    async def _apply_add_row(self, table, op, client_id):
        pass

    async def _apply_delete_row(self, table, op, client_id):
        pass

    async def _apply_add_column(self, table, op, client_id):
        pass

    async def _apply_delete_column(self, table, op, client_id):
        pass

    async def _apply_set_header(self, table, op, client_id):
        pass

    async def _apply_rename_table(self, table, op, client_id):
        pass

    def _generate_cursor(self, client_id, op):
        # Dummy implementation
        return hashlib.sha256(f"{client_id}{json.dumps(op)}".encode()).hexdigest()

    async def _get_other_client_changes(self, base_cursor, client_id):
        # Dummy implementation
        return []

    def _event_to_delta(self, event):
        # Dummy implementation
        return