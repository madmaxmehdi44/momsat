import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { discoverMediaSources } from './web-source-extractor';

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
  language?: string;
  country?: string;
  platform?: string;
  satellite?: string;
  frequency?: string;
  polarization?: string;
  symbolRate?: string;
  symbol_rate?: string;
  serviceId?: string;
  service_id?: string;
  sid?: string;
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
  language: string | null;
  country: string | null;
  platform: string | null;
  satellite: string | null;
  frequency: string | null;
  polarization: string | null;
  symbolRate: string | null;
  serviceId: string | null;
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
export type CatalogSourceResult = { adapter: string; status: SourceAdapterStatus; channels: Channel[]; error?: string };
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

function envInt(name: string, fallback: number, min = 1, max = 1000) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function stableId(input: string) {
  const digest = crypto.createHash('sha1').update(input).digest();
  const value = digest.readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
}

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function absoluteUrl(value: string, base: string) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function unique(values: string[]) { return Array.from(new Set(values.filter(Boolean))); }

function extractAnchors(html: string, pageUrl: string) {
  const links: { href: string; text: string }[] = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = absoluteUrl(decodeHtml(match[1]), pageUrl);
    const text = stripTags(match[2]);
    if (href && text) links.push({ href, text });
  }
  return links;
}

function htmlImage(html: string, pageUrl: string) {
  const match = html.match(/<img\b[^>]*(?:src|data-src)=["']([^"']+)["']/i);
  return match ? absoluteUrl(decodeHtml(match[1]), pageUrl) : null;
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': process.env.SOURCE_HTTP_USER_AGENT || 'MomSatCatalog/1.0' },
    signal: AbortSignal.timeout(envInt('SOURCE_FETCH_TIMEOUT_MS', 15000, 2000, 60000)),
  });
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return response.text();
}

function categoryFromName(name: string) {
  const value = name.toLowerCase();
  if (/sport|varzesh|ورزش|football|soccer/.test(value)) return ['Sport', 'sport'];
  if (/news|khabar|خبر/.test(value)) return ['News', 'news'];
  if (/music|moz|موزیک|موسیقی/.test(value)) return ['Music', 'music'];
  if (/radio|رادیو/.test(value)) return ['Radio', 'radio'];
  if (/movie|film|فیلم|سینما|cinema/.test(value)) return ['Movies', 'movies'];
  return ['Persian TV', 'persian-tv'];
}

function siteChannel(name: string, pageUrl: string, streamUrls: string[], image: string | null, adapterId: string): Channel {
  const [category, categoryEn] = categoryFromName(name);
  const stream = streamUrls[0] ?? pageUrl;
  const sources = streamUrls.map((url, index) => ({
    id: stableId(`${adapterId}:source:${url}`),
    title: `${name} source ${index + 1}`,
    url,
    referer: pageUrl,
    origin: new URL(pageUrl).origin,
    country: null,
    vip: false,
  }));
  return {
    id: stableId(`${adapterId}:channel:${pageUrl}`), catId: stableId(`${adapterId}:category:${categoryEn}`), name, nameEn: name,
    image, url: stream, referer: pageUrl, origin: new URL(pageUrl).origin, vpn: false, iran: true, popular: 0, vip: false,
    language: 'fa', country: null, platform: 'INTERNET', satellite: null, frequency: null, polarization: null, symbolRate: null, serviceId: null,
    category, categoryEn, sources,
  };
}

