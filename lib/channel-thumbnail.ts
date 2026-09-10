const THUMBNAILS: Array<{ test: RegExp; url: string }> = [
  {
    test: /iran\s*international|ایران\s*اینترنشنال/i,
    url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Iran_International_logo_2021_en.svg',
  },
  {
    test: /mbc\s*persia|ام\s*بی\s*سی\s*پرشیا/i,
    url: 'https://www.sedaye-iran.online/assets/images/emblems/tv/mbc-persia-tv.webp',
  },
  {
    test: /^pmc$|persian\s*music\s*channel|پی\s*ام\s*سی/i,
    url: 'https://www.sedaye-iran.online/assets/images/emblems/tv/pmc.webp',
  },
  {
    test: /gem\s*series|gemseries|جم\s*سریال/i,
    url: 'https://www.gemgroup.tv/assets/images/channels/icon_32.png',
  },
  {
    test: /^gem\s*tv$|gemtv|جم\s*تی\s*وی/i,
    url: 'https://commons.wikimedia.org/wiki/Special:FilePath/Gem_TV_logo_2020.png',
  },
];

export function getChannelThumbnail(name?: string | null): string | null {
  const value = name?.trim();
  if (!value) return null;
  return THUMBNAILS.find((entry) => entry.test.test(value))?.url ?? null;
}

export function ensureChannelThumbnail(name: string | null | undefined, image: string | null | undefined): string | null {
  const existing = image?.trim();
  return existing || getChannelThumbnail(name) || null;
}
