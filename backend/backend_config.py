# backend/config.py - Application configuration

import os
from typing import List

class Settings:
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", 
        "sqlite:///./tablehub.db"
    )
    
    # CORS
    CORS_ORIGINS: List[str] = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3000,http://localhost:5173,http://localhost:8080"
    ).split(",")
    
    # Debug mode
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"
    
    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    # Sync settings
    MAX_SYNC_BATCH_SIZE: int = int(os.getenv("MAX_SYNC_BATCH_SIZE", "100"))
    SYNC_EVENT_RETENTION_DAYS: int = int(os.getenv("SYNC_EVENT_RETENTION_DAYS", "30"))
    
    # Security (for production)
    SECRET_KEY: str = os.getenv("SECRET_KEY", "change-me-in-production")
    JWT_ENABLED: bool = os.getenv("JWT_ENABLED", "false").lower() == "true"
    JWT_SECRET: str = os.getenv("JWT_SECRET", SECRET_KEY)
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_HOURS: int = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))

settings = Settings()