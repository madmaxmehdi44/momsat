# MOMSAT Web

Next.js 15 + React 19 web app for Persian live-TV discovery, playback and catalog administration.

## Included
- RTL Persian discovery homepage.
- Live channel catalog with search and category filters.
- Channel detail pages with all normalized metadata and source variants.
- HLS playback using native browser HLS or hls.js.
- Admin control center with catalog statistics and `Fetch + Sync`.
- PostgreSQL schema through Prisma: `Category`, `Channel`, `Source`.
- Server-side AES-256-CBC + optional GZIP decoding for the `v2/posts` payload. Secrets stay in environment variables.

## Run
```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run seed
npm run dev
```

Required environment values for live ingestion:
- `DATABASE_URL`
- `SOURCE_ENCRYPTED_URL`
- `SOURCE_AES_KEY_HEX`
- `SOURCE_AES_IV_HEX`
- `ADMIN_TOKEN`

The application does not commit the AES key/IV. Populate them only in your deployment environment where access to the upstream payload is authorized.