async function discoverSite(indexUrl: string, adapterId: string, pathPattern: RegExp) {
  const indexHtml = await fetchText(indexUrl);
  const anchors = extractAnchors(indexHtml, indexUrl);
  const candidates = Array.from(new Map(
    anchors
      .filter((link) => pathPattern.test(link.href) && link.href !== indexUrl)
      .map((link) => [link.href, link]),
  ).values()).slice(0, envInt('SOURCE_SITE_MAX_CHANNELS', 250, 1, 1000));

  const results: Channel[] = [];
  const concurrency = envInt('SOURCE_SITE_CONCURRENCY', 6, 1, 20);
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const discovered = await Promise.all(batch.map(async (candidate) => {
      try {
        const page = await fetchText(candidate.href);
        const discovery = await discoverMediaSources(candidate.href);
        const streams = unique(discovery.sources.map((source) => source.url));
        if (!streams.length) return null;
        const sourceMetadata = discovery.sources.filter((source, index, all) => all.findIndex((item) => item.url === source.url) === index);
        const channel = siteChannel(candidate.text, candidate.href, streams, htmlImage(page, candidate.href), adapterId);
        channel.sources = sourceMetadata.map((source, index) => ({
          id: stableId(`${adapterId}:source:${source.url}`),
          title: `${candidate.text} source ${index + 1}`,
          url: source.url,
          referer: source.referer || candidate.href,
          origin: source.origin || new URL(candidate.href).origin,
          country: null,
          vip: false,
        }));
        channel.url = channel.sources[0]?.url ?? channel.url;
        channel.referer = channel.sources[0]?.referer ?? channel.referer;
        channel.origin = channel.sources[0]?.origin ?? channel.origin;
        return channel;
      } catch {
        return null;
      }
    }));
    results.push(...discovered.filter((item): item is Channel => Boolean(item)));
  }
  return results;
}

function decryptPayload(text: string) {
  const keyHex = process.env.SOURCE_AES_KEY_HEX?.trim() ?? '';
  const ivHex = process.env.SOURCE_AES_IV_HEX?.trim() ?? '';
  if (!keyHex || !ivHex) throw new Error('mytvsat encrypted source credentials are missing');
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  if (key.length !== 32 || iv.length !== 16) throw new Error('mytvsat AES key must be 32 bytes and IV 16 bytes');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let output = Buffer.concat([decipher.update(Buffer.from(text.trim(), 'base64')), decipher.final()]);
  if (output[0] === 0x1f && output[1] === 0x8b) output = gunzipSync(output);
  return JSON.parse(output.toString('utf8')) as { posts?: RawPost[] } | RawPost[];
}

function normalizePosts(body: { posts?: RawPost[] } | RawPost[]) {
  const posts = Array.isArray(body) ? body : body.posts ?? [];
  return posts.map((post): Channel => ({
    id: post.channel_id, catId: post.category_id, name: post.channel_name, nameEn: post.channel_name_en,
    image: post.channel_image ?? null, url: post.channel_url, referer: post.channel_referer ?? null, origin: post.channel_origin ?? null,
    vpn: Boolean(post.need_vpn), iran: Boolean(post.for_iran), popular: Number(post.popular ?? 0), vip: Boolean(post.isvip),
    language: post.language ?? 'fa', country: post.country ?? null, platform: post.platform ?? 'INTERNET', satellite: post.satellite ?? null,
    frequency: post.frequency ?? null, polarization: post.polarization ?? null, symbolRate: post.symbolRate ?? post.symbol_rate ?? null,
    serviceId: post.serviceId ?? post.service_id ?? post.sid ?? null,
    category: post.category_name ?? '', categoryEn: post.category_name_en ?? '',
    sources: (post.sourses ?? []).map((source) => ({ id: source.ID ?? null, title: source.title ?? null, url: source.channel_url, referer: source.channel_referer ?? null, origin: source.channel_origin ?? null, country: source.country ?? null, vip: Boolean(source.isvip) })),
  }));
}

