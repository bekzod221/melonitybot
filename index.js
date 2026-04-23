const { Telegraf } = require('telegraf');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const express = require('express');

// Configuration
const BOT_TOKEN = process.env.BOT_TOKEN || '8185097888:AAHArOl0JrInezQXXpE_EWz9WmN3qzMrErU';
const API_ENDPOINT = process.env.API_ENDPOINT || 'https://ske1.onrender.com/create';
const USERS_DB_PATH = path.join(__dirname, 'users.json');
const OWNER_ID = process.env.OWNER_ID || '7494072378'; // Set in Render env variables
const PORT = process.env.PORT || 3000;

// Initialize express app for health checks
const app = express();

// Initialize bot
const bot = new Telegraf(BOT_TOKEN);

// Load or create users database
let usersDatabase = {};

async function loadUsersDatabase() {
    try {
        const data = await fs.readFile(USERS_DB_PATH, 'utf-8');
        usersDatabase = JSON.parse(data);
        console.log(`📚 Loaded ${Object.keys(usersDatabase).length} users from database`);
    } catch (error) {
        usersDatabase = {};
        await saveUsersDatabase();
        console.log('📚 Created new users database');
    }
}

async function saveUsersDatabase() {
    try {
        await fs.writeFile(USERS_DB_PATH, JSON.stringify(usersDatabase, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error saving users database:', error);
    }
}

async function hasUserReceivedKey(userId) {
    return usersDatabase[userId] ? true : false;
}

async function recordUserKey(userId, userInfo, keyData) {
    usersDatabase[userId] = {
        userId: userId,
        username: userInfo.username || null,
        firstName: userInfo.first_name,
        lastName: userInfo.last_name || null,
        key: keyData.key,
        keyId: keyData.id,
        expiresAt: keyData.expiresAt,
        generatedAt: new Date().toISOString(),
        chatId: userInfo.chatId || null,
        chatType: userInfo.chatType || null,
        messageId: userInfo.messageId || null
    };
    await saveUsersDatabase();
}

async function getUserKey(userId) {
    return usersDatabase[userId] || null;
}

// Express routes for health checks and monitoring
app.get('/', (req, res) => {
    res.json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        users: Object.keys(usersDatabase).length,
        bot: 'running'
    });
});

app.get('/ping', (req, res) => {
    res.json({
        status: 'pong',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        users: Object.keys(usersDatabase).length
    });
});

app.get('/stats', async (req, res) => {
    // Optional: Add authentication via query param?key=your_secret
    const authKey = req.query.key;
    if (authKey && authKey === process.env.ADMIN_KEY) {
        const totalUsers = Object.keys(usersDatabase).length;
        const activeKeys = Object.values(usersDatabase).filter(user => {
            const expiryDate = new Date(user.expiresAt);
            return expiryDate > new Date();
        }).length;
        
        res.json({
            totalUsers,
            activeKeys,
            expiredKeys: totalUsers - activeKeys,
            keysFromChannels: Object.values(usersDatabase).filter(user => user.chatType === 'channel').length,
            keysFromGroups: Object.values(usersDatabase).filter(user => user.chatType === 'group' || user.chatType === 'supergroup').length,
            last24Hours: Object.values(usersDatabase).filter(user => {
                const generated = new Date(user.generatedAt);
                const dayAgo = new Date();
                dayAgo.setDate(dayAgo.getDate() - 1);
                return generated > dayAgo;
            }).length
        });
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// Start express server
app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`✅ Health check available at: http://localhost:${PORT}/ping`);
});

// Middleware to log all messages
bot.use((ctx, next) => {
    const messageType = ctx.chat?.type || 'unknown';
    const location = messageType === 'channel' ? 'Channel Comment' : (messageType === 'group' || messageType === 'supergroup' ? 'Group' : 'Private');
    console.log(`[${new Date().toISOString()}] ${location} - ${ctx.from?.first_name} (${ctx.from?.id}): "${ctx.message?.text}"`);
    return next();
});

// Main command handler for /start
bot.command('start', (ctx) => {
    ctx.reply(
        '🤖 *Key Generator Bot Activated!*\n\n' +
        'Type *"free key"* in any of these places to generate a free trial key:\n' +
        '• 📝 Channel comments (reply to any channel post)\n' +
        '• 👥 Group chats\n' +
        '• 💬 Supergroups\n\n' +
        '⚠️ *Note:* \n' +
        '• Each Telegram account can only generate ONE free trial key.\n' +
        '• Username changes will NOT allow you to generate another key.\n' +
        '• The bot will reply directly to your comment!',
        { parse_mode: 'Markdown' }
    );
});

