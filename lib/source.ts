import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export type RawSource = {
  ID?: number;
  title?: string;
  channel_url: string;
  channel_referer?: string;
  channel_origin?: string;
  country?: string;
  isvip?: number;
  channel_headers?: unknown;
};

export type RawPost = {
  channel_id: number;
  category_id: number;
  channel_name: string;
  channel_name_en: string;
  channel_image?: string;
  channel_url: string;
  channel_referer?: string;
  channel_agent?: string;
  channel_origin?: string;
  need_vpn?: number;
  for_iran?: number;
  popular?: string | number;
  isvip?: number;
  category_name?: string;
  category_name_en?: string;
  channel_headers?: unknown;
  sourses?: RawSource[];
};

export type Channel = {
  id: number;
  catId: number;
  name: string;
  nameEn: string;
  image: string | null;
  url: string;
  referer: string | null;
  origin: string | null;
  vpn: boolean;
  iran: boolean;
  popular: number;
  vip: boolean;
  category: string;
  categoryEn: string;
  sources: {
    id: number | null;
    title: string | null;
    url: string;
    referer: string | null;
    origin: string | null;
    country: string | null;
    vip: boolean;
  }[];
};

export type SourceAdapterStatus = 'ready' | 'disabled' | 'unconfigured' | 'failed';

export type CatalogSourceResult = {
  adapter: string;
  status: SourceAdapterStatus;
  channels: Channel[];
  error?: string;
};

export type CatalogSourceAdapter = {
  id: string;
  name: string;
  optional: boolean;
  isEnabled: () => boolean;
  isConfigured: () => boolean;
  fetch: () => Promise<Channel[]>;
};

function envFlag(name: string, defaultValue: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(value);
}

function decryptPayload(text: string) {
  const keyHex = process.env.SOURCE_AES_KEY_HEX?.trim() ?? '';
  const ivHex = process.env.SOURCE_AES_IV_HEX?.trim() ?? '';

  if (!keyHex || !ivHex) {
    throw new Error('mytvsat encrypted source is not configured: SOURCE_AES_KEY_HEX / SOURCE_AES_IV_HEX are missing');
  }

  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');

  if (key.length !== 32 || iv.length !== 16) {
    throw new Error('mytvsat encrypted source has invalid AES configuration: key must be 32 bytes and IV must be 16 bytes');
  }

  const input = Buffer.from(text.trim(), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let output = Buffer.concat([decipher.update(input), decipher.final()]);

  if (output[0] === 0x1f && output[1] === 0x8b) {
    output = gunzipSync(output);
  }

  return JSON.parse(output.toString('utf8')) as { posts?: RawPost[] } | RawPost[];
}

function normalizePosts(body: { posts?: RawPost[] } | RawPost[]) {
  const posts = Array.isArray(body) ? body : body.posts ?? [];

  return posts.map((post): Channel => ({
    id: post.channel_id,
    catId: post.category_id,
    name: post.channel_name,
    nameEn: post.channel_name_en,
    image: post.channel_image ?? null,
    url: post.channel_url,
    referer: post.channel_referer ?? null,
    origin: post.channel_origin ?? null,
    vpn: Boolean(post.need_vpn),
    iran: Boolean(post.for_iran),
    popular: Number(post.popular ?? 0),
    vip: Boolean(post.isvip),
    category: post.category_name ?? '',
    categoryEn: post.category_name_en ?? '',
    sources: (post.sourses ?? []).map((source) => ({
      id: source.ID ?? null,
      title: source.title ?? null,
      url: source.channel_url,
      referer: source.channel_referer ?? null,
      origin: source.channel_origin ?? null,
      country: source.country ?? null,
      vip: Boolean(source.isvip),
    })),
  }));
}

const myTvSatAdapter: CatalogSourceAdapter = {
  id: 'mytvsat-encrypted',
  name: 'mytvsat encrypted feed',
  optional: true,
  isEnabled: () => envFlag('SOURCE_ENCRYPTED_ENABLED', true),
  isConfigured: () => Boolean(
    process.env.SOURCE_ENCRYPTED_URL?.trim() &&
    process.env.SOURCE_AES_KEY_HEX?.trim() &&
    process.env.SOURCE_AES_IV_HEX?.trim(),
  ),
  async fetch() {
    const url = process.env.SOURCE_ENCRYPTED_URL?.trim();
    if (!url) throw new Error('SOURCE_ENCRYPTED_URL is missing');

    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`source returned ${response.status}`);

    return normalizePosts(decryptPayload(await response.text()));
  },
};

export const catalogSourceAdapters: CatalogSourceAdapter[] = [myTvSatAdapter];

export async function fetchCatalogSources(): Promise<CatalogSourceResult[]> {
  const results: CatalogSourceResult[] = [];

  for (const adapter of catalogSourceAdapters) {
    if (!adapter.isEnabled()) {
      results.push({ adapter: adapter.id, status: 'disabled', channels: [] });
      continue;
    }

    if (!adapter.isConfigured()) {
      results.push({
        adapter: adapter.id,
        status: 'unconfigured',
        channels: [],
        error: 'Optional source credentials are not configured; source was skipped.',
      });
      continue;
    }

    try {
      results.push({ adapter: adapter.id, status: 'ready', channels: await adapter.fetch() });
    } catch (error) {
      results.push({
        adapter: adapter.id,
        status: 'failed',
        channels: [],
        error: error instanceof Error ? error.message : 'source fetch failed',
      });
    }
  }

  return results;
}

/** Backward-compatible single-catalog API. Optional sources that are not configured return an empty catalog. */
export async function fetchCatalog(): Promise<Channel[]> {
  const results = await fetchCatalogSources();
  return results.flatMap((result) => result.channels);
}

export function categoriesOf(channels: Channel[]) {
  return Array.from(
    new Map(channels.map((channel) => [channel.catId, {
      id: channel.catId,
      name: channel.category,
      nameEn: channel.categoryEn,
    }])).values(),
  ).filter((category) => category.id !== 0);
}
