'use strict';

const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { createResponder, fillTemplate } = require('./responder');

const ROOT = path.join(__dirname, '..');

function loadConfig() {
    const configPath = process.env.BOT_CONFIG || path.join(ROOT, 'config.json');
    if (fs.existsSync(configPath)) {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
    console.warn(`No config at ${configPath}; using config.example.json. Copy it to config.json to customise.`);
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'));
}

const config = loadConfig();
const responder = createResponder(config);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(ROOT, '.wwebjs_auth') }),
    puppeteer: {
        headless: process.env.HEADLESS !== 'false',
        // Needed when running as root, e.g. in Docker.
        args: process.env.NO_SANDBOX === '1' ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
    },
    // Log in with an 8-character code instead of scanning a QR: PAIR_PHONE=<countrycode><number>
    ...(process.env.PAIR_PHONE && { pairWithPhoneNumber: { phoneNumber: process.env.PAIR_PHONE } }),
});

client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp (Settings → Linked devices → Link a device):');
    qrcode.generate(qr, { small: true });
});
client.on('code', (code) => console.log(`Pairing code: ${code} (WhatsApp → Linked devices → Link with phone number)`));
client.on('authenticated', () => console.log('Authenticated.'));
client.on('auth_failure', (msg) => console.error('Authentication failed:', msg));
client.on('ready', () => console.log(`Auto-reply bot is running with ${(config.rules || []).length} rules.`));
client.on('disconnected', (reason) => {
    console.error('Disconnected:', reason);
    process.exit(1);
});

client.on('message', async (msg) => {
    if (msg.fromMe || msg.isStatus || msg.broadcast || msg.from === 'status@broadcast') return;

    const chatId = msg.from;
    const decision = responder.respond({ chatId, text: msg.body, isGroup: chatId.endsWith('@g.us') });
    if (!decision) return;

    try {
        let name = 'there';
        if (decision.reply.includes('{name}')) {
            const contact = await msg.getContact();
            name = contact.pushname || contact.name || name;
        }
        const reply = fillTemplate(decision.reply, { name });

        if (config.typingDelayMs > 0) {
            const chat = await msg.getChat();
            await chat.sendStateTyping();
            await sleep(config.typingDelayMs);
        }
        await client.sendMessage(chatId, reply);
        console.log(`[${new Date().toISOString()}] ${chatId} (${decision.reason}): ${JSON.stringify(msg.body).slice(0, 80)}`);
    } catch (err) {
        console.error(`Failed to reply to ${chatId}:`, err);
    }
});

async function shutdown() {
    console.log('Shutting down...');
    await client.destroy().catch(() => {});
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.initialize().catch((err) => {
    console.error('Could not start WhatsApp Web:', err.message);
    process.exit(1);
});