function parseM3u(text: string, adapterId: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const channels: Channel[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXTINF')) continue;
    const info = lines[i];
    const url = lines[i + 1] && !lines[i + 1].startsWith('#') ? lines[i + 1] : '';
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const name = info.split(',').slice(1).join(',').trim() || 'Unknown Channel';
    const group = info.match(/group-title=["']([^"']*)["']/i)?.[1] || 'Imported TV';
    const logo = info.match(/tvg-logo=["']([^"']*)["']/i)?.[1] || null;
    const satellite = info.match(/(?:satellite|sat)=["']([^"']*)["']/i)?.[1] ?? null;
    const frequency = info.match(/(?:frequency|freq)=["']([^"']*)["']/i)?.[1] ?? null;
    const polarization = info.match(/(?:polarization|pol)=["']([^"']*)["']/i)?.[1] ?? null;
    channels.push({ id: stableId(`${adapterId}:${url}`), catId: stableId(`${adapterId}:group:${group}`), name, nameEn: name, image: logo, url,
      referer: null, origin: null, vpn: false, iran: true, popular: 0, vip: false, language: 'fa', country: null, platform: satellite ? 'SATELLITE' : 'INTERNET',
      satellite, frequency, polarization, symbolRate: null, serviceId: null, category: group, categoryEn: group,
      sources: [{ id: stableId(`${adapterId}:source:${url}`), title: 'M3U', url, referer: null, origin: null, country: null, vip: false }] });
    i++;
  }
  return channels;
}

const myTvSatAdapter: CatalogSourceAdapter = {
  id: 'mytvsat-encrypted', name: 'mytvsat encrypted feed', optional: true,
  isEnabled: () => envFlag('SOURCE_ENCRYPTED_ENABLED', false),
  isConfigured: () => Boolean(process.env.SOURCE_ENCRYPTED_URL?.trim() && process.env.SOURCE_AES_KEY_HEX?.trim() && process.env.SOURCE_AES_IV_HEX?.trim()),
  async fetch() { const url = process.env.SOURCE_ENCRYPTED_URL?.trim(); if (!url) throw new Error('SOURCE_ENCRYPTED_URL is missing'); const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error(`source returned ${response.status}`); return normalizePosts(decryptPayload(await response.text())); },
};

