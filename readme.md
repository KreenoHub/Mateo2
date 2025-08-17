# TableHub - Offline-First PWA Table Editor

A modern, phone-friendly Progressive Web App (PWA) for editing tables offline with automatic synchronization to a central server when online.

## 🎯 Features

- **Offline-First**: Full functionality without internet connection
- **PWA**: Installable on mobile and desktop devices
- **Real-time Sync**: Automatic synchronization when online
- **Conflict Resolution**: Per-cell Last-Writer-Wins (LWW) with visual conflict indicators
- **Import/Export**: Support for JSON and CSV formats
- **Responsive Design**: Optimized for mobile and desktop
- **11 Pre-seeded Tables**: Start with ready-to-use 3×3 tables

## 🏗️ Architecture

### Frontend (Vanilla JS + PWA)
- **IndexedDB** for local storage
- **Service Worker** for offline caching
- **Change Queue** for sync management
- **No framework dependencies** - pure HTML/CSS/JS

### Backend (FastAPI)
- **RESTful API** with async support
- **SQLite** (development) / **PostgreSQL** (production)
- **Event-sourced sync** with cursor-based pagination
- **CORS-enabled** for cross-origin requests

## 🚀 Quick Start

### Development Setup

#### Frontend Only (Offline Mode)
```bash
cd frontend
python -m http.server 8080
# Or use any static file server
npx serve .
```
Visit http://localhost:8080

#### Backend
```bash
cd backend
pip install -r requirements.txt
python app.py
```
API will be available at http://localhost:8000

### Docker Deployment
```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t tablehub-api .
docker run -p 8000:8000 -v ./data:/app/data tablehub-api
```

## 📱 PWA Installation

### Mobile (Android/iOS)
1. Open the app in Chrome/Safari
2. Tap "Add to Home Screen" when prompted
3. Or use browser menu → "Install app"

### Desktop (Chrome/Edge)
1. Click install icon in address bar
2. Or use menu → "Install TableHub"

## 🔄 Sync Configuration

1. Open Settings (⚙️ icon)
2. Enter server URL (e.g., `https://api.yourdomain.com`)
3. Enable "Auto-sync when online"
4. Click "Sync Now" for manual sync

## 📊 Data Model

### Table Structure
```json
{
  "id": "t123abc",
  "name": "Table 1",
  "headers": ["Col 1", "Col 2", "Col 3"],
  "rows": [
    {
      "rowId": "r1",
      "cells": ["A1", "B1", "C1"],
      "cellMeta": [
        {"value": "A1", "ts": 1692268810000, "by": "client_abc"}
      ]
    }
  ],
  "updatedAt": "2025-08-17T10:00:00Z",
  "version": 42
}
```

### Sync Operations
- `setCell`: Update cell value
- `addRow`: Insert new row
- `deleteRow`: Remove row
- `addColumn`: Add new column
- `deleteColumn`: Remove column
- `setHeader`: Update column header
- `renameTable`: Change table name
- `deleteTable`: Delete entire table

## 🔐 Conflict Resolution

**Per-cell Last-Writer-Wins (LWW)**
- Each cell tracks: value, timestamp, client ID
- Conflicts resolved by timestamp (newer wins)
- Client ID used as tiebreaker
- Visual indicators for conflicts

## 🛠️ API Endpoints

### Health Check
- `GET /healthz` - Service health status

### Tables CRUD
- `GET /api/tables` - List all tables
- `POST /api/tables` - Create table
- `GET /api/tables/{id}` - Get table
- `PUT /api/tables/{id}` - Update table
- `PATCH /api/tables/{id}` - Partial update
- `DELETE /api/tables/{id}` - Delete table

### Sync
- `POST /api/sync` - Push changes
- `GET /api/sync?since={cursor}` - Pull changes

### Export
- `GET /api/export.json` - Export as JSON
- `GET /api/export.csv` - Export as CSV

## 🏗️ Development Milestones

### ✅ M1 - Offline PWA
- IndexedDB storage
- 11 seeded tables
- Import/export functionality
- PWA installation

### ✅ M2 - Sync Engine
- FastAPI backend
- Sync queue management
- Conflict resolution
- Real-time updates

### ✅ M3 - Production Ready
- Docker containerization
- PostgreSQL support
- CSV import/export
- Performance optimizations

## 🧪 Testing

### Frontend Testing
```bash
# Open browser DevTools
# Test offline mode: Network tab → Offline
# Test PWA: Application tab → Service Workers
# Test sync: Network tab → Monitor API calls
```

### Backend Testing
```bash
cd backend
pytest tests/
```

### End-to-End Testing
1. Create/edit tables offline
2. Go online and sync
3. Open on another device
4. Verify data convergence

## 🐳 Production Deployment

### Environment Variables
```bash
# Backend
DATABASE_URL=postgresql://user:pass@host/db
CORS_ORIGINS=https://yourdomain.com
SECRET_KEY=your-secret-key
DEBUG=false

# Frontend
API_URL=https://api.yourdomain.com
```

### With PostgreSQL
```yaml
# Uncomment postgres service in docker-compose.yml
# Update DATABASE_URL in api service
DATABASE_URL=postgresql://tablehub:changeme@postgres/tablehub
```

### SSL/HTTPS
1. Add SSL certificates to nginx configuration
2. Update CORS origins
3. Force HTTPS redirect

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open pull request

## 🐛 Known Issues

- Safari: Limited IndexedDB storage (50MB)
- iOS: PWA reinstall required after updates
- Firefox: Service Worker requires HTTPS

## 📞 Support

- Issues: GitHub Issues
- Email: support@example.com
- Documentation: /docs