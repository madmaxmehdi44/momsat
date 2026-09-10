import crypto from 'node:crypto';

export type ConfiguredChannel = {
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
  sources: Array<{
    id: number | null;
    title: string | null;
    url: string;
    referer: string | null;
    origin: string | null;
    country: string | null;
    vip: boolean;
  }>;
};

function stableId(input: string) {
  const digest = crypto.createHash('sha1').update(input).digest();
  const value = digest.readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function num(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function bool(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function nullable(value: unknown) {
  const result = text(value);
  return result || null;
}

function normalize(raw: unknown): ConfiguredChannel[] {
  const rows = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { channels?: unknown }).channels)
    ? (raw as { channels: unknown[] }).channels
    : raw && typeof raw === 'object' && Array.isArray((raw as { posts?: unknown }).posts)
      ? (raw as { posts: unknown[] }).posts
      : [];

  return rows.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const name = text(row.name ?? row.channel_name, `Channel ${index + 1}`);
    const nameEn = text(row.nameEn ?? row.channel_name_en, name);
    const url = text(row.url ?? row.channel_url);
    if (!/^https?:\/\//i.test(url)) return [];

    const category = text(row.category ?? row.category_name, 'Persian TV');
    const categoryEn = text(row.categoryEn ?? row.category_name_en, category);
    const channelId = num(row.id ?? row.channel_id, stableId(`configured:${url}`));
    const catId = num(row.catId ?? row.categoryId ?? row.category_id, stableId(`configured:category:${categoryEn}`));

    const rawSources = Array.isArray(row.sources)
      ? row.sources
      : Array.isArray(row.sourses)
        ? row.sourses
        : [];

    const primary = {
      id: null,
      title: 'Primary',
      url,
      referer: text(row.referer ?? row.channel_referer) || null,
      origin: text(row.origin ?? row.channel_origin) || null,
      country: nullable(row.country),
      vip: bool(row.vip ?? row.isvip),
    };

    const sources = [
      primary,
      ...rawSources.flatMap((source) => {
        if (!source || typeof source !== 'object') return [];
        const value = source as Record<string, unknown>;
        const sourceUrl = text(value.url ?? value.channel_url);
        if (!/^https?:\/\//i.test(sourceUrl)) return [];
        return [{
          id: num(value.id ?? value.ID, stableId(`configured:source:${sourceUrl}`)),
          title: text(value.title) || null,
          url: sourceUrl,
          referer: text(value.referer ?? value.channel_referer) || null,
          origin: text(value.origin ?? value.channel_origin) || null,
          country: nullable(value.country),
          vip: bool(value.vip ?? value.isvip),
        }];
      }),
    ];

    const satellite = nullable(row.satellite);
    return [{
      id: channelId,
      catId,
      name,
      nameEn,
      image: text(row.image ?? row.channel_image) || null,
      url,
      referer: primary.referer,
      origin: primary.origin,
      vpn: bool(row.vpn ?? row.need_vpn),
      iran: bool(row.iran ?? row.for_iran),
      popular: num(row.popular),
      vip: bool(row.vip ?? row.isvip),
      language: nullable(row.language) ?? 'fa',
      country: nullable(row.country),
      platform: nullable(row.platform) ?? (satellite ? 'SATELLITE' : 'INTERNET'),
      satellite,
      frequency: nullable(row.frequency ?? row.freq),
      polarization: nullable(row.polarization ?? row.pol),
      symbolRate: nullable(row.symbolRate ?? row.symbol_rate ?? row.sr),
      serviceId: nullable(row.serviceId ?? row.service_id ?? row.sid),
      category,
      categoryEn,
      sources: Array.from(new Map(sources.map((source) => [source.url, source])).values()),
    }];
  });
}

export async function fetchConfiguredCatalog(): Promise<ConfiguredChannel[]> {
  const url = process.env.SOURCE_JSON_URL?.trim();
  if (!url) return [];

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { 'user-agent': process.env.SOURCE_HTTP_USER_AGENT || 'MomSatCatalog/1.0' },
    signal: AbortSignal.timeout(Number(process.env.SOURCE_FETCH_TIMEOUT_MS || 15000)),
  });
  if (!response.ok) throw new Error(`SOURCE_JSON_URL returned ${response.status}`);

  const payload = await response.json();
  return normalize(payload);
}
