import type { Channel } from './source';

export function catalogRankScore(channel: Channel) {
  const popularity = Math.max(0, Math.min(100, Number(channel.popular) || 0));
  const sourceCount = Math.min(6, channel.sources?.length ?? 0);
  const sourceScore = sourceCount * 7;
  const vipScore = channel.vip ? 8 : 0;
  const satelliteScore = channel.satellite ? 5 : 0;
  const internationalScore = !channel.iran || Boolean(channel.country && channel.country.toLowerCase() !== 'iran' && channel.country !== 'ایران') ? 3 : 0;
  return popularity * 0.72 + sourceScore + vipScore + satelliteScore + internationalScore;
}

export function rankCatalogChannels(channels: Channel[]) {
  return [...channels].sort((a, b) => catalogRankScore(b) - catalogRankScore(a) || b.popular - a.popular || (b.sources?.length ?? 0) - (a.sources?.length ?? 0) || a.name.localeCompare(b.name, 'fa'));
}
