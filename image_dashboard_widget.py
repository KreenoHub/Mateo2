"""
image_dashboard_widget.py
-------------------------
A scalable, modular Jupyter dashboard builder using ipywidgets.

Features
- Rebuild a dashboard from a layout "spec" (dict or dataclasses).
- Blocks: title, subtitle, text, table (pandas), chart (matplotlib), image, metric, spacer.
- Multi-tab support (list of specs).
- Simple DataModel with publish/subscribe for live/static updates.
- Export to standalone HTML using ipywidgets.embed (no Dash/Streamlit/etc.).
- Mobile-ish: uses responsive CSS grid via 'repeat(auto-fit, minmax(...))' and width='100%'.

Usage (in a notebook):

    from image_dashboard_widget import (
        DataModel, LayoutSpec, BlockSpec, DashboardBuilder,
        parse_image_to_spec, build_dashboard_from_spec, export_dashboard_html
    )

    # 1) Optionally upload an image -> parse to a starter spec
    spec = parse_image_to_spec("my_slide.png")  # heuristic starter, edit the spec as you like

    # 2) Build dashboard
    db = DashboardBuilder()
    widget = db.build(spec)

    display(widget)

    # 3) Export to HTML if needed
    export_dashboard_html(widget, "dashboard.html")

"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
import io
import math
import base64

# Core UI
import ipywidgets as widgets
from IPython.display import display, HTML, clear_output

# Data & plots
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt

# Image (optional, for simple size probing)
try:
    from PIL import Image
    _PIL_OK = True
except Exception:
    _PIL_OK = False

# ---------------------------------------------------------------------
# Data layer (very lightweight, pluggable)
# ---------------------------------------------------------------------

class DataModel:
    """Minimal pub/sub data container for dashboard blocks.

    Store domain objects under string keys. Call `update` to notify subscribers.

    Example:
        data = DataModel({"kpis": {"uptime": 99.9}, "table": df})
        def on_change(dm: DataModel):
            # access dm["kpis"], dm["table"], etc.
            pass
        data.subscribe(on_change)
        data.update({"kpis": {"uptime": 99.8}})
    """
    def __init__(self, initial: Optional[Dict[str, Any]] = None):
        self._store: Dict[str, Any] = dict(initial or {})
        self._subs: List[Callable[[DataModel], None]] = []

    def __getitem__(self, key: str) -> Any:
        return self._store.get(key)

    def get(self, key: str, default=None) -> Any:
        return self._store.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self._store[key] = value

    def update(self, patch: Dict[str, Any]) -> None:
        self._store.update(patch)
        for fn in list(self._subs):
            try:
                fn(self)
            except Exception as e:
                print("Subscriber raised:", e)

    def subscribe(self, fn: Callable[["DataModel"], None]) -> None:
        self._subs.append(fn)

    def unsubscribe(self, fn: Callable[["DataModel"], None]) -> None:
        self._subs = [f for f in self._subs if f is not fn]


# ---------------------------------------------------------------------
# Spec layer
# ---------------------------------------------------------------------

@dataclass
class BlockSpec:
    """One block in the grid."""
    type: str   # 'title' | 'subtitle' | 'text' | 'table' | 'chart' | 'image' | 'metric' | 'spacer'
    content: Any = None  # depends on type
    row: int = 0
    col: int = 0
    row_span: int = 1
    col_span: int = 1
    align: str = "start"   # start | center | end | stretch
    justify: str = "start" # start | center | end | stretch
    style: Dict[str, Any] = field(default_factory=dict)  # e.g., {"font_size": "18px", "font_weight": "600"}
    data_key: Optional[str] = None  # optional data key from DataModel

@dataclass
class LayoutSpec:
    """A whole page (grid) of blocks.

    If `tabs` is provided, this spec represents a multi-tab dashboard: each tab is a LayoutSpec.
    """
    title: Optional[str] = None
    ncols: int = 4
    gap_px: int = 8
    min_col_px: int = 240  # responsive minimum
    blocks: List[BlockSpec] = field(default_factory=list)
    tabs: Optional[List["LayoutSpec"]] = None


# ---------------------------------------------------------------------
# Dashboard builder
# ---------------------------------------------------------------------

class DashboardBuilder:
    """Build ipywidgets dashboards from layout specs."""

    def __init__(self, data: Optional[DataModel] = None):
        self.data = data or DataModel()
        self._block_widgets: List[widgets.Widget] = []  # keep track for updates

    # ---------- public API ----------

    def build(self, spec: LayoutSpec) -> widgets.Widget:
        if spec.tabs:
            return self._build_tabs(spec)
        return self._build_page(spec)

    def block_factory(self, b: BlockSpec) -> widgets.Widget:
        t = b.type.lower()
        if t == "title":
            return self._block_title(b)
        if t == "subtitle":
            return self._block_subtitle(b)
        if t == "text":
            return self._block_text(b)
        if t == "table":
            return self._block_table(b)
        if t == "chart":
            return self._block_chart(b)
        if t == "image":
            return self._block_image(b)
        if t == "metric":
            return self._block_metric(b)
        if t == "spacer":
            return self._block_spacer(b)
        return self._block_text(BlockSpec(type="text", content=f"Unknown block type: {b.type}"))

    # ---------- layout builders ----------

    def _build_tabs(self, spec: LayoutSpec) -> widgets.Widget:
        tabs = widgets.Tab(layout=widgets.Layout(width="100%"))
        children = []
        titles = []
        for i, sub in enumerate(spec.tabs or []):
            child = self._build_page(sub)
            children.append(child)
            titles.append(sub.title or f"Page {i+1}")
        tabs.children = children
        for i, t in enumerate(titles):
            tabs.set_title(i, t)
        return tabs

    def _build_page(self, spec: LayoutSpec) -> widgets.Widget:
        # Optional page title
        title_area = widgets.HTML(
            f"<h2 style='margin: 0.25em 0 0.5em 0; font-weight:600'>{spec.title or ''}</h2>",
            layout=widgets.Layout(width="100%")
        ) if spec.title else None

        # Build all block widgets
        items = []
        self._block_widgets.clear()
        for b in spec.blocks:
            w = self.block_factory(b)
            self._apply_block_layout(w, b)
            items.append(w)
            self._block_widgets.append(w)

        # Responsive CSS grid
        grid = widgets.GridBox(
            children=items,
            layout=widgets.Layout(
                width="100%",
                grid_gap=f"{spec.gap_px}px",
                display="grid",
                grid_template_columns=f"repeat(auto-fit, minmax({spec.min_col_px}px, 1fr))",
            )
        )

        if title_area:
            vbox = widgets.VBox([title_area, grid], layout=widgets.Layout(width="100%"))
            return vbox
        return grid

    def _apply_block_layout(self, w: widgets.Widget, b: BlockSpec) -> None:
        # Alignment map to CSS
        align_items = {"start": "start", "center": "center", "end": "end", "stretch": "stretch"}.get(b.align, "start")
        justify_items = {"start": "start", "center": "center", "end": "end", "stretch": "stretch"}.get(b.justify, "start")

        w.layout = widgets.Layout(
            width="100%",
            align_items=align_items,
            justify_items=justify_items,
        )

    # ---------- block renderers ----------

    def _block_title(self, b: BlockSpec) -> widgets.Widget:
        fs = b.style.get("font_size", "24px")
        fw = b.style.get("font_weight", "700")
        return widgets.HTML(f"<div style='font-size:{fs};font-weight:{fw}'>{b.content or ''}</div>")

    def _block_subtitle(self, b: BlockSpec) -> widgets.Widget:
        fs = b.style.get("font_size", "18px")
        fw = b.style.get("font_weight", "600")
        return widgets.HTML(f"<div style='font-size:{fs};font-weight:{fw}'>{b.content or ''}</div>")

    def _block_text(self, b: BlockSpec) -> widgets.Widget:
        fs = b.style.get("font_size", "14px")
        return widgets.HTML(f"<div style='font-size:{fs}'>{b.content or ''}</div>")

    def _block_metric(self, b: BlockSpec) -> widgets.Widget:
        label = (b.content or {}).get("label", "Metric")
        value = (b.content or {}).get("value", "")
        sup   = (b.content or {}).get("suffix", "")
        fs_v  = b.style.get("value_size", "28px")
        fs_l  = b.style.get("label_size", "12px")
        html = f"""
        <div style="display:flex;flex-direction:column;gap:4px">
            <div style="font-size:{fs_l};opacity:0.7">{label}</div>
            <div style="font-size:{fs_v};font-weight:700;line-height:1">{value}<span style="font-size:0.6em;opacity:0.7">{sup}</span></div>
        </div>"""
        return widgets.HTML(html)

    def _block_spacer(self, b: BlockSpec) -> widgets.Widget:
        h = b.style.get("height", "8px")
        return widgets.HTML(f"<div style='height:{h}'></div>")

    def _block_table(self, b: BlockSpec) -> widgets.Widget:
        # Allow both raw data and DataFrame
        df = None
        if isinstance(b.content, pd.DataFrame):
            df = b.content
        elif isinstance(b.content, dict):
            df = pd.DataFrame(b.content)
        elif isinstance(b.content, list):
            df = pd.DataFrame(b.content)
        else:
            df = pd.DataFrame({"message": ["(empty table)"]})

        # Render with a simple HTML table
        # (ipywidgets doesn't have a native DataGrid; we keep dependencies minimal)
        html = df.to_html(index=False)
        return widgets.HTML(f"<div style='overflow:auto;max-height:400px'>{html}</div>")

    def _block_chart(self, b: BlockSpec) -> widgets.Widget:
        """Matplotlib single-axes chart. No explicit colors; one plot per block."""
        data = b.content or {}
        x = data.get("x", list(range(10)))
        y = data.get("y", [math.sin(i/2) for i in range(len(x))])

        fig, ax = plt.subplots()
        ax.plot(x, y)  # single plot, no style/colors specified
        ax.set_xlabel(data.get("xlabel", ""))
        ax.set_ylabel(data.get("ylabel", ""))
        ax.set_title(data.get("title", ""))

        out = widgets.Output(layout=widgets.Layout(width="100%"))
        with out:
            display(fig)
        plt.close(fig)
        return out

    def _block_image(self, b: BlockSpec) -> widgets.Widget:
        """Accepts raw bytes (PNG/JPG), a base64 string, or a file path."""
        payload = b.content
        if payload is None:
            return widgets.HTML("<i>(no image)</i>")

        fmt = "png"
        if isinstance(payload, bytes):
            data_bytes = payload
        elif isinstance(payload, str):
            # If it's a file path, read it. Otherwise treat it as base64.
            try:
                with open(payload, "rb") as f:
                    data_bytes = f.read()
            except Exception:
                # assume base64
                try:
                    data_bytes = base64.b64decode(payload)
                except Exception:
                    return widgets.HTML("<i>(invalid image content)</i>")
        else:
            return widgets.HTML("<i>(unsupported image content)</i>")

        b64 = base64.b64encode(data_bytes).decode("ascii")
        return widgets.HTML(f"<img src='data:image/{fmt};base64,{b64}' style='width:100%;height:auto;border-radius:10px'/>")


# ---------------------------------------------------------------------
# Image -> starter spec (heuristic, editable)
# ---------------------------------------------------------------------

def parse_image_to_spec(image: Union[str, bytes, None]) -> LayoutSpec:
    """Create a *starter* LayoutSpec based on the image aspect ratio.

    We do not do heavy CV here. The goal is to give you a clean spec that
    you can edit to match the uploaded slide/table. Blocks are prefilled
    with typical elements (title, image preview, table, chart, text).
    """
    width, height = 1280, 720  # default 16:9
    if image is not None:
        try:
            if isinstance(image, str) and _PIL_OK:
                with Image.open(image) as im:
                    width, height = im.size
            elif isinstance(image, bytes) and _PIL_OK:
                with Image.open(io.BytesIO(image)) as im:
                    width, height = im.size
        except Exception:
            pass

    aspect = width / max(height, 1)
    ncols = 4 if aspect > 1.2 else 2
    min_col_px = 240 if ncols >= 4 else 280

    # Starter content
    sample_df = pd.DataFrame({
        "Name": ["Alpha", "Beta", "Gamma", "Delta"],
        "Value": [10, 12, 9, 14],
    })

    blocks = [
        BlockSpec(type="title", content="Dashboard Title", style={"font_size": "26px", "font_weight": "700"}),
        BlockSpec(type="subtitle", content="Subtitle / Date Range", style={"font_size": "16px"}),
        BlockSpec(type="image", content=image, style={}, ),
        BlockSpec(type="metric", content={"label": "Throughput", "value": "120", "suffix": "/hr"}),
        BlockSpec(type="metric", content={"label": "Cost", "value": "4.2", "suffix": " USD"}),
        BlockSpec(type="table", content=sample_df),
        BlockSpec(type="chart", content={"title": "Sample Trend", "x": list(range(10)), "y": [i*i for i in range(10)]}),
        BlockSpec(type="text", content="<b>Notes:</b> Replace or extend blocks to match your layout."),
    ]

    return LayoutSpec(
        title="Auto-starter (edit me)",
        ncols=ncols,
        gap_px=10,
        min_col_px=min_col_px,
        blocks=blocks
    )


# ---------------------------------------------------------------------
# Helpers: build from spec, export to HTML
# ---------------------------------------------------------------------

def build_dashboard_from_spec(spec: Union[LayoutSpec, Dict[str, Any]], data: Optional[DataModel] = None) -> widgets.Widget:
    """Convenience wrapper for one-liners."""
    if isinstance(spec, dict):
        # lightweight validation/coercion
        blocks = [BlockSpec(**b) for b in spec.get("blocks", [])]
        spec = LayoutSpec(
            title=spec.get("title"),
            ncols=spec.get("ncols", 4),
            gap_px=spec.get("gap_px", 8),
            min_col_px=spec.get("min_col_px", 240),
            blocks=blocks,
            tabs=spec.get("tabs"),
        )
    builder = DashboardBuilder(data=data)
    return builder.build(spec)


def export_dashboard_html(widget: widgets.Widget, path: str = "dashboard.html") -> str:
    """Export a standalone HTML (no running kernel needed to view)."""
    from ipywidgets import embed
    state = embed.widget_state(widget)
    embed.embed_minimal_html(path, views=[widget], state=state)
    return path


# ---------------------------------------------------------------------
# Example: build a multi-tab spec (for future scaling)
# ---------------------------------------------------------------------

def example_multitab_spec() -> LayoutSpec:
    page1 = LayoutSpec(
        title="Overview",
        ncols=4,
        min_col_px=240,
        blocks=[
            BlockSpec(type="metric",  content={"label": "Uptime", "value": "99.9", "suffix": "%"}),
            BlockSpec(type="metric",  content={"label": "Active Users", "value": "1,234"}),
            BlockSpec(type="chart",   content={"title": "Users (7d)", "x": list(range(7)), "y": [2,3,5,7,11,13,17]}),
            BlockSpec(type="table",   content={"Day": list("MTWTFSS"), "Count": [2,3,5,7,11,13,17]}),
        ]
    )
    page2 = LayoutSpec(
        title="Details",
        ncols=3,
        min_col_px=260,
        blocks=[
            BlockSpec(type="title",   content="Detailed Breakdown"),
            BlockSpec(type="text",    content="Put granular widgets here."),
            BlockSpec(type="spacer",  style={"height": "16px"}),
            BlockSpec(type="chart",   content={"title": "Costs", "x": list(range(5)), "y": [5,4,3,2,1]}),
        ]
    )
    return LayoutSpec(tabs=[page1, page2])


# ---------------------------------------------------------------------
# Minimal demo (call run_demo() inside a notebook to try)
# ---------------------------------------------------------------------

def run_demo(image_path: Optional[str] = None) -> widgets.Widget:
    """Quick demo: build a starter dashboard, show it, and return the widget."""
    spec = parse_image_to_spec(image_path)
    w = build_dashboard_from_spec(spec)
    display(w)
    return w
