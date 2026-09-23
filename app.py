from fastapi import FastAPI, HTTPException, UploadFile, File, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import sqlite3, json, csv, io, uuid, os

DB_PATH = os.environ.get("TABLEHUB_DB", "tablehub.db")

# ------------------------- Pydantic models -------------------------

class TableRow(BaseModel):
    cells: List[Any] = Field(default_factory=list)

class Table(BaseModel):
    id: str
    name: str
    headers: List[str] = Field(default_factory=list)
    rows: List[TableRow] = Field(default_factory=list)

class TableCreate(BaseModel):
    name: str = "Untitled Table"
    headers: List[str] = Field(default_factory=list)
    rows: List[List[Any]] = Field(default_factory=list)

class TableUpdate(BaseModel):
    name: Optional[str] = None
    headers: Optional[List[str]] = None
    rows: Optional[List[List[Any]]] = None

# ------------------------- DB helpers -------------------------

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS tables (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            headers TEXT NOT NULL -- JSON array
        );
        CREATE TABLE IF NOT EXISTS rows (
            table_id TEXT NOT NULL,
            row_index INTEGER NOT NULL,
            data TEXT NOT NULL, -- JSON array
            PRIMARY KEY (table_id, row_index),
            FOREIGN KEY (table_id) REFERENCES tables(id) ON DELETE CASCADE
        );
        """
    )
    conn.commit()
    conn.close()

def table_exists(conn, tid: str) -> bool:
    cur = conn.execute("SELECT 1 FROM tables WHERE id=?", (tid,))
    return cur.fetchone() is not None

def read_table(conn, tid: str) -> Table:
    cur = conn.execute("SELECT id,name,headers FROM tables WHERE id=?", (tid,))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Table not found")
    headers = json.loads(row["headers"])
    cur = conn.execute("SELECT row_index,data FROM rows WHERE table_id=? ORDER BY row_index", (tid,))
    rows = [TableRow(cells=json.loads(r["data"])) for r in cur.fetchall()]
    return Table(id=row["id"], name=row["name"], headers=headers, rows=rows)

def write_table(conn, t: Table) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO tables(id,name,headers) VALUES(?,?,?)",
        (t.id, t.name, json.dumps(t.headers))
    )
    conn.execute("DELETE FROM rows WHERE table_id=?", (t.id,))
    for i, tr in enumerate(t.rows):
        conn.execute(
            "INSERT INTO rows(table_id,row_index,data) VALUES(?,?,?)",
            (t.id, i, json.dumps(tr.cells))
        )

# ------------------------- FastAPI app -------------------------

app = FastAPI(title="TableHub Backend", version="0.1.0")

# CORS: allow local dev origins
origins = [
    "http://localhost",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:8000",
    "*",  # relax for local/dev; tighten in prod
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def _startup():
    init_db()

@app.get("/healthz")
def healthz():
    return {"ok": True}

@app.get("/api/tables", response_model=List[Table])
def list_tables():
    conn = get_conn()
    cur = conn.execute("SELECT id FROM tables ORDER BY name")
    tids = [r["id"] for r in cur.fetchall()]
    tables = [read_table(conn, tid) for tid in tids]
    conn.close()
    return tables

@app.post("/api/tables", response_model=Table, status_code=201)
def create_table(payload: TableCreate):
    tid = uuid.uuid4().hex[:8]
    t = Table(
        id=tid,
        name=payload.name or "Untitled Table",
        headers=payload.headers or [],
        rows=[TableRow(cells=r) for r in (payload.rows or [])]
    )
    conn = get_conn()
    write_table(conn, t)
    conn.commit()
    conn.close()
    return t

@app.get("/api/tables/{tid}", response_model=Table)
def get_table(tid: str):
    conn = get_conn()
    t = read_table(conn, tid)
    conn.close()
    return t

@app.put("/api/tables/{tid}", response_model=Table)
def put_table(tid: str, payload: TableCreate):
    conn = get_conn()
    if not table_exists(conn, tid):
        conn.close()
        raise HTTPException(404, "Table not found")
    t = Table(
        id=tid, name=payload.name or "Untitled Table",
        headers=payload.headers or [],
        rows=[TableRow(cells=r) for r in (payload.rows or [])]
    )
    conn = get_conn()
    write_table(conn, t)
    conn.commit()
    conn.close()
    return t

@app.patch("/api/tables/{tid}", response_model=Table)
def patch_table(tid: str, payload: TableUpdate):
    conn = get_conn()
    t = read_table(conn, tid)
    # apply patch
    if payload.name is not None:
        t.name = payload.name
    if payload.headers is not None:
        t.headers = payload.headers
    if payload.rows is not None:
        t.rows = [TableRow(cells=r) for r in payload.rows]
    write_table(conn, t)
    conn.commit()
    conn.close()
    return t

@app.delete("/api/tables/{tid}", status_code=204)
def delete_table(tid: str):
    conn = get_conn()
    cur = conn.execute("DELETE FROM tables WHERE id=?", (tid,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Table not found")
    return JSONResponse(status_code=204, content=None)

@app.post("/api/import")
def import_json(file: UploadFile = File(...)):
    content = file.file.read().decode("utf-8")
    try:
        obj = json.loads(content)
        assert isinstance(obj, dict) and isinstance(obj.get("tables"), list)
    except Exception:
        raise HTTPException(400, "Invalid JSON schema")

    conn = get_conn()
    cur = conn.execute("SELECT id FROM tables")
    for r in cur.fetchall():
        conn.execute("DELETE FROM tables WHERE id=?", (r["id"],))
    conn.commit()

    for t in obj["tables"]:
        tid = t.get("id") or uuid.uuid4().hex[:8]
        name = t.get("name", "Imported Table")
        headers = t.get("headers") or []
        rows = [TableRow(cells=row) for row in (t.get("rows") or [])]
        write_table(conn, Table(id=tid, name=name, headers=headers, rows=rows))
    conn.commit()
    conn.close()
    return {"ok": True, "count": len(obj["tables"])}

@app.get("/api/export.json")
def export_json():
    conn = get_conn()
    cur = conn.execute("SELECT id FROM tables ORDER BY name")
    tids = [r["id"] for r in cur.fetchall()]
    tables = [read_table(conn, tid) for tid in tids]
    conn.close()
    payload = {
        "version": 1,
        "tables": [t.model_dump() for t in tables]
    }
    return JSONResponse(payload)

@app.get("/api/export.csv")
def export_csv():
    conn = get_conn()
    cur = conn.execute("SELECT id FROM tables ORDER BY name")
    tids = [r["id"] for r in cur.fetchall()]
    tables = [read_table(conn, tid) for tid in tids]
    conn.close()

    buf = io.StringIO()
    for idx, t in enumerate(tables):
        buf.write(f"# {t.name}\n")
        writer = csv.writer(buf)
        writer.writerow(t.headers)
        for tr in t.rows:
            writer.writerow(tr.cells)
        if idx < len(tables)-1:
            buf.write("\n")
    return PlainTextResponse(buf.getvalue(), media_type="text/csv")

if __name__ == "__main__":
    import uvicorn
    init_db()
    uvicorn.run(app, host="0.0.0.0", port=8000)
