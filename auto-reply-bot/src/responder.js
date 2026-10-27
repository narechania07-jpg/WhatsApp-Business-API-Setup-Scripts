'use strict';

// Pure decision logic for the bot: given an incoming message, decide what (if
// anything) to reply. Kept free of whatsapp-web.js so it can be unit-tested.

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MATCH_TYPES = ['exact', 'contains', 'startsWith', 'regex'];

function normalize(text) {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function compileRule(rule, index) {
    const id = rule.id || `rule${index + 1}`;
    if (!MATCH_TYPES.includes(rule.match)) {
        throw new Error(`Rule "${id}": "match" must be one of ${MATCH_TYPES.join(', ')}`);
    }
    if (typeof rule.reply !== 'string' || !rule.reply) {
        throw new Error(`Rule "${id}": "reply" must be a non-empty string`);
    }

    if (rule.match === 'regex') {
        if (!rule.pattern) throw new Error(`Rule "${id}": regex rules need a "pattern"`);
        const regex = new RegExp(rule.pattern, rule.flags ?? 'i');
        return { id, reply: rule.reply, test: (text) => regex.test(text.trim()) };
    }

    const keywords = (rule.keywords || []).map(normalize).filter(Boolean);
    if (!keywords.length) throw new Error(`Rule "${id}": needs at least one keyword`);
    const tests = {
        exact: (text, kw) => text === kw,
        contains: (text, kw) => text.includes(kw),
        startsWith: (text, kw) => text.startsWith(kw),
    };
    const test = tests[rule.match];
    return { id, reply: rule.reply, test: (text) => keywords.some((kw) => test(normalize(text), kw)) };
}

function parseTime(value, field) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value || '');
    if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) {
        throw new Error(`businessHours.${field} must look like "HH:MM"`);
    }
    return Number(m[1]) * 60 + Number(m[2]);
}

function compileBusinessHours(hours) {
    if (!hours) return null;
    const days = (hours.days || DAY_NAMES).map((d) => d.toLowerCase().slice(0, 3));
    for (const d of days) {
        if (!DAY_NAMES.includes(d)) throw new Error(`businessHours.days: unknown day "${d}"`);
    }
    const start = parseTime(hours.start, 'start');
    const end = parseTime(hours.end, 'end');
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: hours.timezone, // undefined = the machine's local timezone
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    });

    return function isOpen(date) {
        const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
        const day = parts.weekday.toLowerCase();
        const minutes = Number(parts.hour) * 60 + Number(parts.minute);
        if (start <= end) return days.includes(day) && minutes >= start && minutes < end;
        // Overnight window, e.g. 22:00–02:00: the early-morning part belongs to the previous day.
        const prevDay = DAY_NAMES[(DAY_NAMES.indexOf(day) + 6) % 7];
        return (days.includes(day) && minutes >= start) || (days.includes(prevDay) && minutes < end);
    };
}

function createResponder(config, { now = () => new Date() } = {}) {
    const rules = (config.rules || []).map(compileRule);
    const isOpen = compileBusinessHours(config.businessHours);
    const ignoreChats = new Set(config.ignoreChats || []);
    const ruleCooldownMs = (config.ruleCooldownMinutes ?? 1) * 60_000;
    const fallbackCooldownMs = (config.fallbackCooldownMinutes ?? 360) * 60_000;
    const lastSent = new Map(); // `${chatId}:${kind}` -> timestamp

    function onCooldown(key, cooldownMs, at) {
        const last = lastSent.get(key);
        return last !== undefined && at - last < cooldownMs;
    }

    /**
     * @param {{chatId: string, text: string, isGroup?: boolean}} message
     * @returns {{reply: string, reason: string} | null}
     */
    function respond({ chatId, text, isGroup = false }) {
        if (isGroup && !config.replyInGroups) return null;
        if (ignoreChats.has(chatId)) return null;
        if (typeof text !== 'string' || !text.trim()) return null;

        const date = now();
        const at = date.getTime();
        let candidate = null;

        const rule = rules.find((r) => r.test(text));
        if (rule) {
            candidate = { key: `${chatId}:rule:${rule.id}`, cooldownMs: ruleCooldownMs, reply: rule.reply, reason: `rule:${rule.id}` };
        } else if (isOpen && !isOpen(date) && config.awayMessage) {
            candidate = { key: `${chatId}:away`, cooldownMs: fallbackCooldownMs, reply: config.awayMessage, reason: 'away' };
        } else if (config.defaultReply) {
            candidate = { key: `${chatId}:default`, cooldownMs: fallbackCooldownMs, reply: config.defaultReply, reason: 'default' };
        }

        if (!candidate || onCooldown(candidate.key, candidate.cooldownMs, at)) return null;
        lastSent.set(candidate.key, at);
        return { reply: candidate.reply, reason: candidate.reason };
    }

    return { respond };
}

function fillTemplate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] !== undefined ? vars[key] : whole));
}

module.exports = { createResponder, fillTemplate };
