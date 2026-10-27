'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createResponder, fillTemplate } = require('../src/responder');
const exampleConfig = require('../config.example.json');

// 2026-10-28 is a Wednesday. 06:00Z = 11:30 IST (open), 15:00Z = 20:30 IST (closed).
const OPEN = new Date('2026-10-28T06:00:00Z');
const CLOSED = new Date('2026-10-28T15:00:00Z');

function responderAt(config, date) {
    const clock = { date };
    const r = createResponder(config, { now: () => clock.date });
    return { respond: r.respond, clock };
}

test('keyword rules match by type', () => {
    const { respond } = responderAt(exampleConfig, OPEN);
    assert.equal(respond({ chatId: 'a', text: 'Hello there' }).reason, 'rule:greeting');
    assert.equal(respond({ chatId: 'b', text: '  MENU ' }).reason, 'rule:menu');
    assert.equal(respond({ chatId: 'c', text: 'show me the menu please' }).reason, 'default'); // exact, so no match
    assert.equal(respond({ chatId: 'd', text: 'What is the PRICE?' }).reason, 'rule:price');
    assert.equal(respond({ chatId: 'e', text: 'Where   are you located' }).reason, 'rule:address');
});

test('first matching rule wins', () => {
    const { respond } = responderAt(exampleConfig, OPEN);
    assert.equal(respond({ chatId: 'a', text: 'hi, what is the price?' }).reason, 'rule:greeting');
});

test('away message outside business hours, default reply inside', () => {
    assert.equal(responderAt(exampleConfig, CLOSED).respond({ chatId: 'a', text: 'anyone?' }).reason, 'away');
    assert.equal(responderAt(exampleConfig, OPEN).respond({ chatId: 'a', text: 'anyone?' }).reason, 'default');
    // Sunday is not a business day.
    const sunday = new Date('2026-11-01T06:00:00Z');
    assert.equal(responderAt(exampleConfig, sunday).respond({ chatId: 'a', text: 'anyone?' }).reason, 'away');
});

test('keyword rules still answer when closed', () => {
    const { respond } = responderAt(exampleConfig, CLOSED);
    assert.equal(respond({ chatId: 'a', text: 'price' }).reason, 'rule:price');
});

test('cooldowns stop repeated replies per chat', () => {
    const { respond, clock } = responderAt(exampleConfig, OPEN);
    assert.ok(respond({ chatId: 'a', text: 'price' }));
    assert.equal(respond({ chatId: 'a', text: 'price?' }), null);
    assert.ok(respond({ chatId: 'b', text: 'price' }), 'other chats are unaffected');
    assert.ok(respond({ chatId: 'a', text: 'hours' }), 'other rules are unaffected');

    clock.date = new Date(OPEN.getTime() + 61_000);
    assert.ok(respond({ chatId: 'a', text: 'price' }), 'rule cooldown expires after 1 minute');

    assert.ok(respond({ chatId: 'a', text: 'random' }));
    clock.date = new Date(clock.date.getTime() + 60 * 60_000);
    assert.equal(respond({ chatId: 'a', text: 'random again' }), null, 'default reply only once per 6 hours');
});

test('groups, ignored chats and empty messages get no reply', () => {
    const { respond } = responderAt({ ...exampleConfig, ignoreChats: ['boss@c.us'] }, OPEN);
    assert.equal(respond({ chatId: 'x@g.us', text: 'hi', isGroup: true }), null);
    assert.equal(respond({ chatId: 'boss@c.us', text: 'hi' }), null);
    assert.equal(respond({ chatId: 'a', text: '   ' }), null);

    const groups = responderAt({ ...exampleConfig, replyInGroups: true }, OPEN);
    assert.ok(groups.respond({ chatId: 'x@g.us', text: 'hi', isGroup: true }));
});

test('no reply when nothing matches and no fallback is configured', () => {
    const { respond } = responderAt({ rules: [{ match: 'exact', keywords: ['ping'], reply: 'pong' }] }, OPEN);
    assert.equal(respond({ chatId: 'a', text: 'hello' }), null);
    assert.deepEqual(respond({ chatId: 'a', text: 'Ping' }), { reply: 'pong', reason: 'rule:rule1' });
});

test('overnight business hours', () => {
    const config = {
        businessHours: { timezone: 'UTC', days: ['fri'], start: '22:00', end: '02:00' },
        awayMessage: 'closed',
        defaultReply: 'open',
    };
    const at = (iso) => responderAt(config, new Date(iso)).respond({ chatId: 'a', text: 'yo' }).reason;
    assert.equal(at('2026-10-30T23:00:00Z'), 'default'); // Fri 23:00
    assert.equal(at('2026-10-31T01:00:00Z'), 'default'); // Sat 01:00, still Friday's shift
    assert.equal(at('2026-10-31T03:00:00Z'), 'away');
    assert.equal(at('2026-10-31T23:00:00Z'), 'away'); // Sat is not a business day
});

test('invalid config fails fast', () => {
    assert.throws(() => createResponder({ rules: [{ match: 'fuzzy', keywords: ['a'], reply: 'b' }] }), /must be one of/);
    assert.throws(() => createResponder({ rules: [{ match: 'contains', keywords: [], reply: 'b' }] }), /keyword/);
    assert.throws(() => createResponder({ rules: [{ match: 'exact', keywords: ['a'] }] }), /reply/);
    assert.throws(() => createResponder({ businessHours: { start: '9am', end: '17:00' } }), /HH:MM/);
});

test('fillTemplate substitutes known variables only', () => {
    assert.equal(fillTemplate('Hi {name}, {unknown}', { name: 'Asha' }), 'Hi Asha, {unknown}');
});