// Command to check your key status
bot.command('mykey', async (ctx) => {
    try {
        const userId = ctx.from.id;
        const userKey = await getUserKey(userId);
        
        if (userKey) {
            await ctx.replyWithMarkdown(
                '🔑 *Your Key Information*\n\n' +
                `🔑 *Key:* \`${userKey.key}\`\n` +
                `📅 *Expires At:* ${userKey.expiresAt}\n` +
                `📅 *Generated On:* ${new Date(userKey.generatedAt).toLocaleString()}\n\n` +
                '💡 *Need a permanent key?*\n' +
                '🔗 https://melonity-ios.vercel.app/#prices'
            );
        } else {
            await ctx.replyWithMarkdown(
                '❌ *No key found*\n\n' +
                'You haven\'t generated a free trial key yet.\n' +
                'Type *"free key"* in any group chat or channel comment to get one!'
            );
        }
    } catch (error) {
        console.error('Error checking user key:', error);
        await ctx.reply('⚠️ An error occurred while checking your key. Please try again later.');
    }
});

// Function to properly reply to a message
async function replyToMessage(ctx, message, parseMode = 'Markdown') {
    try {
        const chatId = ctx.chat.id;
        const messageId = ctx.message.message_id;
        
        await bot.telegram.sendMessage(chatId, message, {
            reply_to_message_id: messageId,
            parse_mode: parseMode
        });
        
        console.log(`✅ Replied to message ${messageId} in chat ${chatId}`);
    } catch (error) {
        console.error('Error replying to message:', error);
        try {
            await ctx.reply(message, { parse_mode: parseMode });
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
    }
}

// Handle "free key" command from ANYWHERE
bot.hears(/free key/i, async (ctx) => {
    try {
        const userId = ctx.from.id;
        const chatType = ctx.chat?.type;
        const messageId = ctx.message?.message_id;
        
        let location = '';
        if (chatType === 'channel') {
            location = 'Channel Comment';
        } else if (chatType === 'group' || chatType === 'supergroup') {
            location = 'Group Chat';
        } else {
            location = 'Private Chat';
        }
        
        console.log(`📍 Processing "free key" from ${location} (User: ${userId}, Message ID: ${messageId})`);
        
        const hasKey = await hasUserReceivedKey(userId);
        
        if (hasKey) {
            const userKey = await getUserKey(userId);
            const message = 
                '⚠️ *You have already received a free trial key!*\n\n' +
                `🔑 Your key: \`${userKey.key}\`\n` +
                `📅 Expires: ${userKey.expiresAt}\n\n` +
                '💡 *Check your key anytime with:* `/mykey`\n\n' +
                '🛡️ *Abuse Prevention:* Each Telegram account can only get ONE free trial key.\n\n' +
                '💳 *Purchase permanent keys:*\n' +
                '🔗 https://melonity-ios.vercel.app/#prices';
            
            await replyToMessage(ctx, message);
            return;
        }
        
        const user = ctx.from;
        const uniqueUserId = user.id;
        const userIdentifier = `user_${uniqueUserId}`;
        const keyName = `MelnoityTrial-${userIdentifier}`;
        
        console.log(`🔑 Generating key: ${keyName}`);
        
        const response = await axios.post(API_ENDPOINT, {
            key: keyName,
            duration: '1d'
        }, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        
        if (response.data.status === 'success') {
            const keyData = response.data;
            
            await recordUserKey(userId, {
                username: user.username,
                first_name: user.first_name,
                last_name: user.last_name,
                chatId: ctx.chat?.id || null,
                chatType: chatType,
                messageId: messageId
            }, keyData);
            
            const message = 
                '✅ *Key Created Successfully!*\n\n' +
                `🔑 *Key:* \`${keyData.key}\`\n` +
                `🖥️ *HWID:* \`clear\` (not set)\n` +
                `⏰ *Duration:* 1 Day\n` +
                `📅 *Expires At:* ${keyData.expiresAt}\n\n` +
                '━━━━━━━━━━━━━━━━━━━\n\n' +
                '⚠️ *Important:*\n' +
                '• This key is linked to your Telegram User ID\n' +
                '• Changing your username will NOT generate a new key\n' +
                '• Each Telegram account gets ONLY ONE free trial\n\n' +
                '💡 *Check your key anytime with:* `/mykey`\n\n' +
                '🙏 *Thanks for using Melonity!*\n\n' +
                '💳 *Purchase permanent keys:*\n' +
                '🔗 https://melonity-ios.vercel.app/#prices';
            
            await replyToMessage(ctx, message);
            console.log(`✅ Key sent to user ${user.first_name} (${userId})`);
            
            if (OWNER_ID && OWNER_ID !== 'YOUR_TELEGRAM_USER_ID') {
                try {
                    const totalKeys = Object.keys(usersDatabase).length;
                    const activeKeys = Object.values(usersDatabase).filter(user => {
                        const expiryDate = new Date(user.expiresAt);
                        return expiryDate > new Date();
                    }).length;
                    
                    await bot.telegram.sendMessage(OWNER_ID, 
                        `🎫 *NEW KEY GENERATED*\n\n` +
                        `👤 *User:* ${user.first_name} ${user.last_name || ''}\n` +
                        `🆔 *User ID:* ${user.id}\n` +
                        `@${user.username || 'no username'}\n` +
                        `🔑 *Key:* \`${keyData.key}\`\n` +
                        `📅 *Expires:* ${keyData.expiresAt}\n` +
                        `📍 *Location:* ${location}\n\n` +
                        `📊 *Total Keys Issued:* ${totalKeys}\n` +
                        `✅ *Active Keys:* ${activeKeys}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (err) {
                    console.log('Could not notify owner:', err.message);
                }
            }
            
        } else {
            throw new Error(response.data.message || 'Failed to create key');
        }
        
    } catch (error) {
        console.error('Error creating key:', error.message);
        
        let errorMessage = '❌ *Failed to create key.*\n\n';
        
        if (error.code === 'ECONNABORTED') {
            errorMessage += '⏰ Request timeout. The server might be busy. Please try again later.';
        } else if (error.response) {
            if (error.response.status === 400) {
                if (error.response.data.message === 'Key already exists') {
                    errorMessage += '⚠️ A key for this account already exists in the system.\n\n' +
                                   'This might be a duplicate request. Please use `/mykey` to check your existing key.';
                } else {
                    errorMessage += error.response.data.message || 'Invalid request.';
                }
            } else if (error.response.status === 500) {
                errorMessage += 'Server error. Please try again later.';
            } else {
                errorMessage += `Error: ${error.response.data.message || 'Unknown error'}`;
            }
        } else if (error.request) {
            errorMessage += '🌐 Cannot reach the server. Please check your connection or try again later.';
        } else {
            errorMessage += `⚠️ ${error.message}`;
        }
        
        await replyToMessage(ctx, errorMessage);
    }
});

// Admin commands
bot.command('keystats', async (ctx) => {
    if (!OWNER_ID || OWNER_ID === 'YOUR_TELEGRAM_USER_ID') {
        await ctx.reply('⚠️ Owner ID not configured.');
        return;
    }
    
    if (ctx.from.id.toString() !== OWNER_ID.toString()) {
        await ctx.reply('⛔ You are not authorized.');
        return;
    }
    
    const totalUsers = Object.keys(usersDatabase).length;
    const activeKeys = Object.values(usersDatabase).filter(user => {
        const expiryDate = new Date(user.expiresAt);
        return expiryDate > new Date();
    }).length;
    
    await ctx.replyWithMarkdown(
        '📊 *Key Database Statistics*\n\n' +
        `👥 *Total Users:* ${totalUsers}\n` +
        `✅ *Active Keys:* ${activeKeys}\n` +
        `⏰ *Expired Keys:* ${totalUsers - activeKeys}`
    );
});

bot.command('checkuser', async (ctx) => {
    if (!OWNER_ID || OWNER_ID === 'YOUR_TELEGRAM_USER_ID') {
        await ctx.reply('⚠️ Owner ID not configured.');
        return;
    }
    
    if (ctx.from.id.toString() !== OWNER_ID.toString()) {
        await ctx.reply('⛔ You are not authorized.');
        return;
    }
    
    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        await ctx.reply('Usage: /checkuser <user_id>');
        return;
    }
    
    const target = args[1];
    const userData = usersDatabase[target];
    
    if (userData) {
        await ctx.replyWithMarkdown(
            `🔍 *User Information*\n\n` +
            `🆔 *User ID:* ${userData.userId}\n` +
            `👤 *Name:* ${userData.firstName} ${userData.lastName || ''}\n` +
            `🔑 *Key:* \`${userData.key}\`\n` +
            `📅 *Expires:* ${userData.expiresAt}\n` +
            `✅ *Status:* ${new Date(userData.expiresAt) > new Date() ? '🟢 Active' : '🔴 Expired'}`
        );
    } else {
        await ctx.reply(`❌ User not found.`);
    }
});

// Error handling
bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    const errorMessage = '❌ An unexpected error occurred. Please try again later.';
    
    try {
        if (ctx.message && ctx.message.message_id) {
            bot.telegram.sendMessage(ctx.chat.id, errorMessage, {
                reply_to_message_id: ctx.message.message_id,
                parse_mode: 'Markdown'
            }).catch(console.error);
        }
    } catch (e) {
        console.error('Could not send error message:', e);
    }
});

// Initialize and start
async function init() {
    await loadUsersDatabase();
    
    // Set webhook or polling (Render works better with polling)
    await bot.launch();
    
    console.log('🤖 Bot is running...');
    console.log(`📡 Using API endpoint: ${API_ENDPOINT}`);
    console.log(`💾 Users database: ${USERS_DB_PATH}`);
    console.log(`📊 Loaded ${Object.keys(usersDatabase).length} existing users`);
    console.log('✅ Bot is ready!');
}

init();

// Graceful stop
process.once('SIGINT', () => {
    saveUsersDatabase().then(() => {
        console.log('💾 Saved database before exit');
        bot.stop('SIGINT');
        process.exit(0);
    });
});
process.once('SIGTERM', () => {
    saveUsersDatabase().then(() => {
        console.log('💾 Saved database before exit');
        bot.stop('SIGTERM');
        process.exit(0);
    });
});