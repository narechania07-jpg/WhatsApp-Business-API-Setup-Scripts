# WhatsApp Auto-Reply Bot

A rule-based auto-reply bot for a regular WhatsApp account, built on
[whatsapp-web.js](https://github.com/narechania07-jpg/whatsapp-web.js).

> **Heads-up:** whatsapp-web.js automates WhatsApp Web and is not an official WhatsApp API.
> WhatsApp may ban numbers that behave like bots or spam. Use a number you can afford to lose,
> only reply to people who message you first, and keep replies low-volume.

## Features

- Keyword rules: `exact`, `contains`, `startsWith` or `regex` matching (case-insensitive)
- Away message outside business hours (timezone-aware, overnight windows supported)
- Default reply when nothing matches
- `{name}` placeholder filled with the sender's WhatsApp name
- Per-chat cooldowns so the bot can't spam or loop with another bot
- Ignores groups (configurable), status updates, broadcasts and your own messages
- "Typing…" indicator before each reply
- Session is saved locally, so you only scan the QR code once

## Setup

Requires Node.js 18+.

```sh
cd auto-reply-bot
npm install
cp config.example.json config.json   # then edit config.json
npm start
```

On first run a QR code appears in the terminal. On your phone open
**WhatsApp → Settings → Linked devices → Link a device** and scan it.
The session is stored in `.wwebjs_auth/`; delete that folder to log out.

To log in with a pairing code instead of a QR code:

```sh
PAIR_PHONE=919876543210 npm start   # country code + number, no "+"
```

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOT_CONFIG` | `./config.json` | Path to the config file (falls back to `config.example.json`) |
| `PAIR_PHONE` | – | Log in with a pairing code for this number instead of a QR code |
| `HEADLESS` | `true` | Set to `false` to watch the browser |
| `NO_SANDBOX` | – | Set to `1` when running as root (e.g. Docker) |
| `PUPPETEER_EXECUTABLE_PATH` | – | Use an existing Chrome/Chromium instead of Puppeteer's download |

## Configuration

See [`config.example.json`](./config.example.json).

| Key | Meaning |
| --- | --- |
| `rules` | Checked in order; the **first** match is sent. Keyword rules always answer, even outside business hours. |
| `rules[].match` | `exact`, `contains`, `startsWith` (use `keywords: [...]`) or `regex` (use `pattern`, optional `flags`, default `"i"`) |
| `rules[].reply` | Reply text. WhatsApp formatting works (`*bold*`, `_italic_`), and `{name}` is replaced. |
| `businessHours` | `timezone` (IANA, e.g. `Asia/Kolkata`), `days` (`mon`…`sun`), `start`/`end` (`HH:MM`). Omit to treat the bot as always open. |
| `awayMessage` | Sent when nothing matches outside business hours. |
| `defaultReply` | Sent when nothing matches during business hours. Omit to stay silent. |
| `ruleCooldownMinutes` | Minimum gap before the same rule answers the same chat again (default 1). |
| `fallbackCooldownMinutes` | Minimum gap between away/default replies to the same chat (default 360). |
| `replyInGroups` | Reply in group chats too (default `false`). |
| `ignoreChats` | Chat IDs to never reply to, e.g. `"919876543210@c.us"`. |
| `typingDelayMs` | Show "typing…" for this long before replying (0 to disable). |

Cooldowns are kept in memory, so they reset when the bot restarts.

## Tests

```sh
npm test
```

The reply logic lives in `src/responder.js` and is tested without starting WhatsApp.
