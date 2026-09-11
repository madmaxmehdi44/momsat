import crypto from 'node:crypto';
import type { Channel } from './source';
import { ensureChannelThumbnail } from './channel-thumbnail';

function stableId(input: string) {
  const digest = crypto.createHash('sha1').update(input).digest();
  const value = digest.readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
}

type FeaturedSource = Channel['sources'][number];

type FeaturedDefinition = {
  id: string;
  name: string;
  nameEn: string;
  category: string;
  categoryEn: string;
  country: string;
  platform: string;
  satellite: string | null;
  frequency: string | null;
  polarization: string | null;
  symbolRate: string | null;
  sources: FeaturedSource[];
};

function source(key: string, title: string, url: string, country = 'AE', origin: string | null = null, referer: string | null = origin): FeaturedSource {
  return {
    id: stableId(`featured:${key}`),
    title,
    url,
    referer,
    origin,
    country,
    vip: false,
  };
}

export const featuredSpotlightOrder = [
  'Fun Plus',
  'Iran International',
  'GEM Series',
  'MBC Persia',
  'VOA Persian',
  'BBC Persian',
  'PMC',
  'Manoto',
  'Tapesh',
  'Caltex Music',
  'Radio Farda',
] as const;

const definitions: FeaturedDefinition[] = [
  {
    id: 'iran-international', name: 'Iran International', nameEn: 'Iran International', category: 'News', categoryEn: 'news', country: 'UK', platform: 'SATELLITE + INTERNET',
    satellite: 'Hotbird 13E', frequency: '11137 MHz', polarization: 'Horizontal', symbolRate: '27500',
    sources: [
      source('iran-international:akamaized', 'Direct HLS', 'https://hlspackager.akamaized.net/live/DB/IRAN_INTERNATIONAL/HLS/IRAN_INTERNATIONAL.m3u8', 'UK'),
      source('iran-international:livestream', 'Fallback HLS', 'https://live.livetvstream.co.uk/LS-63503-4/index.m3u8', 'UK'),
      source('iran-international:official', 'Official web player', 'https://www.iranintl.com/fa/live', 'UK', 'https://www.iranintl.com', 'https://www.iranintl.com'),
    ],
  },
  {
    id: 'voa-persian', name: 'VOA Persian', nameEn: 'VOA Persian', category: 'News', categoryEn: 'news', country: 'US', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [
      source('voa-persian:akamaized', 'Direct HLS', 'https://voa-ingest.akamaized.net/hls/live/2033876/tvmc07/playlist.m3u8', 'US'),
    ],
  },
  {
    id: 'bbc-persian', name: 'BBC Persian', nameEn: 'BBC Persian', category: 'News', categoryEn: 'news', country: 'UK', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [
      source('bbc-persian:akamaized', 'Direct HLS HD', 'https://vs-hls-pushb-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_persian_tv/pc_hd_abr_v2.m3u8', 'UK'),
      source('bbc-persian:bbci', 'BBC CDN fallback', 'https://vs-hls-pushb-ww.live.cf.md.bbci.co.uk/x=4/i=urn:bbc:pips:service:bbc_persian_tv/pc_hd_abr_v2.m3u8', 'UK'),
      source('bbc-persian:mobile', 'Mobile HD fallback', 'https://vs-hls-pushb-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_persian_tv/mobile_wifi_main_hd_abr_v2.m3u8', 'UK'),
    ],
  },
  {
    id: 'mbc-persia', name: 'MBC Persia', nameEn: 'MBC Persia', category: 'Movies & Series', categoryEn: 'movies-series', country: 'UAE', platform: 'SATELLITE + INTERNET',
    satellite: 'Eutelsat 7/8W family', frequency: null, polarization: null, symbolRate: null,
    sources: [
      source('mbc-persia:edgenext', 'Direct HLS 1080p', 'https://shd-gcp-live.edgenextcdn.net/live/bitmovin-mbc-persia/818ee8e4b592dc497608f066d825bfb4/index.m3u8'),
      source('mbc-persia:hls', 'Direct HLS 720p', 'https://hls.mbcpersia.live/hls/stream.m3u8'),
    ],
  },
  {
    id: 'pmc', name: 'PMC', nameEn: 'PMC', category: 'Music', categoryEn: 'music', country: 'UK', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [source('pmc:hls', 'Direct HLS', 'https://hls.pmchd.live/hls/stream.m3u8', 'UK')],
  },
  {
    id: 'gem-series', name: 'GEM Series', nameEn: 'GEM Series', category: 'Movies & Series', categoryEn: 'movies-series', country: 'Turkey', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [
      source('gem-series:current-list', 'Direct HLS', 'http://65.21.196.79/gem_series/master.m3u8', 'TR', 'https://www.gemonline.tv', 'https://www.gemonline.tv/en-US/Live/Index?channelname=gemseries'),
      source('gem-series:parsatv', 'ParsaTV player', 'https://www.parsatv.com/name%3DGEM-Series', 'IR', 'https://www.parsatv.com', 'https://www.parsatv.com'),
      source('gem-series:legacy-cloudfront', 'Legacy HLS', 'https://d2e40kvaojifd6.cloudfront.net/stream/gem_series/playlist_1920x1080_4500k.m3u8', 'TR'),
    ],
  },
  {
    id: 'gem-tv', name: 'GEM TV', nameEn: 'GEM TV', category: 'Entertainment', categoryEn: 'entertainment', country: 'Turkey', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [
      source('gem-tv:current-list', 'Direct HLS', 'http://65.21.196.79/gem_tv/master.m3u8', 'TR', 'https://www.gemonline.tv', 'https://www.gemonline.tv/en-US/Live/Index?channelname=gemtv'),
      source('gem-tv:parsatv', 'ParsaTV player', 'https://www.parsatv.com/name%3DGEM-TV', 'IR', 'https://www.parsatv.com', 'https://www.parsatv.com'),
      source('gem-tv:legacy-cloudfront', 'Legacy HLS', 'https://d2e40kvaojifd6.cloudfront.net/stream/gem_tv/playlist_1920x1080_4500k.m3u8', 'TR'),
    ],
  },
  {
    id: 'manoto', name: 'Manoto', nameEn: 'Manoto', category: 'Entertainment', categoryEn: 'entertainment', country: 'UK', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [source('manoto:cloudfront', 'Direct HLS', 'https://d2rwmwucnr0d10.cloudfront.net/live.m3u8', 'UK')],
  },
  {
    id: 'tapesh', name: 'Tapesh', nameEn: 'Tapesh', category: 'Music', categoryEn: 'music', country: 'US', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [source('tapesh:hls', 'Direct HLS', 'http://iptv.tapesh.tv/tapesh/playlist1/index.m3u8', 'US')],
  },
  {
    id: 'caltex-music', name: 'Caltex Music', nameEn: 'Caltex Music', category: 'Music', categoryEn: 'music', country: 'US', platform: 'SATELLITE + INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [source('caltex:music', 'Direct HLS', 'http://vid1.caltexmusic.com/hls/caltextv.m3u8', 'US')],
  },
  {
    id: 'radio-farda', name: 'Radio Farda', nameEn: 'Radio Farda TV', category: 'News', categoryEn: 'news', country: 'US', platform: 'INTERNET',
    satellite: null, frequency: null, polarization: null, symbolRate: null,
    sources: [source('radio-farda:akamaized', 'Direct HLS', 'https://rfe-lh.akamaihd.net/i/rfe_tvmc1@383622/index_0540_av-b.m3u8', 'US')],
  },
];

