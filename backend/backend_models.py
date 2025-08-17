# backend/models.py - Pydantic models for API

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from enum import Enum

class OperationType(str, Enum):
    SET_CELL = "setCell"
    ADD_ROW = "addRow"
    DELETE_ROW = "deleteRow"
    ADD_COLUMN = "addColumn"
    DELETE_COLUMN = "deleteColumn"
    SET_HEADER = "setHeader"
    RENAME_TABLE = "renameTable"
    DELETE_TABLE = "deleteTable"

class CellMeta(BaseModel):
    value: str
    ts: int  # timestamp in milliseconds
    by: str  # client ID

class Row(BaseModel):
    rowId: str
    cells: List[str]
    cellMeta: Optional[List[Optional[CellMeta]]] = []

class Table(BaseModel):
    id: str
    name: str
    headers: List[str]
    rows: List[Row]
    updatedAt: str
    version: int = 1

class ChangeOp(BaseModel):
    op: OperationType
    tableId: str
    rowId: Optional[str] = None
    col: Optional[int] = None
    value: Optional[str] = None
    afterRowId: Optional[str] = None
    colIndex: Optional[int] = None
    header: Optional[str] = None
    name: Optional[str] = None
    ts: int  # Client timestamp

class SyncRequest(BaseModel):
    clientId: str
    baseCursor: str
    ops: List[ChangeOp]

class Delta(BaseModel):
    op: OperationType
    tableId: str
    rowId: Optional[str] = None
    col: Optional[int] = None
    value: Optional[str] = None
    afterRowId: Optional[str] = None
    colIndex: Optional[int] = None
    header: Optional[str] = None
    name: Optional[str] = None
    serverTs: str  # Server timestamp
    by: Optional[str] = None  # Client ID that made the change

class Conflict(BaseModel):
    tableId: str
    rowId: Optional[str]
    col: Optional[int]
    localValue: str
    remoteValue: str
    resolution: str  # "local" or "remote"

class SyncResponse(BaseModel):
    success: bool
    cursor: str
    deltas: List[Delta]
    conflicts: Optional[List[Conflict]] = []
    error: Optional[str] = None

class SyncEvent(BaseModel):
    id: Optional[int] = None
    cursor: str
    clientId: str
    operation: Dict[str, Any]
    serverTs: datetime
    applied: bool = True