const parsaTvAdapter: CatalogSourceAdapter = {
  id: 'parsatv-public', name: 'ParsaTV public directory', optional: true,
  isEnabled: () => envFlag('SOURCE_PARSATV_ENABLED', true), isConfigured: () => Boolean(process.env.SOURCE_PARSATV_INDEX_URL?.trim()),
  async fetch() { return discoverSite(process.env.SOURCE_PARSATV_INDEX_URL!.trim(), 'parsatv', /parsatv\.com\/name=/i); },
};
const persianTvLiveAdapter: CatalogSourceAdapter = {
  id: 'persiantvlive-public', name: 'PersianTVLive public directory', optional: true,
  isEnabled: () => envFlag('SOURCE_PERSIANTVLIVE_ENABLED', true), isConfigured: () => Boolean(process.env.SOURCE_PERSIANTVLIVE_INDEX_URL?.trim()),
  async fetch() { return discoverSite(process.env.SOURCE_PERSIANTVLIVE_INDEX_URL!.trim(), 'persiantvlive', /persiantvlive\.com\//i); },
};
const pakhshZendeAdapter: CatalogSourceAdapter = {
  id: 'pakhshzende-public', name: 'PakhshZende public directory', optional: true,
  isEnabled: () => envFlag('SOURCE_PAKHSHZENDE_ENABLED', true), isConfigured: () => Boolean(process.env.SOURCE_PAKHSHZENDE_INDEX_URL?.trim()),
  async fetch() { return discoverSite(process.env.SOURCE_PAKHSHZENDE_INDEX_URL!.trim(), 'pakhshzende', /pakhshzende\.com\/tv-channel\//i); },
};

const iranInternationalAdapter: CatalogSourceAdapter = {
  id: 'iran-international-official', name: 'Iran International official live', optional: false,
  isEnabled: () => envFlag('SOURCE_IRANINTL_ENABLED', true),
  isConfigured: () => Boolean((process.env.SOURCE_IRANINTL_LIVE_URL?.trim() || 'https://www.iranintl.com/fa/live').trim()),
  async fetch() {
    const url = process.env.SOURCE_IRANINTL_LIVE_URL?.trim() || 'https://www.iranintl.com/fa/live';
    const channelId = stableId('official:iran-international');
    const categoryId = stableId('official:news');
    return [{
      id: channelId,
      catId: categoryId,
      name: 'Iran International',
      nameEn: 'Iran International',
      image: null,
      url,
      referer: new URL(url).origin,
      origin: new URL(url).origin,
      vpn: false,
      iran: true,
      popular: 0,
      vip: false,
      language: 'fa',
      country: 'UK',
      platform: 'INTERNET',
      satellite: 'Hotbird 13E',
      frequency: '11137 MHz',
      polarization: 'Horizontal',
      symbolRate: '27500',
      serviceId: null,
      category: 'News',
      categoryEn: 'news',
      sources: [{ id: stableId('official:iran-international:source'), title: 'Official Live', url, referer: new URL(url).origin, origin: new URL(url).origin, country: 'UK', vip: false }],
    }];
  },
};

const m3uAdapter: CatalogSourceAdapter = {
  id: 'm3u-import', name: 'M3U playlist importer', optional: true,
  isEnabled: () => envFlag('SOURCE_M3U_ENABLED', true), isConfigured: () => Boolean(process.env.SOURCE_M3U_URLS?.trim()),
  async fetch() { const urls = unique((process.env.SOURCE_M3U_URLS ?? '').split(/[\n,]/).map((v) => v.trim())); const payloads = await Promise.all(urls.map((url) => fetchText(url))); return payloads.flatMap((text) => parseM3u(text, 'm3u-import')); },
};
const officialAdapter: CatalogSourceAdapter = {
  id: 'official-feed', name: 'official broadcaster feed', optional: true,
  isEnabled: () => envFlag('SOURCE_OFFICIAL_ENABLED', true), isConfigured: () => Boolean(process.env.SOURCE_OFFICIAL_URLS?.trim()),
  async fetch() { const urls = unique((process.env.SOURCE_OFFICIAL_URLS ?? '').split(/[\n,]/).map((v) => v.trim())); const payloads = await Promise.all(urls.map((url) => fetchText(url))); return payloads.flatMap((text) => { try { const json = JSON.parse(text) as unknown; if (Array.isArray(json)) return normalizePosts(json as RawPost[]); if (json && typeof json === 'object' && 'posts' in json) return normalizePosts(json as { posts?: RawPost[] }); } catch {} return parseM3u(text, 'official-feed'); }); },
};

export const catalogSourceAdapters: CatalogSourceAdapter[] = [myTvSatAdapter, iranInternationalAdapter, parsaTvAdapter, persianTvLiveAdapter, pakhshZendeAdapter, m3uAdapter, officialAdapter];

export async function fetchCatalogSources(): Promise<CatalogSourceResult[]> {
  const tasks = catalogSourceAdapters.map(async (adapter): Promise<CatalogSourceResult> => {
    if (!adapter.isEnabled()) return { adapter: adapter.id, status: 'disabled', channels: [] };
    if (!adapter.isConfigured()) return { adapter: adapter.id, status: 'unconfigured', channels: [], error: 'Optional source is not configured; source was skipped.' };
    try {
      return { adapter: adapter.id, status: 'ready', channels: await adapter.fetch() };
    } catch (error) {
      return { adapter: adapter.id, status: 'failed', channels: [], error: error instanceof Error ? error.message : 'source fetch failed' };
    }
  });
  return Promise.all(tasks);
}

export async function fetchCatalog(): Promise<Channel[]> {
  const results = await fetchCatalogSources();
  return results.flatMap((result) => result.channels);
}

export function categoriesOf(channels: Channel[]) {
  return Array.from(new Map(channels.map((channel) => [channel.catId, { id: channel.catId, name: channel.category, nameEn: channel.categoryEn }])).values());
}
