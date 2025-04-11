from fastapi import FastAPI, HTTPException, Form, Request,status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from datetime import datetime, timedelta
import sqlite3
import hashlib
import jwt
import os
import json
import logging

# Initialize FastAPI
app = FastAPI()

# Enable CORS for all origins (for development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database setup function
def get_db():
    conn = sqlite3.connect('ghosttrack.db')
    conn.row_factory = sqlite3.Row
    return conn

# Create database tables if they don't exist
def init_db():
    conn = get_db()
    # Users table
    conn.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        email TEXT UNIQUE,
        password TEXT
    )
    ''')
    
    # Locations table
    conn.execute('''
    CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        latitude REAL,
        longitude REAL,
        timestamp TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    # Anti-theft device tracking
    conn.execute('''
    CREATE TABLE IF NOT EXISTS antitheft_devices (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        hardware_id TEXT UNIQUE,
        first_seen TEXT,
        last_seen TEXT,
        device_info TEXT,
        is_stolen INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    # Stolen devices table
    conn.execute('''
    CREATE TABLE IF NOT EXISTS stolen_devices (
        id INTEGER PRIMARY KEY,
        hardware_id TEXT UNIQUE,
        user_id INTEGER,
        reported_stolen_at TEXT,
        last_location TEXT,
        recovery_email TEXT,
        recovery_phone TEXT,
        FOREIGN KEY (hardware_id) REFERENCES antitheft_devices (hardware_id),
        FOREIGN KEY (user_id) REFERENCES users (id)
    )
    ''')
    
    # Stolen device locations
    conn.execute('''
    CREATE TABLE IF NOT EXISTS stolen_device_locations (
        id INTEGER PRIMARY KEY,
        hardware_id TEXT,
        latitude REAL,
        longitude REAL,
        timestamp TEXT,
        connection_info TEXT,
        FOREIGN KEY (hardware_id) REFERENCES stolen_devices (hardware_id)
    )
    ''')
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Secret key for JWT
SECRET_KEY = "dev-secret-key"  # Change in production!
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 days

# Models
class LocationData(BaseModel):
    latitude: float
    longitude: float
    timestamp: str

class DeviceRegistration(BaseModel):
    hardwareId: str
    userId: str
    email: str
    deviceInfo: dict

# Helper functions
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(user_id):
    expires = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"])
    except:
        return None

# Routes
@app.post("/api/register")
async def register(email: str = Form(...), password: str = Form(...)):
    # Hash password
    hashed_password = hash_password(password)
    
    # Save to database
    db = get_db()
    try:
        cursor = db.cursor()
        cursor.execute(
            "INSERT INTO users (email, password) VALUES (?, ?)",
            (email, hashed_password)
        )
        db.commit()
        user_id = cursor.lastrowid
        
        # Create token
        token = create_token(user_id)
        return {"token": token, "user_id": user_id, "email": email}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="Email already registered")
    finally:
        db.close()

@app.post("/api/login")
async def login(email: str = Form(...), password: str = Form(...)):
    # Check credentials
    hashed_password = hash_password(password)
    db = get_db()
    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT id FROM users WHERE email = ? AND password = ?",
            (email, hashed_password)
        )
        user = cursor.fetchone()
        
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Create token
        token = create_token(user["id"])
        return {"token": token, "user_id": user["id"], "email": email}
    finally:
        db.close()

@app.post("/api/location")
async def save_location(data: LocationData, request: Request):
    token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    
    user_id = verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    db = get_db()
    try:
        db.execute(
            "INSERT INTO locations (user_id, latitude, longitude, timestamp) VALUES (?, ?, ?, ?)",
            (user_id, data.latitude, data.longitude, data.timestamp)
        )
        db.commit()
        return {"status": "success"}
    
    except Exception as e:
        logging.error(f"Error saving location for user_id {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to save location")
    
    finally:
        db.close()

@app.get("/api/location")
async def get_location(token: str):
    user_id = verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    db = get_db()
    try:
        cursor = db.cursor()
        cursor.execute(
            "SELECT latitude, longitude, timestamp FROM locations WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1",
            (user_id,)
        )
        location = cursor.fetchone()
        if location:
            return {
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "timestamp": location["timestamp"]
            }
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Location not found")
    
    except Exception as e:
        logging.error(f"Error fetching location for user_id {user_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")
    
    finally:
        db.close()

# Anti-theft API
@app.post("/api/register-device-antitheft")
async def register_device_antitheft(device: DeviceRegistration, request: Request):
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    user_id = verify_token(token)
    
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    db = get_db()
    try:
        # Check if device exists by hardware ID
        cursor = db.cursor()
        cursor.execute(
            "SELECT id, user_id FROM antitheft_devices WHERE hardware_id = ?",
            (device.hardwareId,)
        )
        existing_device = cursor.fetchone()
        
        device_info_json = json.dumps(device.deviceInfo)
        
        if existing_device:
            # If device exists but belongs to a different user
            if str(existing_device["user_id"]) != device.userId:
                # This could be a stolen device - log this suspicious activity
                db.execute(
                    """
                    INSERT INTO stolen_device_locations 
                    (hardware_id, latitude, longitude, timestamp, connection_info)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        device.hardwareId, 
                        device.deviceInfo.get("lastKnownPosition", {}).get("latitude", 0),
                        device.deviceInfo.get("lastKnownPosition", {}).get("longitude", 0),
                        datetime.utcnow().isoformat(),
                        json.dumps({"ip": request.client.host, "ua": request.headers.get("User-Agent")})
                    )
                )
                
                # Check if it's been reported stolen
                cursor.execute(
                    "SELECT id FROM stolen_devices WHERE hardware_id = ?",
                    (device.hardwareId,)
                )
                is_reported_stolen = cursor.fetchone() is not None
                
                # Update last seen
                db.execute(
                    "UPDATE antitheft_devices SET last_seen = ? WHERE hardware_id = ?",
                    (datetime.utcnow().isoformat(), device.hardwareId)
                )
                
                db.commit()
                
                if is_reported_stolen:
                    # Return a special response that will activate theft recovery mode
                    return {
                        "status": "stolen_recovery_mode",
                        "message": "This device has been reported stolen. Location tracking has been activated."
                    }
                
                # Return normal response if not reported stolen
                return {"status": "success", "registered": False}
            
            # Update existing device for same user
            db.execute(
                """
                UPDATE antitheft_devices 
                SET last_seen = ?, device_info = ? 
                WHERE hardware_id = ?
                """,
                (datetime.utcnow().isoformat(), device_info_json, device.hardwareId)
            )
        else:
            # Register new device
            db.execute(
                """
                INSERT INTO antitheft_devices 
                (user_id, hardware_id, first_seen, last_seen, device_info)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    user_id, 
                    device.hardwareId, 
                    datetime.utcnow().isoformat(),
                    datetime.utcnow().isoformat(),
                    device_info_json
                )
            )
        
        db.commit()
        return {"status": "success", "registered": True}
    finally:
        db.close()

@app.get("/api/check-device-status")
async def check_device_status(hardwareId: str):
    db = get_db()
    try:
        cursor = db.cursor()
        
        # Check stolen devices first
        cursor.execute(
            "SELECT id FROM stolen_devices WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        if cursor.fetchone():
            return {"status": "stolen"}
        
        # Check if device exists
        cursor.execute(
            "SELECT user_id, is_stolen FROM antitheft_devices WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        device = cursor.fetchone()
        
        if not device:
            return {"status": "unknown"}
        
        if device["is_stolen"] == 1:
            return {"status": "stolen"}
        
        return {"status": "registered", "user_id": device["user_id"]}
    finally:
        db.close()

@app.post("/api/report-stolen")
async def report_stolen(hardwareId: str = Form(...), email: str = Form(...), phone: str = Form(None)):
    db = get_db()
    try:
        cursor = db.cursor()
        
        # Verify device exists
        cursor.execute(
            "SELECT user_id FROM antitheft_devices WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        device = cursor.fetchone()
        
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        
        # Mark as stolen
        db.execute(
            "UPDATE antitheft_devices SET is_stolen = 1 WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        # Check if already in stolen_devices
        cursor.execute(
            "SELECT id FROM stolen_devices WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        if cursor.fetchone() is None:
            # Add to stolen devices
            db.execute(
                """
                INSERT INTO stolen_devices 
                (hardware_id, user_id, reported_stolen_at, recovery_email, recovery_phone)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    hardwareId,
                    device["user_id"],
                    datetime.utcnow().isoformat(),
                    email,
                    phone
                )
            )
        
        db.commit()
        return {"status": "success", "message": "Device reported as stolen"}
    finally:
        db.close()

@app.get("/api/stolen-device-locations")
async def get_stolen_device_locations(hardwareId: str, token: str):
    user_id = verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    db = get_db()
    try:
        cursor = db.cursor()
        
        # Verify device belongs to user
        cursor.execute(
            "SELECT user_id FROM antitheft_devices WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        device = cursor.fetchone()
        
        if not device or device["user_id"] != user_id:
            raise HTTPException(status_code=403, detail="Not authorized to view this device")
        
        # Get locations
        cursor.execute(
            """
            SELECT latitude, longitude, timestamp 
            FROM stolen_device_locations
            WHERE hardware_id = ?
            ORDER BY timestamp DESC
            LIMIT 50
            """,
            (hardwareId,)
        )
        
        locations = []
        for row in cursor:
            locations.append({
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "timestamp": row["timestamp"]
            })
        
        return {"locations": locations}
    finally:
        db.close()

@app.post("/api/__system__/device-checkin")
async def device_checkin(request: Request):
    data = await request.json()
    
    hardwareId = data.get("h")
    lat = data.get("a")
    lng = data.get("o")
    
    if not (hardwareId and lat and lng):
        # Return success regardless to avoid alerting thief
        return {"s": 1}
    
    db = get_db()
    try:
        # Check if device is reported stolen
        cursor = db.cursor()
        cursor.execute(
            "SELECT id FROM stolen_devices WHERE hardware_id = ?",
            (hardwareId,)
        )
        
        if cursor.fetchone():
            # Record location
            db.execute(
                """
                INSERT INTO stolen_device_locations 
                (hardware_id, latitude, longitude, timestamp, connection_info)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    hardwareId,
                    lat,
                    lng,
                    datetime.utcnow().isoformat(),
                    json.dumps({"ip": request.client.host, "ua": request.headers.get("User-Agent")})
                )
            )
            db.commit()
    finally:
        db.close()
    
    # Always return success to avoid alerting thief
    return {"s": 1}

# Serve static files
app.mount("/", StaticFiles(directory="static", html=True), name="static")

# For development, run with: uvicorn app:app --host 0.0.0.0 --port 8000 --reload