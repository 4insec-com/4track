// Recovery Dashboard JavaScript
const API_URL = `${window.location.protocol}//${window.location.host}/api`;
console.log("Using API URL:", API_URL);

// Map variables
let map = null;
let markers = [];
let locationHistory = [];
let deviceInfo = null;
let selectedLocationIndex = 0;
let updateInterval = null;

// DOM elements
const statusPanel = document.getElementById('status-panel');
const deviceStatus = document.getElementById('device-status');
const lastUpdate = document.getElementById('last-update');
const statusMessage = document.getElementById('status-message');
const deviceName = document.getElementById('device-name');
const batteryLevel = document.getElementById('battery-level');
const batteryPercentage = document.getElementById('battery-percentage');
const locationHistoryEl = document.getElementById('location-history');
const deviceModel = document.getElementById('device-model');
const deviceId = document.getElementById('device-id');
const reportedDate = document.getElementById('reported-date');
const deviceOwner = document.getElementById('device-owner');
const photoContainer = document.getElementById('photo-container');

// Action buttons
const alarmButton = document.getElementById('btn-alarm');
const messageButton = document.getElementById('btn-message');
const photoButton = document.getElementById('btn-photo');
const wipeButton = document.getElementById('btn-wipe');
const backButton = document.getElementById('back-btn');

// Modals
const messageModal = document.getElementById('message-modal');
const wipeModal = document.getElementById('wipe-modal');
const messageInput = document.getElementById('message-input');
const wipePassword = document.getElementById('wipe-password');
const sendMessageBtn = document.getElementById('send-message-btn');
const confirmWipeBtn = document.getElementById('confirm-wipe-btn');
const closeButtons = document.querySelectorAll('.close');

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
    setupEventListeners();
});

// Initialize the dashboard
async function initDashboard() {
    // Check if we have device ID in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const hardwareId = urlParams.get('id');
    const token = localStorage.getItem('token');
    
    if (!hardwareId || !token) {
        // Redirect to login or show error
        showError('Invalid device ID or not logged in');
        return;
    }
    
    // Initialize map
    initMap();
    
    // Load device info
    await loadDeviceInfo(hardwareId, token);
    
    // Load location history
    await loadLocationHistory(hardwareId, token);
    
    // Set up periodic updates
    updateInterval = setInterval(() => {
        loadLocationHistory(hardwareId, token, true);
    }, 60000); // Update every minute
}

