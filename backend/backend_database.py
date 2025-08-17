# backend/database.py - Database operations

import json
import aiosqlite
import asyncpg
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class Database:
    def __init__(self, database_url: str):
        self.database_url = database_url
        self.is_postgres = database_url.startswith("postgresql://")
        self.conn = None
        self.pool = None
    
    async def init(self):
        """Initialize database connection and create tables"""
        if self.is_postgres:
            await self._init_postgres()
        else:
            await self._init_sqlite()
    
    async def _init_sqlite(self):
        """Initialize SQLite database"""
        self.conn = await aiosqlite.connect(self.database_url.replace("sqlite:///", ""))
        
        # Create tables
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS tables (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                data JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                version INTEGER DEFAULT 1
            )
        """)
        
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS sync_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cursor TEXT UNIQUE NOT NULL,
                client_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                server_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                applied BOOLEAN DEFAULT TRUE
            )
        """)
        
        await self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sync_events_cursor 
            ON sync_events(cursor)
        """)
        
        await self.conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_sync_events_ts 
            ON sync_events(server_ts)
        """)
        
        await self.conn.commit()
    
    async def _init_postgres(self):
        """Initialize PostgreSQL database"""
        self.pool = await asyncpg.create_pool(self.database_url)
        
        async with self.pool.acquire() as conn:
            # Create tables
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS tables (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    data JSONB NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    version INTEGER DEFAULT 1
                )
            """)
            
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS sync_events (
                    id SERIAL PRIMARY KEY,
                    cursor TEXT UNIQUE NOT NULL,
                    client_id TEXT NOT NULL,
                    operation JSONB NOT NULL,
                    server_ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    applied BOOLEAN DEFAULT TRUE
                )
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_sync_events_cursor 
                ON sync_events(cursor)
            """)
            
            await conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_sync_events_ts 
                ON sync_events(server_ts)
            """)
    
    async def close(self):
        """Close database connection"""
        if self.is_postgres and self.pool:
            await self.pool.close()
        elif self.conn:
            await self.conn.close()
    
    # Table operations
    async def get_all_tables(self) -> List[Dict[str, Any]]:
        """Get all tables"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch("SELECT * FROM tables ORDER BY updated_at DESC")
                return [self._parse_table_row(row) for row in rows]
        else:
            async with self.conn.execute("SELECT * FROM tables ORDER BY updated_at DESC") as cursor:
                rows = await cursor.fetchall()
                return [self._parse_table_row_sqlite(row) for row in rows]
    
    async def get_table(self, table_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific table"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow("SELECT * FROM tables WHERE id = $1", table_id)
                return self._parse_table_row(row) if row else None
        else:
            async with self.conn.execute("SELECT * FROM tables WHERE id = ?", (table_id,)) as cursor:
                row = await cursor.fetchone()
                return self._parse_table_row_sqlite(row) if row else None
    
    async def create_table(self, table_data: Dict[str, Any]) -> str:
        """Create a new table"""
        table_id = table_data["id"]
        name = table_data["name"]
        
        # Remove id and name from data to store in JSONB
        data = {k: v for k, v in table_data.items() if k not in ["id", "name"]}
        
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO tables (id, name, data, updated_at) 
                       VALUES ($1, $2, $3, $4)""",
                    table_id, name, json.dumps(data), datetime.utcnow()
                )
        else:
            await self.conn.execute(
                """INSERT INTO tables (id, name, data, updated_at) 
                   VALUES (?, ?, ?, ?)""",
                (table_id, name, json.dumps(data), datetime.utcnow())
            )
            await self.conn.commit()
        
        return table_id
    
    async def update_table(self, table_id: str, table_data: Dict[str, Any]) -> bool:
        """Update a table"""
        name = table_data.get("name", "")
        data = {k: v for k, v in table_data.items() if k not in ["id", "name"]}
        
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                result = await conn.execute(
                    """UPDATE tables 
                       SET name = $2, data = $3, updated_at = $4, version = version + 1
                       WHERE id = $1""",
                    table_id, name, json.dumps(data), datetime.utcnow()
                )
                return result != "UPDATE 0"
        else:
            cursor = await self.conn.execute(
                """UPDATE tables 
                   SET name = ?, data = ?, updated_at = ?, version = version + 1
                   WHERE id = ?""",
                (name, json.dumps(data), datetime.utcnow(), table_id)
            )
            await self.conn.commit()
            return cursor.rowcount > 0
    
    async def delete_table(self, table_id: str) -> bool:
        """Delete a table"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                result = await conn.execute("DELETE FROM tables WHERE id = $1", table_id)
                return result != "DELETE 0"
        else:
            cursor = await self.conn.execute("DELETE FROM tables WHERE id = ?", (table_id,))
            await self.conn.commit()
            return cursor.rowcount > 0
    
    # Sync operations
    async def add_sync_event(self, cursor: str, client_id: str, operation: Dict[str, Any]) -> int:
        """Add a sync event"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(
                    """INSERT INTO sync_events (cursor, client_id, operation, server_ts)
                       VALUES ($1, $2, $3, $4)
                       RETURNING id""",
                    cursor, client_id, json.dumps(operation), datetime.utcnow()
                )
                return row["id"]
        else:
            cursor_result = await self.conn.execute(
                """INSERT INTO sync_events (cursor, client_id, operation, server_ts)
                   VALUES (?, ?, ?, ?)""",
                (cursor, client_id, json.dumps(operation), datetime.utcnow())
            )
            await self.conn.commit()
            return cursor_result.lastrowid
    
    async def get_events_since(self, cursor: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get sync events since a cursor"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                if cursor == "0":
                    rows = await conn.fetch(
                        """SELECT * FROM sync_events 
                           ORDER BY id ASC LIMIT $1""",
                        limit
                    )
                else:
                    rows = await conn.fetch(
                        """SELECT * FROM sync_events 
                           WHERE id > (SELECT id FROM sync_events WHERE cursor = $1)
                           ORDER BY id ASC LIMIT $2""",
                        cursor, limit
                    )
                return [self._parse_event_row(row) for row in rows]
        else:
            if cursor == "0":
                query = """SELECT * FROM sync_events 
                          ORDER BY id ASC LIMIT ?"""
                params = (limit,)
            else:
                query = """SELECT * FROM sync_events 
                          WHERE id > (SELECT id FROM sync_events WHERE cursor = ?)
                          ORDER BY id ASC LIMIT ?"""
                params = (cursor, limit)
            
            async with self.conn.execute(query, params) as cursor_result:
                rows = await cursor_result.fetchall()
                return [self._parse_event_row_sqlite(row) for row in rows]
    
    async def get_recent_events(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get recent sync events"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT * FROM sync_events 
                       ORDER BY id DESC LIMIT $1""",
                    limit
                )
                return [self._parse_event_row(row) for row in rows]
        else:
            async with self.conn.execute(
                """SELECT * FROM sync_events 
                   ORDER BY id DESC LIMIT ?""",
                (limit,)
            ) as cursor:
                rows = await cursor.fetchall()
                return [self._parse_event_row_sqlite(row) for row in rows]
    
    async def get_latest_cursor(self) -> str:
        """Get the latest sync cursor"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT cursor FROM sync_events ORDER BY id DESC LIMIT 1"
                )
                return row["cursor"] if row else "0"
        else:
            async with self.conn.execute(
                "SELECT cursor FROM sync_events ORDER BY id DESC LIMIT 1"
            ) as cursor:
                row = await cursor.fetchone()
                return row[0] if row else "0"
    
    async def reset(self):
        """Reset database (development only)"""
        if self.is_postgres:
            async with self.pool.acquire() as conn:
                await conn.execute("TRUNCATE tables, sync_events RESTART IDENTITY")
        else:
            await self.conn.execute("DELETE FROM tables")
            await self.conn.execute("DELETE FROM sync_events")
            await self.conn.execute("DELETE FROM sqlite_sequence WHERE name='sync_events'")
            await self.conn.commit()
    
    # Helper methods
    def _parse_table_row(self, row) -> Dict[str, Any]:
        """Parse PostgreSQL table row"""
        data = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]
        return {
            "id": row["id"],
            "name": row["name"],
            **data,
            "updatedAt": row["updated_at"].isoformat() if row["updated_at"] else None,
            "version": row["version"]
        }
    
    def _parse_table_row_sqlite(self, row) -> Dict[str, Any]:
        """Parse SQLite table row"""
        data = json.loads(row[2])  # data column
        return {
            "id": row[0],
            "name": row[1],
            **data,
            "updatedAt": row[3],
            "version": row[4]
        }
    
    def _parse_event_row(self, row) -> Dict[str, Any]:
        """Parse PostgreSQL event row"""
        operation = json.loads(row["operation"]) if isinstance(row["operation"], str) else row["operation"]
        return {
            "id": row["id"],
            "cursor": row["cursor"],
            "clientId": row["client_id"],
            "operation": operation,
            "serverTs": row["server_ts"].isoformat() if row["server_ts"] else None,
            "applied": row["applied"]
        }
    
    def _parse_event_row_sqlite(self, row) -> Dict[str, Any]:
        """Parse SQLite event row"""
        return {
            "id": row[0],
            "cursor": row[1],
            "clientId": row[2],
            "operation": json.loads(row[3]),
            "serverTs": row[4],
            "applied": bool(row[5])
        }