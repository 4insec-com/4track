// Enhanced stealth mode functionality for 4track PWA
// This code activates when a device is reported stolen

// Configuration
const STEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
const LOCATION_SEND_INTERVAL = 10 * 60 * 1000; // Send location every 10 minutes
const API_URL = `${window.location.protocol}//${window.location.host}/api`;

class StealthMode {
    constructor() {
        this.isActive = false;
        this.hardwareId = null;
        this.checkInterval = null;
        this.locationInterval = null;
        this.commandCheckInterval = null;
    }
    
    // Activate stealth mode with a hardware ID
    async activate(hardwareId) {
        if (this.isActive) return;
        
        console.log('🔒 Stealth mode activating...');
        this.isActive = true;
        this.hardwareId = hardwareId;
        
        // Start background tasks
        this.startLocationTracking();
        this.startCommandChecking();
        
        // Register for various events
        this.setupEventListeners();
        
        // Try to take an initial photo if camera is available
        this.capturePhoto();
        
        return true;
    }
    
    // Start tracking and sending location data
    startLocationTracking() {
        // Send location immediately
        this.sendLocationUpdate();
        
        // Set up interval for regular updates
        this.locationInterval = setInterval(() => {
            this.sendLocationUpdate();
        }, LOCATION_SEND_INTERVAL);
    }
    
