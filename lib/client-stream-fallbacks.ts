export type ClientStreamFallback = {
  channelName: string;
  sources: Array<{
    title: string;
    url: string;
    referer?: string | null;
    origin?: string | null;
    country?: string | null;
    vip?: boolean;
  }>;
};

export const clientStreamFallbacks: ClientStreamFallback[] = [
  {
    channelName: 'Iran International',
    sources: [
      {
        title: 'Direct HLS',
        url: 'https://hlspackager.akamaized.net/live/DB/IRAN_INTERNATIONAL/HLS/IRAN_INTERNATIONAL.m3u8',
        country: 'UK',
        vip: false,
      },
      {
        title: 'Fallback HLS',
        url: 'https://live.livetvstream.co.uk/LS-63503-4/index.m3u8',
        country: 'UK',
        vip: false,
      },
      {
        title: 'Official web player',
        url: 'https://www.iranintl.com/fa/live',
        origin: 'https://www.iranintl.com',
        country: 'UK',
        vip: false,
      },
    ],
  },
];

export function getClientStreamFallback(channelName: string | undefined) {
  if (!channelName) return null;
  const normalized = channelName.trim().toLowerCase();
  return clientStreamFallbacks.find((item) => item.channelName.toLowerCase() === normalized) ?? null;
}