// Initialize the map
function initMap() {
    map = L.map('recovery-map').setView([0, 0], 2);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

// Load device information
async function loadDeviceInfo(hardwareId, token) {
    try {
        const response = await fetch(`${API_URL}/device-info?hardwareId=${hardwareId}&token=${token}`);
        
        if (!response.ok) {
            throw new Error('Failed to load device information');
        }
        
        deviceInfo = await response.json();
        updateDeviceInfo(deviceInfo);
    } catch (error) {
        console.error('Error loading device info:', error);
        showError('Failed to load device information');
    }
}

// Update device info UI
function updateDeviceInfo(info) {
    // Update device name and status
    deviceName.textContent = info.model || 'Unknown Device';
    deviceStatus.textContent = info.status.toUpperCase();
    statusPanel.className = `dashboard-status ${info.status.toLowerCase()}`;
    
    // Update last seen time
    const lastSeen = new Date(info.lastSeen);
    lastUpdate.textContent = lastSeen.toLocaleString();
    
    // Update battery info if available
    if (info.battery) {
        batteryLevel.style.width = `${info.battery.level}%`;
        batteryPercentage.textContent = `${info.battery.level}%`;
        
        if (info.battery.level < 20) {
            batteryLevel.parentElement.classList.add('low-battery');
        } else {
            batteryLevel.parentElement.classList.remove('low-battery');
        }
    }
    
    // Update device details
    deviceModel.textContent = info.model || 'Unknown';
    deviceId.textContent = info.hardwareId.substring(0, 10) + '...';
    reportedDate.textContent = new Date(info.reportedAt).toLocaleString();
    deviceOwner.textContent = info.ownerEmail || 'Unknown';
    
    // Update status message
    if (info.status === 'stolen') {
        statusMessage.textContent = 'Your device has been reported as stolen and is being tracked.';
    } else if (info.status === 'recovered') {
        statusMessage.textContent = 'Your device has been marked as recovered.';
    } else {
        statusMessage.textContent = 'Your device is currently being monitored.';
    }
    
    // Update photo if available
    if (info.lastPhoto) {
        photoContainer.innerHTML = `<img src="data:image/jpeg;base64,${info.lastPhoto}" alt="Last captured image">`;
    }
}

// Load location history
async function loadLocationHistory(hardwareId, token, updateOnly = false) {
    try {
        const response = await fetch(`${API_URL}/stolen-device-locations?hardwareId=${hardwareId}&token=${token}`);
        
        if (!response.ok) {
            throw new Error('Failed to load location history');
        }
        
        const data = await response.json();
        
        if (!updateOnly || locationHistory.length === 0) {
            // Full refresh
            locationHistory = data.locations;
            updateLocationHistory();
            
            // Select the most recent location
            if (locationHistory.length > 0) {
                selectLocation(0);
            }
        } else {
            // Check if we have new locations
            if (data.locations.length > 0 && 
                (locationHistory.length === 0 || 
                 data.locations[0].timestamp !== locationHistory[0].timestamp)) {
                
                // Update with new locations
                const newLocations = data.locations.filter(loc => {
                    return !locationHistory.some(existing => existing.timestamp === loc.timestamp);
                });
                
                if (newLocations.length > 0) {
                    locationHistory = [...newLocations, ...locationHistory];
                    updateLocationHistory();
                    
                    // Select the most recent location
                    selectLocation(0);
                    
                    // Show notification
                    showNotification('New location data available');
                }
            }
        }
    } catch (error) {
        console.error('Error loading location history:', error);
        if (!updateOnly) {
            showError('Failed to load location history');
        }
    }
}

// Update location history UI
function updateLocationHistory() {
    // Clear existing location items
    locationHistoryEl.innerHTML = '';
    
    // Add new location items
    if (locationHistory.length === 0) {
        locationHistoryEl.innerHTML = '<div class="location-item">No location history available</div>';
        return;
    }
    
    locationHistory.forEach((location, index) => {
        const locationDate = new Date(location.timestamp);
        const locationItem = document.createElement('div');
        locationItem.className = 'location-item';
        if (index === selectedLocationIndex) {
            locationItem.classList.add('selected');
        }
        
        locationItem.innerHTML = `
            <div>Location #${index + 1}</div>
            <div class="timestamp">${locationDate.toLocaleString()}</div>
        `;
        
        locationItem.addEventListener('click', () => {
            selectLocation(index);
        });
        
        locationHistoryEl.appendChild(locationItem);
    });
}

// Select a location and update the map
function selectLocation(index) {
    // Update selected index
    selectedLocationIndex = index;
    
    // Update location history UI
    const locationItems = locationHistoryEl.querySelectorAll('.location-item');
    locationItems.forEach((item, i) => {
        if (i === index) {
            item.classList.add('selected');
        } else {
            item.classList.remove('selected');
        }
    });
    
    // Update map
    updateMap(locationHistory[index]);
}

// Update map with location
function updateMap(locationData) {
    if (!locationData) return;
    
    const { latitude, longitude } = locationData;
    const position = [latitude, longitude];
    
    // Clear existing markers
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    
    // Create a new marker
    const marker = L.marker(position).addTo(map);
    marker.bindPopup(`
        <strong>Location</strong><br>
        Latitude: ${latitude}<br>
        Longitude: ${longitude}<br>
        Time: ${new Date(locationData.timestamp).toLocaleString()}
    `);
    markers.push(marker);
    
    // Add a circle to show accuracy if available
    if (locationData.accuracy) {
        const circle = L.circle(position, {
            radius: locationData.accuracy,
            color: '#4B4275',
            fillColor: '#4B4275',
            fillOpacity: 0.2
        }).addTo(map);
        markers.push(circle);
    }
    
    // Update map view
    map.setView(position, 15);
}

// Set up event listeners
function setupEventListeners() {
    // Action buttons
    if (alarmButton) {
        alarmButton.addEventListener('click', triggerAlarm);
    }
    
    if (messageButton) {
        messageButton.addEventListener('click', () => {
            messageModal.style.display = 'block';
        });
    }
    
    if (photoButton) {
        photoButton.addEventListener('click', requestPhoto);
    }
    
    if (wipeButton) {
        wipeButton.addEventListener('click', () => {
            wipeModal.style.display = 'block';
        });
    }
    
    if (backButton) {
        backButton.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    
    // Modal buttons
    if (sendMessageBtn) {
        sendMessageBtn.addEventListener('click', sendMessage);
    }
    
    if (confirmWipeBtn) {
        confirmWipeBtn.addEventListener('click', confirmWipe);
    }
    
    // Close buttons
    closeButtons.forEach(button => {
        button.addEventListener('click', () => {
            messageModal.style.display = 'none';
            wipeModal.style.display = 'none';
        });
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', event => {
        if (event.target === messageModal) {
            messageModal.style.display = 'none';
        }
        if (event.target === wipeModal) {
            wipeModal.style.display = 'none';
        }
    });
}

// Trigger alarm on device
async function triggerAlarm() {
    if (!deviceInfo) return;
    
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch(`${API_URL}/remote-action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                hardwareId: deviceInfo.hardwareId,
                action: 'alarm',
                duration: 30 // 30 seconds
            })
        });
        
        if (response.ok) {
            showNotification('Alarm triggered on device');
        } else {
            throw new Error('Failed to trigger alarm');
        }
    } catch (error) {
        console.error('Error triggering alarm:', error);
        showError('Failed to trigger alarm on device');
    }
}

// Send message to device
async function sendMessage() {
    if (!deviceInfo) return;
    
    const message = messageInput.value.trim();
    if (!message) {
        showError('Please enter a message to send');
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch(`${API_URL}/remote-action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                hardwareId: deviceInfo.hardwareId,
                action: 'message',
                message: message
            })
        });
        
        if (response.ok) {
            showNotification('Message sent to device');
            messageModal.style.display = 'none';
            messageInput.value = '';
        } else {
            throw new Error('Failed to send message');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showError('Failed to send message to device');
    }
}

