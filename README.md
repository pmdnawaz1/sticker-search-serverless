# Sticker Pack Search — Telegram Serverless

A JavaScript bot for Telegram Serverless. Users can send `.packs penguin` or `/packs penguin`, browse ten results per page, preview a pack through Telegram's Bot API, and open its add-pack link.

## How search works

Telegram's Bot API does not provide global keyword search for sticker sets. The bot therefore searches a catalog snapshot derived from the public [StickerFinder project](https://github.com/Nukesor/sticker-finder).

- `tgcloud/handlers/message.js`: `/start`, `/help`, `.packs`, `/packs`
- `tgcloud/handlers/callback_query.js`: pagination and on-demand preview
- `tgcloud/lib/packs.js`: catalog fetch, ranking, cache, formatting
- `tgcloud/schema.js`: SQLite-backed cache
- `.github/workflows/build-catalog.yml`: imports the upstream PostgreSQL dump and publishes a compact JSON index to `catalog/packs.json`

The catalog is a snapshot from the upstream 2020 database dump. It is free to build and serve from GitHub, but it is not a live or exhaustive Telegram-wide index. Searches match pack names and titles; they do not search every sticker image or tag.

## First setup

1. Push the repository to GitHub.
2. Open **Actions → Build sticker catalog** and confirm the workflow succeeds. It should run automatically when the workflow is first added; you can also trigger it manually.
3. Wait for the workflow's catalog commit. Confirm that `catalog/packs.json` exists.
4. Install and authenticate Telegram Serverless:

```sh
npm install
npx tgcloud login
npx tgcloud status
npx tgcloud push
npx tgcloud migrate
```

Review the schema migration prompt before confirming. Then test in a real Telegram chat:

```text
/start
.packs penguin
/packs cute cat page 2
```

A fake chat ID passed to `tgcloud run` can produce Telegram's `chat not found` error even when local handler execution works. Test message delivery in a real bot chat.

## Catalog workflow

The workflow downloads the upstream database dump, restores it into a temporary PostgreSQL service in GitHub Actions, exports safe sticker-pack names and titles to JSON, and commits the compact index. The 23 MB upstream dump is not copied into this repository. Re-running the workflow regenerates the index from the same upstream snapshot; it does not make that snapshot newer.

## Limitations

- Results depend on the upstream catalog snapshot and may omit newer packs.
- Preview buttons call Telegram's `getStickerSet` only when clicked. Invalid or deleted packs return a short callback notice instead of breaking search.
- Search responses are cached for 30 minutes; the catalog payload is cached for six hours.
- The upstream StickerFinder project is archived. Review its license and data provenance before extending or redistributing its source code or database.
