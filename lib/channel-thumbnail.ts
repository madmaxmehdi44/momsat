import { fallbackChannelThumbnail } from './fallback-thumbnail';

const THUMBNAILS: Array<{ test: RegExp; url: string }> = [
  {
    test: /iran\s*international|ایران\s*اینترنشنال/i,
    url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Iran_International_logo_2021_en.svg',
  },
  {
    test: /mbc\s*persia|ام\s*بی\s*سی\s*پرشیا/i,
    url: 'https://www.persianity.com/thumb.php?h=506&src=https%3A%2F%2Fwww.irtv.website%2Findex_files%2Fchannels%2Fmbcpersia.png&w=900',
  },
  {
    test: /^pmc$|persian\s*music\s*channel|پی\s*ام\s*سی/i,
    url: 'https://www.sedaye-iran.online/assets/images/emblems/tv/pmc.webp',
  },
  {
    test: /gem\s*series|gemseries|جم\s*سریال/i,
    url: 'https://www.persianity.com/thumb.php?h=506&src=https%3A%2F%2Fwww.irtv.website%2Findex_files%2Fchannels%2Fgemseries.png&w=900',
  },
  {
    test: /^gem\s*tv$|gemtv|جم\s*تی\s*وی/i,
    url: 'https://www.sedaye-iran.online/assets/images/emblems/tv/gem-tv.webp',
  },
];

export function getChannelThumbnail(name?: string | null): string | null {
  const value = name?.trim();
  if (!value) return null;
  return THUMBNAILS.find((entry) => entry.test.test(value))?.url ?? null;
}

export function ensureChannelThumbnail(name: string | null | undefined, image: string | null | undefined): string | null {
  const value = name?.trim() || 'MOMSAT';
  const existing = image?.trim();

  // Preserve any valid URL/data/blob image supplied by the catalog.
  if (existing && /^(https?:|data:|blob:|\/)/i.test(existing)) return existing;

  return getChannelThumbnail(value) || fallbackChannelThumbnail(value);
}
