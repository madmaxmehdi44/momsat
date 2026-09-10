# MOMSAT Web

MOMSAT is a mobile-first live television discovery and playback platform.

## Source discovery

Directory pages are treated as discovery inputs, not playback URLs. MOMSAT recursively inspects public HTML pages, iframe/embed targets, common player configuration attributes, and media URL literals to discover direct HLS/media candidates. Discovered candidates are then validated through the stream probe before playback.

Runtime page resolution is available through `GET /api/stream/resolve?url=...`. The resolver is SSRF-aware and rejects private/local targets.

## Playback

Direct media candidates are proxied through `/api/stream`, which preserves the source referer/origin when supplied and rewrites HLS playlists so nested segment requests continue through the same proxy. `SmartPlayer` no longer embeds third-party directory pages such as ParsaTV as if they were media streams.

## Discovery controls

The following environment variables control recursive web discovery:

- `SOURCE_WEB_FETCH_TIMEOUT_MS`
- `SOURCE_WEB_DISCOVERY_MAX_DEPTH`
- `SOURCE_WEB_DISCOVERY_MAX_PAGES`

Keep real database, storage, provider credentials, and admin secrets outside the repository.