export const featuredChannels: Channel[] = definitions.map((definition, index) => ({
  id: stableId(`featured:${definition.id}`),
  catId: stableId(`featured:${definition.categoryEn}`),
  name: definition.name,
  nameEn: definition.nameEn,
  image: ensureChannelThumbnail(definition.nameEn, null),
  url: definition.sources[0]?.url ?? '',
  referer: definition.sources[0]?.referer ?? null,
  origin: definition.sources[0]?.origin ?? null,
  vpn: false,
  iran: false,
  popular: 100 - index,
  vip: false,
  language: 'fa',
  country: definition.country,
  platform: definition.platform,
  satellite: definition.satellite,
  frequency: definition.frequency,
  polarization: definition.polarization,
  symbolRate: definition.symbolRate,
  serviceId: null,
  category: definition.category,
  categoryEn: definition.categoryEn,
  sources: definition.sources,
}));

export function mergeFeaturedChannels(channels: Channel[]) {
  const featuredByName = new Map(featuredChannels.flatMap(channel => [
    [channel.nameEn.toLowerCase(), channel] as const,
    [channel.name.toLowerCase(), channel] as const,
  ]));

  const result = channels.map((channel) => {
    const featured = featuredByName.get(channel.nameEn.toLowerCase()) ?? featuredByName.get(channel.name.toLowerCase());
    if (!featured) return {
      ...channel,
      image: ensureChannelThumbnail(channel.nameEn || channel.name, channel.image),
    };
    return {
      ...channel,
      image: ensureChannelThumbnail(channel.nameEn || channel.name, channel.image || featured.image),
      url: featured.url || channel.url,
      referer: featured.referer ?? channel.referer,
      origin: featured.origin ?? channel.origin,
      platform: featured.platform,
      satellite: channel.satellite || featured.satellite,
      frequency: channel.frequency || featured.frequency,
      polarization: channel.polarization || featured.polarization,
      symbolRate: channel.symbolRate || featured.symbolRate,
      sources: Array.from(new Map([...featured.sources, ...channel.sources].map(source => [source.url, source])).values()),
    };
  });

  const existing = new Set(result.flatMap(channel => [channel.nameEn.toLowerCase(), channel.name.toLowerCase()]));
  return [...result, ...featuredChannels.filter(channel => channel.sources.length > 0 && !existing.has(channel.nameEn.toLowerCase()) && !existing.has(channel.name.toLowerCase()))];
}
