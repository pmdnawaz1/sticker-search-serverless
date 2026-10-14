# Sticker Pack Search — Telegram Serverless

A JavaScript bot for Telegram Serverless. Users can send `.packs penguin` or `/packs penguin` and navigate result pages with inline buttons.

## Architecture

- `tgcloud/handlers/message.js`: `/start`, `/help`, `.packs`, `/packs`
- `tgcloud/handlers/callback_query.js`: pagination callbacks
- `tgcloud/lib/packs.js`: FStik directory adapter, normalization, ranking, cache, formatting
- `tgcloud/schema.js`: SQLite-backed search cache

This uses Telegram Serverless's built-in Bot API, `fetch`, and database. It does not use Python, `aiogram`, `httpx`, or a VPS.

## Requirements

- Node.js 18+
- A bot created with @BotFather
- Telegram Serverless enabled for the bot in @BotFather
- The CLI access token from BotFather → your bot → Serverless → CLI Access

## Setup

```sh
npm install
npx tgcloud login
npx tgcloud status
npx tgcloud push
npx tgcloud migrate
```

Review the schema migration prompt before confirming. Then test in Telegram with:

```text
/start
.packs penguin
/packs cute cat page 2
```

You can test the message handler against the platform without deploying:

```sh
npx tgcloud run handlers/message '{ chat: { id: 123, type: "private" }, text: "/packs penguin" }'
```

## Provider

The provider adapter calls the documented FStik endpoint:

`https://fstik.app/api/sticker-sets/search?type=search&query=...&public=true&safe=true&limit=50&skip=...`

Provider availability, rate limits, and terms may change. If it fails, the bot returns a user-safe error. The adapter is isolated in `tgcloud/lib/packs.js` so a different permitted provider can replace it.

## Important implementation notes

- The Bot API does not expose global keyword search for sticker sets; the directory is the discovery layer.
- This first release displays pack names and direct add links. The provider's example `file_id` values are not assumed to be valid for this bot, so it does not send potentially invalid sticker previews. Add previews after verifying discovered names with `getStickerSet` and choosing a UI that won't spam users with ten separate sticker messages.
- The cache uses a 30-minute TTL.
- Results are bounded and de-duplicated. The directory index is not guaranteed to cover every Telegram pack.
- No comments or secrets are required in deployed code.
