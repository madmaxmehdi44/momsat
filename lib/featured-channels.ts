import crypto from 'node:crypto';
import type { Channel } from './source';

function stableId(input: string) {
  const digest = crypto.createHash('sha1').update(input).digest();
  const value = digest.readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
}

const iranInternationalSources = [
  {
    id: stableId('featured:iran-international:akamai'),
    title: 'Direct HLS',
    url: 'https://hlspackager.akamaized.net/live/DB/IRAN_INTERNATIONAL/HLS/IRAN_INTERNATIONAL.m3u8',
    referer: null,
    origin: null,
    country: 'UK',
    vip: false,
  },
  {
    id: stableId('featured:iran-international:livetvstream'),
    title: 'Fallback HLS',
    url: 'https://live.livetvstream.co.uk/LS-63503-4/index.m3u8',
    referer: null,
    origin: null,
    country: 'UK',
    vip: false,
  },
  {
    id: stableId('featured:iran-international:official'),
    title: 'Official web player',
    url: 'https://www.iranintl.com/fa/live',
    referer: null,
    origin: 'https://www.iranintl.com',
    country: 'UK',
    vip: false,
  },
];

export const featuredChannels: Channel[] = [
  {
    id: stableId('featured:iran-international'),
    catId: stableId('featured:news'),
    name: 'Iran International',
    nameEn: 'Iran International',
    image: null,
    url: iranInternationalSources[0].url,
    referer: null,
    origin: null,
    vpn: false,
    iran: true,
    popular: 100,
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
    sources: iranInternationalSources,
  },
];

export function mergeFeaturedChannels(channels: Channel[]) {
  const featuredByName = new Map(featuredChannels.map((channel) => [channel.nameEn.toLowerCase(), channel]));
  const result = channels.map((channel) => {
    const featured = featuredByName.get(channel.nameEn.toLowerCase()) ?? featuredByName.get(channel.name.toLowerCase());
    if (!featured) return channel;
    return {
      ...channel,
      image: channel.image || featured.image,
      url: featured.url,
      referer: featured.referer,
      origin: featured.origin,
      platform: featured.platform,
      satellite: channel.satellite || featured.satellite,
      frequency: channel.frequency || featured.frequency,
      polarization: channel.polarization || featured.polarization,
      symbolRate: channel.symbolRate || featured.symbolRate,
      sources: Array.from(new Map([...featured.sources, ...channel.sources].map((source) => [source.url, source])).values()),
    };
  });

  if (result.some((channel) => channel.nameEn.toLowerCase() === 'iran international')) return result;
  return [...result, ...featuredChannels];
}
