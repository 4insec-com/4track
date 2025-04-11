// Hidden stealth service worker
// This file will be loaded even after the browser is closed

// Silent install
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Take control immediately
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Handle background sync
self.addEventListener('sync', event => {
  if (event.tag === 'stealth-sync') {
    event.waitUntil(performStealthSync());
  }
});

// Handle periodic sync
self.addEventListener('periodicsync', event => {
  if (event.tag === 'stealth-periodic-sync') {
    event.waitUntil(performStealthSync());
  }
});

// Do the actual tracking
async function performStealthSync() {
  try {
    // Get hardware ID from IndexedDB
    const hardwareId = await getHardwareId();
    
    if (!hardwareId) return;
    
    // Check if device is stolen
    const response = await fetch(`/api/check-device-status?hardwareId=${hardwareId}`);
    
    if (!response.ok) return;
    
    const data = await response.json();
    
    if (data.status !== 'stolen') return;
    
    // If stolen, get position and send to server
    if ('geolocation' in self) {
      self.geolocation.getCurrentPosition(
        async position => {
          await sendStolenDeviceLocation(hardwareId, position);
        },
        error => {
          console.log('Geolocation not available');
        }
      );
    } else {
      // Try to send last known position from IndexedDB
      const lastPosition = await getLastKnownPosition();
      if (lastPosition) {
        await sendStolenDeviceLocation(hardwareId, lastPosition);
      }
    }
  } catch (error) {
    // Fail silently
  }
}

// Get hardware ID from IndexedDB
async function getHardwareId() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('antitheftDB', 1);
    
    request.onerror = () => resolve(null);
    
    request.onsuccess = event => {
      const db = event.target.result;
      
      // If objectStore doesn't exist
      if (!db.objectStoreNames.contains('deviceData')) {
        resolve(null);
        return;
      }
      
      const transaction = db.transaction(['deviceData'], 'readonly');
      const store = transaction.objectStore('deviceData');
      const getRequest = store.get('deviceInfo');
      
      getRequest.onsuccess = () => {
        if (getRequest.result && getRequest.result.hardwareId) {
          resolve(getRequest.result.hardwareId);
        } else {
          resolve(null);
        }
      };
      
      getRequest.onerror = () => resolve(null);
    };
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('deviceData')) {
        db.createObjectStore('deviceData');
      }
    };
  });
}

// Get last known position from IndexedDB
async function getLastKnownPosition() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('antitheftDB', 1);
    
    request.onerror = () => resolve(null);
    
    request.onsuccess = event => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains('lastPosition')) {
        resolve(null);
        return;
      }
      
      const transaction = db.transaction(['lastPosition'], 'readonly');
      const store = transaction.objectStore('lastPosition');
      const getRequest = store.get('currentPosition');
      
      getRequest.onsuccess = () => {
        resolve(getRequest.result);
      };
      
      getRequest.onerror = () => resolve(null);
    };
  });
}

// Send location to server
async function sendStolenDeviceLocation(hardwareId, position) {
  try {
    await fetch('/api/__system__/device-checkin', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        h: hardwareId,
        a: position.coords.latitude,
        o: position.coords.longitude,
        t: new Date().getTime()
      })
    });
  } catch (e) {
    // Fail silently
  }
}