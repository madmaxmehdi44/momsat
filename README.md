# MOMSAT Web

Next.js 15 + React 19 web app for Persian live-TV discovery, playback, catalog administration and EPG/live-guide presentation.

## Included
- RTL Persian discovery homepage.
- Live channel catalog with search and category filters.
- Channel detail pages with normalized metadata and source variants.
- HLS playback using native browser HLS or hls.js.
- Admin control center with catalog statistics, catalog sync, CSV catalog import and EPG sync.
- PostgreSQL schema through Prisma: `Category`, `Channel`, `Source`, `EpgChannel`, `Program`.
- Pluggable catalog source adapters with optional failure isolation.
- XMLTV ingestion with Persian/Arabic name normalization and channel matching.
- 24-hour live program guide backed by stored EPG data.

## Run
```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run seed
npm run dev
```

## CSV catalog import

The admin page (`/admin`) accepts two CSV files: `v2_posts_channels.csv` and `v2_posts_verified.csv`. Uploading both to the **CSV Catalog Import** control sends them to `POST /api/admin/catalog/import` as multipart form data.

The importer is idempotent. It joins verified rows to channel rows by `channel_id`, normalizes Persian/Arabic names (`ي/ى → ی`, `ك → ک`), uses a stable `catalogKey`, matches existing channels before creating records, and checks `(channelId, url)` before inserting a source. Re-importing the same files therefore does not create duplicate channels or stream sources.

The current CSV format supplies channel metadata and the `sourses` source list. The importer also accepts optional future columns such as `language`, `country`, `platform`, `satellite`, `frequency`, `polarization`, `symbolRate`/`symbol_rate`, and `serviceId`/`service_id`/`sid`; these are stored on `Channel` without requiring the CSV to contain them today.

Only server-side admin requests with the existing `ADMIN_TOKEN` protection should be used. CSV uploads are limited to 5 MB per file.

## Catalog ingestion

MOMSAT supports multiple independent catalog adapters. A missing or failing optional adapter does not prevent the remaining sources from syncing.

### ParsaTV public directory
```env
SOURCE_PARSATV_ENABLED="true"
SOURCE_PARSATV_INDEX_URL="https://www.parsatv.com/"
```
The adapter discovers public channel detail pages and extracts publicly exposed HLS/stream/embed URLs. It does not bypass authentication or access controls.

### PersianTVLive public directory
```env
SOURCE_PERSIANTVLIVE_ENABLED="true"
SOURCE_PERSIANTVLIVE_INDEX_URL="https://www.persiantvlive.com/"
```

### PakhshZende public directory
```env
SOURCE_PAKHSHZENDE_ENABLED="true"
SOURCE_PAKHSHZENDE_INDEX_URL="https://pakhshzende.com/tv-channels/"
```

### Generic M3U importer
```env
SOURCE_M3U_ENABLED="true"
SOURCE_M3U_URLS="https://example.com/playlist.m3u,https://example.com/another.m3u"
```
Multiple URLs can also be separated by newlines. `EXTINF`, `tvg-logo` and `group-title` metadata are normalized into the common channel model.

### Official broadcaster feeds
```env
SOURCE_OFFICIAL_ENABLED="true"
SOURCE_OFFICIAL_URLS="https://example.com/channels.json,https://example.com/channels.m3u"
```
Only feeds that the deployment is authorized to consume should be configured.

### Optional encrypted mytvsat feed
The encrypted `mytvsat` feed is disabled by default and is completely optional:
```env
SOURCE_ENCRYPTED_ENABLED="false"
```
To enable it, all upstream credentials must be supplied in the deployment environment. Missing credentials produce an `unconfigured` status rather than failing the whole sync.

## XMLTV EPG

Configure one or more authorized XMLTV endpoints:
```env
EPG_XMLTV_URLS="https://example.com/guide.xml,https://example.com/another-guide.xml"
EPG_FETCH_TIMEOUT_MS="20000"
EPG_HORIZON_DAYS="7"
```

The EPG pipeline:
1. Downloads XMLTV feeds server-side.
2. Parses `channel`, `programme`, `title`, `sub-title`, `desc`, `category` and `icon` fields.
3. Handles XMLTV timestamps with explicit offsets and UTC timestamps.
4. Normalizes Persian/Arabic channel names (`ي/ى → ی`, `ك → ک`) for matching.
5. Matches EPG channels to MOMSAT channels and stores unmatched EPG data safely.
6. Keeps a configurable future horizon and removes old programmes.

Admin sync: `POST /api/admin/epg` with the same `x-admin-token` protection as catalog sync.

Guide API: `GET /api/epg?channelId=123&from=2026-09-10T00:00:00Z&to=2026-09-11T00:00:00Z`.

Web guide: `/guide`.

## Discovery controls
```env
SOURCE_SITE_MAX_CHANNELS="250"
SOURCE_SITE_CONCURRENCY="6"
SOURCE_FETCH_TIMEOUT_MS="15000"
SOURCE_HTTP_USER_AGENT="MomSatCatalog/1.0"
```

`ADMIN_TOKEN` remains a MOMSAT-side secret used to protect the admin sync endpoints.
