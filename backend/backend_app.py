# backend/app.py - FastAPI backend application

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import csv
import io
import logging

from backend_database import Database
from backend_models import Table, SyncRequest, SyncResponse, Delta, ChangeOp
from backend_sync_engine import SyncEngine
from backend_config import settings

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="TableHub API",
    description="Offline-first table synchronization backend",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database and sync engine
db = Database(settings.DATABASE_URL)
sync_engine = SyncEngine(db)

@app.on_event("startup")
async def startup_event():
    """Initialize database on startup"""
    await db.init()
    logger.info("Database initialized")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    await db.close()
    logger.info("Database connection closed")

# Root endpoint
@app.get("/")
async def root():
    return {"message": "TableHub backend is running", "docs": "/docs"}

# Health check endpoint
@app.get("/healthz")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0"
    }

# Export endpoints
@app.get("/api/export.json")
async def export_json():
    """Export all tables as JSON"""
    try:
        tables = await db.get_all_tables()
        export_data = {
            "meta": {
                "exportedAt": datetime.utcnow().isoformat(),
                "tableCount": len(tables),
                "version": "1.0.0"
            },
            "tables": tables
        }
        
        return JSONResponse(
            content=export_data,
            headers={
                "Content-Disposition": f"attachment; filename=tablehub-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
            }
        )
    except Exception as e:
        logger.error(f"Export JSON failed: {e}")
        raise HTTPException(status_code=500, detail="Export failed")

@app.get("/api/export.csv")
async def export_csv():
    """Export all tables as CSV"""
    try:
        tables = await db.get_all_tables()
        
        output = io.StringIO()
        writer = csv.writer(output)
        
        for table in tables:
            # Write table name
            writer.writerow([f"Table: {table['name']}"])
            
            # Write headers
            writer.writerow(table.get("headers", []))
            
            # Write rows
            for row in table.get("rows", []):
                writer.writerow(row.get("cells", []))
            
            # Empty row between tables
            writer.writerow([])
        
        output.seek(0)
        
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=tablehub-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
            }
        )
    except Exception as e:
        logger.error(f"Export CSV failed: {e}")
        raise HTTPException(status_code=500, detail="Export failed")

# Table CRUD endpoints
@app.get("/api/tables")
async def get_tables():
    """Get all tables"""
    try:
        tables = await db.get_all_tables()
        return {"tables": tables}
    except Exception as e:
        logger.error(f"Get tables failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve tables")

@app.post("/api/tables")
async def create_table(table: Table):
    """Create a new table"""
    try:
        table_id = await db.create_table(table.dict())
        return {"id": table_id, "message": "Table created successfully"}
    except Exception as e:
        logger.error(f"Create table failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to create table")

@app.get("/api/tables/{table_id}")
async def get_table(table_id: str):
    """Get a specific table"""
    try:
        table = await db.get_table(table_id)
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
        return table
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get table failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to retrieve table")

@app.put("/api/tables/{table_id}")
async def update_table(table_id: str, table: Table):
    """Update a table"""
    try:
        success = await db.update_table(table_id, table.dict())
        if not success:
            raise HTTPException(status_code=404, detail="Table not found")
        return {"message": "Table updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update table failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to update table")

@app.patch("/api/tables/{table_id}")
async def patch_table(table_id: str, updates: Dict[str, Any]):
    """Partially update a table"""
    try:
        table = await db.get_table(table_id)
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
        
        # Merge updates
        for key, value in updates.items():
            table[key] = value
        
        table["updatedAt"] = datetime.utcnow().isoformat()
        success = await db.update_table(table_id, table)
        
        if not success:
            raise HTTPException(status_code=500, detail="Update failed")
        
        return {"message": "Table patched successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Patch table failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to patch table")

@app.delete("/api/tables/{table_id}")
async def delete_table(table_id: str):
    """Delete a table"""
    try:
        success = await db.delete_table(table_id)
        if not success:
            raise HTTPException(status_code=404, detail="Table not found")
        return {"message": "Table deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete table failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete table")

# Sync endpoints
@app.post("/api/sync")
async def sync_push(request: SyncRequest):
    """Handle sync push from client"""
    try:
        # Process operations
        result = await sync_engine.process_sync(
            client_id=request.clientId,
            base_cursor=request.baseCursor,
            operations=request.ops
        )
        
        return SyncResponse(
            success=True,
            cursor=result["cursor"],
            deltas=result.get("deltas", []),
            conflicts=result.get("conflicts", [])
        )
    except Exception as e:
        logger.error(f"Sync push failed: {e}")
        return SyncResponse(
            success=False,
            error=str(e),
            cursor=request.baseCursor,
            deltas=[],
            conflicts=[]
        )

@app.get("/api/sync")
async def sync_pull(since: str = Query("0", description="Cursor for incremental sync")):
    """Handle sync pull from client"""
    try:
        # Get changes since cursor
        result = await sync_engine.get_changes_since(since)
        
        return {
            "cursor": result["cursor"],
            "deltas": result["deltas"],
            "tables": result.get("tables", [])
        }
    except Exception as e:
        logger.error(f"Sync pull failed: {e}")
        raise HTTPException(status_code=500, detail=f"Sync pull failed: {str(e)}")

# Debug endpoints (development only)
if settings.DEBUG:
    @app.get("/api/debug/events")
    async def get_events(limit: int = Query(100, description="Number of events to retrieve")):
        """Get recent sync events (debug only)"""
        try:
            events = await db.get_recent_events(limit)
            return {"events": events}
        except Exception as e:
            logger.error(f"Get events failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to retrieve events")
    
    @app.delete("/api/debug/reset")
    async def reset_database():
        """Reset database (debug only)"""
        try:
            await db.reset()
            return {"message": "Database reset successfully"}
        except Exception as e:
            logger.error(f"Reset failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to reset database")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend_app:app", host="0.0.0.0", port=8000, reload=True)
