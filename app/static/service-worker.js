// Cache names
const CACHE_NAME = 'ghosttrack-v1';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://unpkg.com/leaflet@1.9.3/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.3/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching app shell and static content');
        return cache.addAll(STATIC_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(cacheName => {
          return cacheName !== CACHE_NAME;
        }).map(cacheName => {
          return caches.delete(cacheName);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache if available
self.addEventListener('fetch', event => {
  // Skip for API calls - don't cache API responses
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request).then(fetchResponse => {
        // Don't cache non-success responses
        if (!fetchResponse || fetchResponse.status !== 200 || fetchResponse.type !== 'basic') {
          return fetchResponse;
        }
        
        // Cache successful responses for static assets
        let responseToCache = fetchResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        
        return fetchResponse;
      });
    }).catch(() => {
      // Fallback for offline usage
      if (event.request.url.endsWith('.html')) {
        return caches.match('/index.html');
      }
    })
  );
});

// Background sync for location updates
self.addEventListener('sync', event => {
  if (event.tag === 'location-sync') {
    event.waitUntil(sendPendingLocations());
  }
});

// Function to send pending locations
async function sendPendingLocations() {
  const API_URL = '/api';
  const token = await getTokenFromStorage();
  
  if (!token) return;
  
  // Try to get current position
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async position => {
        const locationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: new Date().toISOString()
        };
        
        // Send to server
        try {
          await fetch(`${API_URL}/location?token=${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(locationData)
          });
        } catch (error) {
          console.error('Background sync failed:', error);
        }
      },
      error => console.error('Error getting position:', error)
    );
  }
}

// Helper function to get token from storage
async function getTokenFromStorage() {
  try {
    const clients = await self.clients.matchAll();
    if (clients.length === 0) return null;
    
    // Message a client to get the token from localStorage
    const client = clients[0];
    
    return new Promise((resolve) => {
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = event => {
        resolve(event.data);
      };
      
      client.postMessage({ type: 'GET_TOKEN' }, [messageChannel.port2]);
    });
  } catch (error) {
    console.error('Error getting token:', error);
    return null;
  }
}