// Request photo from device
async function requestPhoto() {
    if (!deviceInfo) return;
    
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch(`${API_URL}/remote-action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                hardwareId: deviceInfo.hardwareId,
                action: 'photo'
            })
        });
        
        if (response.ok) {
            showNotification('Photo request sent to device');
            
            // Poll for photo update
            let attempts = 0;
            const maxAttempts = 20;
            const checkInterval = setInterval(async () => {
                attempts++;
                
                // Stop after max attempts
                if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    showError('No photo received from device');
                    return;
                }
                
                // Check for new photo
                await loadDeviceInfo(deviceInfo.hardwareId, token);
                
                // If photo available, stop polling
                if (deviceInfo.lastPhoto) {
                    clearInterval(checkInterval);
                    showNotification('New photo received from device');
                }
            }, 3000); // Check every 3 seconds
        } else {
            throw new Error('Failed to request photo');
        }
    } catch (error) {
        console.error('Error requesting photo:', error);
        showError('Failed to request photo from device');
    }
}

// Confirm and execute wipe
async function confirmWipe() {
    if (!deviceInfo) return;
    
    const password = wipePassword.value.trim();
    if (!password) {
        showError('Please enter your password to confirm wipe');
        return;
    }
    
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        
        const response = await fetch(`${API_URL}/remote-action`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                hardwareId: deviceInfo.hardwareId,
                action: 'wipe',
                password: password
            })
        });
        
        if (response.ok) {
            showNotification('Wipe command sent to device');
            wipeModal.style.display = 'none';
            wipePassword.value = '';
        } else {
            throw new Error('Failed to send wipe command');
        }
    } catch (error) {
        console.error('Error sending wipe command:', error);
        showError('Failed to send wipe command to device');
    }
}

// Show error message
function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-message';
    errorDiv.textContent = message;
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '20px';
    errorDiv.style.left = '50%';
    errorDiv.style.transform = 'translateX(-50%)';
    errorDiv.style.backgroundColor = '#f44336';
    errorDiv.style.color = 'white';
    errorDiv.style.padding = '10px 20px';
    errorDiv.style.borderRadius = '5px';
    errorDiv.style.zIndex = '9999';
    errorDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        errorDiv.style.opacity = '0';
        errorDiv.style.transition = 'opacity 0.5s';
        setTimeout(() => {
            document.body.removeChild(errorDiv);
        }, 500);
    }, 3000);
}

// Show notification
function showNotification(message) {
    const notificationDiv = document.createElement('div');
    notificationDiv.className = 'notification-message';
    notificationDiv.textContent = message;
    notificationDiv.style.position = 'fixed';
    notificationDiv.style.top = '20px';
    notificationDiv.style.left = '50%';
    notificationDiv.style.transform = 'translateX(-50%)';
    notificationDiv.style.backgroundColor = '#4caf50';
    notificationDiv.style.color = 'white';
    notificationDiv.style.padding = '10px 20px';
    notificationDiv.style.borderRadius = '5px';
    notificationDiv.style.zIndex = '9999';
    notificationDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    
    document.body.appendChild(notificationDiv);
    
    setTimeout(() => {
        notificationDiv.style.opacity = '0';
        notificationDiv.style.transition = 'opacity 0.5s';
        setTimeout(() => {
            document.body.removeChild(notificationDiv);
        }, 500);
    }, 3000);
}

// Clean up when leaving page
window.addEventListener('beforeunload', () => {
    if (updateInterval) {
        clearInterval(updateInterval);
    }
});