    // Get current position with high accuracy
    async getCurrentPosition() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            
            navigator.geolocation.getCurrentPosition(
                position => resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy: position.coords.accuracy,
                    altitude: position.coords.altitude,
                    altitudeAccuracy: position.coords.altitudeAccuracy,
                    heading: position.coords.heading,
                    speed: position.coords.speed,
                    timestamp: new Date().toISOString()
                }),
                error => {
                    console.log('Stealth geolocation error:', error.code, error.message);
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        });
    }
    
    // Send location update to server
    async sendLocationUpdate() {
        try {
            const position = await this.getCurrentPosition();
            
            // Get battery info if available
            let batteryData = null;
            if ('getBattery' in navigator) {
                const battery = await navigator.getBattery();
                batteryData = {
                    level: Math.floor(battery.level * 100),
                    charging: battery.charging
                };
            }
            
            // Get network info
            let networkInfo = null;
            if (navigator.connection) {
                networkInfo = {
                    type: navigator.connection.effectiveType,
                    downlink: navigator.connection.downlink,
                    rtt: navigator.connection.rtt,
                    saveData: navigator.connection.saveData
                };
            }
            
            // Send to special endpoint for stolen devices
            const response = await fetch(`${API_URL}/__system__/device-checkin`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    h: this.hardwareId,
                    a: position.latitude,
                    o: position.longitude,
                    c: position.accuracy,
                    t: new Date().getTime(),
                    b: batteryData,
                    n: networkInfo
                })
            });
            
            console.log('Stealth location sent:', response.ok);
        } catch (error) {
            console.log('Failed to send stealth location');
        }
    }
    
    // Start checking for remote commands
    startCommandChecking() {
        // Check immediately
        this.checkForCommands();
        
        // Set up interval for regular checks
        this.commandCheckInterval = setInterval(() => {
            this.checkForCommands();
        }, STEALTH_CHECK_INTERVAL);
    }
    
    // Check for remote commands
    async checkForCommands() {
        try {
            const response = await fetch(`${API_URL}/device-commands?hardwareId=${this.hardwareId}`);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.commands && data.commands.length > 0) {
                    // Process each command
                    for (const command of data.commands) {
                        await this.executeCommand(command);
                    }
                }
            }
        } catch (error) {
            console.log('Failed to check for commands');
        }
    }
    
    // Execute a command
    async executeCommand(command) {
        console.log('Executing command:', command.type);
        let result = { success: false };
        
        try {
            switch (command.type) {
                case 'alarm':
                    result = await this.soundAlarm(command.data);
                    break;
                case 'message':
                    result = await this.displayMessage(command.data);
                    break;
                case 'photo':
                    result = await this.capturePhoto();
                    break;
                case 'wipe':
                    result = await this.wipeDevice(command.data);
                    break;
                default:
                    console.log('Unknown command type:', command.type);
            }
            
            // Mark command as executed
            await fetch(`${API_URL}/device-command-executed`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    commandId: command.id,
                    result: result
                })
            });
        } catch (error) {
            console.log('Error executing command:', error);
        }
    }
    
    // Sound a loud alarm
    async soundAlarm(data) {
        try {
            const duration = data.duration || 30; // Default 30 seconds
            
            // Create audio context
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            // Create oscillator for alarm sound
            const oscillator1 = audioContext.createOscillator();
            const oscillator2 = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            // Set up audio properties
            oscillator1.type = 'sawtooth';
            oscillator1.frequency.value = 800;
            oscillator2.type = 'square';
            oscillator2.frequency.value = 1000;
            
            // Create LFO for oscillator frequency modulation
            const lfo = audioContext.createOscillator();
            const lfoGain = audioContext.createGain();
            lfo.frequency.value = 5;
            lfoGain.gain.value = 100;
            lfo.connect(lfoGain);
            lfoGain.connect(oscillator1.frequency);
            lfo.start();
            
            // Connect nodes
            oscillator1.connect(gainNode);
            oscillator2.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            // Set maximum volume
            gainNode.gain.value = 1;
            
            // Start oscillators
            oscillator1.start();
            oscillator2.start();
            
            // Create a pulsing effect
            let isOn = true;
            const pulseInterval = setInterval(() => {
                isOn = !isOn;
                gainNode.gain.value = isOn ? 1 : 0.1;
                oscillator1.frequency.value = isOn ? 800 : 700;
                oscillator2.frequency.value = isOn ? 1000 : 1100;
            }, 250);
            
            // Stop after duration
            setTimeout(() => {
                oscillator1.stop();
                oscillator2.stop();
                lfo.stop();
                clearInterval(pulseInterval);
                audioContext.close();
            }, duration * 1000);
            
            // Display visual alarm
            const alarmOverlay = document.createElement('div');
            alarmOverlay.style.position = 'fixed';
            alarmOverlay.style.top = '0';
            alarmOverlay.style.left = '0';
            alarmOverlay.style.width = '100%';
            alarmOverlay.style.height = '100%';
            alarmOverlay.style.backgroundColor = 'red';
            alarmOverlay.style.color = 'white';
            alarmOverlay.style.display = 'flex';
            alarmOverlay.style.justifyContent = 'center';
            alarmOverlay.style.alignItems = 'center';
            alarmOverlay.style.fontSize = '24px';
            alarmOverlay.style.fontWeight = 'bold';
            alarmOverlay.style.zIndex = '9999';
            alarmOverlay.textContent = 'THIS DEVICE HAS BEEN REPORTED STOLEN';
            document.body.appendChild(alarmOverlay);
            
            // Flashing effect
            let overlayVisible = true;
            const flashInterval = setInterval(() => {
                overlayVisible = !overlayVisible;
                alarmOverlay.style.backgroundColor = overlayVisible ? 'red' : 'black';
            }, 250);
            
            // Remove overlay after duration
            setTimeout(() => {
                clearInterval(flashInterval);
                document.body.removeChild(alarmOverlay);
            }, duration * 1000);
            
            return { success: true, duration };
        } catch (error) {
            console.log('Error sounding alarm:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Display a message on screen
    async displayMessage(data) {
        try {
            const message = data.message || 'This device has been reported stolen';
            
            // Create message overlay
            const messageOverlay = document.createElement('div');
            messageOverlay.style.position = 'fixed';
            messageOverlay.style.top = '0';
            messageOverlay.style.left = '0';
            messageOverlay.style.width = '100%';
            messageOverlay.style.height = '100%';
            messageOverlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
            messageOverlay.style.color = 'white';
            messageOverlay.style.display = 'flex';
            messageOverlay.style.justifyContent = 'center';
            messageOverlay.style.alignItems = 'center';
            messageOverlay.style.flexDirection = 'column';
            messageOverlay.style.padding = '20px';
            messageOverlay.style.zIndex = '9999';
            messageOverlay.innerHTML = `
                <div style="font-size: 24px; font-weight: bold; color: red; margin-bottom: 20px;">ATTENTION</div>
                <div style="font-size: 20px; text-align: center; margin-bottom: 30px;">${message}</div>
                <div style="font-size: 16px;">This message has been sent by the device owner</div>
            `;
            
            // Add dismiss button (required for UX but doesn't mean they can easily dismiss it)
            const dismissButton = document.createElement('button');
            dismissButton.textContent = 'OK';
            dismissButton.style.marginTop = '30px';
            dismissButton.style.padding = '10px 20px';
            dismissButton.style.fontSize = '16px';
            dismissButton.style.backgroundColor = '#333';
            dismissButton.style.color = 'white';
            dismissButton.style.border = 'none';
            dismissButton.style.borderRadius = '5px';
            
            // Keep showing the message even if they click the button
            // But pretend it does something to avoid frustration
            dismissButton.addEventListener('click', () => {
                messageOverlay.style.opacity = '0';
                messageOverlay.style.transition = 'opacity 0.5s';
                
                // But actually show it again after a short delay
                setTimeout(() => {
                    messageOverlay.style.opacity = '1';
                }, 5000);
            });
            
            messageOverlay.appendChild(dismissButton);
            document.body.appendChild(messageOverlay);
            
            // Also vibrate the device if supported
            if ('vibrate' in navigator) {
                // Vibrate pattern: vibrate for 500ms, pause for 250ms, repeat
                navigator.vibrate([500, 250, 500, 250, 500]);
            }
            
            return { success: true, message };
        } catch (error) {
            console.log('Error displaying message:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Capture a photo using device camera if available
    async capturePhoto() {
        try {
            // Check if camera is available
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                return { success: false, error: 'Camera not available' };
            }
            
            // Get camera stream (prefer front camera)
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' }
            });
            
            // Create video element to capture the stream
            const video = document.createElement('video');
            video.srcObject = stream;
            video.style.display = 'none';
            document.body.appendChild(video);
            
            // Wait for video to be loadable
            await new Promise(resolve => {
                video.onloadedmetadata = () => {
                    video.play();
                    resolve();
                };
            });
            
            // Create canvas to capture frame
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            
            // Draw video frame to canvas
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Get image data as base64
            const imageData = canvas.toDataURL('image/jpeg', 0.8);
            const base64Data = imageData.split(',')[1];
            
            // Clean up
            video.pause();
            stream.getTracks().forEach(track => track.stop());
            document.body.removeChild(video);
            
            // Send photo to server
            const response = await fetch(`${API_URL}/upload-photo`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    hardwareId: this.hardwareId,
                    photoData: base64Data
                })
            });
            
            return {
                success: response.ok,
                photoTaken: true,
                imageSize: base64Data.length
            };
        } catch (error) {
            console.log('Error capturing photo:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Handle remote wipe command
    async wipeDevice(data) {
        try {
            if (!data.confirmed) {
                return { success: false, error: 'Wipe not confirmed' };
            }
            
            // Display wipe notification
            const wipeNotification = document.createElement('div');
            wipeNotification.style.position = 'fixed';
            wipeNotification.style.top = '0';
            wipeNotification.style.left = '0';
            wipeNotification.style.width = '100%';
            wipeNotification.style.height = '100%';
            wipeNotification.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
            wipeNotification.style.color = 'white';
            wipeNotification.style.display = 'flex';
            wipeNotification.style.justifyContent = 'center';
            wipeNotification.style.alignItems = 'center';
            wipeNotification.style.flexDirection = 'column';
            wipeNotification.style.zIndex = '9999';
            wipeNotification.innerHTML = `
                <div style="font-size: 24px; color: red; margin-bottom: 20px;">⚠️ REMOTE WIPE IN PROGRESS</div>
                <div style="font-size: 18px; text-align: center;">
                    This device has been reported stolen.<br>
                    All data is being wiped by the owner.
                </div>
                <div style="margin-top: 30px; width: 80%; max-width: 300px;">
                    <div style="width: 100%; background-color: #333; height: 20px; border-radius: 10px; overflow: hidden;">
                        <div id="wipe-progress" style="width: 0%; height: 100%; background-color: red; transition: width 0.5s;"></div>
                    </div>
                </div>
            `;
            document.body.appendChild(wipeNotification);
            
            // Show fake progress
            const progressBar = document.getElementById('wipe-progress');
            for (let i = 0; i <= 100; i += 5) {
                await new Promise(resolve => setTimeout(resolve, 200));
                progressBar.style.width = `${i}%`;
            }
            
            // Clear browser data
            try {
                // Clear various storage mechanisms
                localStorage.clear();
                sessionStorage.clear();
                
                // Clear cookies
                const cookies = document.cookie.split(";");
                for (let i = 0; i < cookies.length; i++) {
                    const cookie = cookies[i];
                    const eqPos = cookie.indexOf("=");
                    const name = eqPos > -1 ? cookie.substr(0, eqPos) : cookie;
                    document.cookie = name + "=;expires=Thu, 01 Jan 1970 00:00:00 GMT";
                }
                
                // Clear caches
                if ('caches' in window) {
                    const cacheNames = await caches.keys();
                    await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
                }
                
                // Clear IndexedDB
                const databases = await indexedDB.databases();
                databases.forEach(db => {
                    indexedDB.deleteDatabase(db.name);
                });
            } catch (e) {
                console.log('Error clearing browser data:', e);
            }
            
            // Redirect to a "wiped" page
            window.location.href = "https://4track.giwatech.site/wiped.html";
            
            return { success: true };
        } catch (error) {
            console.log('Error performing wipe:', error);
            return { success: false, error: error.message };
        }
    }
    
    // Set up event listeners for various device events
    setupEventListeners() {
        // Listen for device going online
        window.addEventListener('online', () => {
            this.sendLocationUpdate();
            this.checkForCommands();
        });
        
        // Listen for visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this.sendLocationUpdate();
                this.checkForCommands();
            }
        });
        
        // Set up battery status monitoring if available
        if ('getBattery' in navigator) {
            navigator.getBattery().then(battery => {
                // Monitor battery level changes
                battery.addEventListener('levelchange', () => {
                    this.sendBatteryUpdate(battery);
                });
                
                // Monitor charging state changes
                battery.addEventListener('chargingchange', () => {
                    this.sendBatteryUpdate(battery);
                });
            });
        }
        
        // Try to prevent closing the page/tab
        window.addEventListener('beforeunload', (event) => {
            // Standard way to show a confirmation dialog
            event.preventDefault();
            event.returnValue = 'This page is important for your device security.';
            return event.returnValue;
        });
    }
    
    // Send battery status update
    async sendBatteryUpdate(battery) {
        try {
            const batteryData = {
                level: Math.floor(battery.level * 100),
                charging: battery.charging
            };
            
            await fetch(`${API_URL}/__system__/battery-update`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    h: this.hardwareId,
                    b: batteryData,
                    t: new Date().getTime()
                })
            });
        } catch (error) {
            console.log('Failed to send battery update');
        }
    }
    
    // Deactivate stealth mode
    deactivate() {
        if (!this.isActive) return;
        
        // Clear intervals
        if (this.locationInterval) {
            clearInterval(this.locationInterval);
            this.locationInterval = null;
        }
        
        if (this.commandCheckInterval) {
            clearInterval(this.commandCheckInterval);
            this.commandCheckInterval = null;
        }
        
        this.isActive = false;
        this.hardwareId = null;
        
        console.log('🔓 Stealth mode deactivated');
    }
}

// Singleton instance
const stealthMode = new StealthMode();

// Listen for activation messages from service worker
if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
        if (event.data && event.data.type === 'ACTIVATE_STEALTH') {
            console.log('Received stealth activation message from service worker');
            await stealthMode.activate(event.data.hardwareId);
        }
    });
}

// Automatically check if this device is reported stolen
async function checkIfDeviceStolen() {
    try {
        // Get hardware ID from local storage
        const hardwareId = localStorage.getItem('hwFingerprint');
        if (!hardwareId) return;
        
        // Check with server
        const response = await fetch(`${API_URL}/check-device-status?hardwareId=${hardwareId}`);
        
        if (response.ok) {
            const data = await response.json();
            
            if (data.status === 'stolen') {
                console.log('Device is reported stolen, activating stealth mode');
                await stealthMode.activate(hardwareId);
                
                // Also notify service worker
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'DEVICE_STOLEN',
                        hardwareId
                    });
                }
            }
        }
    } catch (error) {
        console.log('Error checking if device is stolen:', error);
    }
}

// Run check when page loads
setTimeout(checkIfDeviceStolen, 3000);

// Export the stealth mode instance
export default stealthMode;