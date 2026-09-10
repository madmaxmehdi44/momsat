const STOPWORDS = new Set([
  'hd', 'fhd', 'uhd', 'sd', '4k', '1080p', '720p', '576p', '480p',
  'live', 'tv', 'channel', 'online', 'stream', 'official', 'free',
]);

const ALIASES: Record<string, string> = {
  'mbc persia': 'mbc persia',
  'mbc فارسی': 'mbc persia',
  'mbc پرشیا': 'mbc persia',
  'iran international': 'iran international',
  'ایران اینترنشنال': 'iran international',
  'persian bbc': 'bbc persian',
  'bbc فارسی': 'bbc persian',
  'بی بی سی فارسی': 'bbc persian',
};

export type MatchableChannel = {
  id: number;
  name: string;
  nameEn: string;
  catalogKey: string | null;
  url: string;
};

export type ChannelMatch = {
  channel: MatchableChannel | null;
  score: number;
  reason: string;
};

function fold(value: unknown) {
  return String(value ?? '').normalize('NFKC')
    .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/\u200c/g, ' ')
    .replace(/[\u064B-\u065F]/g, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .toLowerCase()
    .replace(/[._/\\|:+#@()[\]{}'\"`]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeChannelName(value: unknown) {
  const base = fold(value);
  const aliased = ALIASES[base] || base;
  return aliased
    .replace(/\b\b(?:plus|extra|backup|test)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: unknown) {
  return normalizeChannelName(value).split(' ').filter(Boolean);
}

function semanticTokens(value: unknown) {
  return tokens(value).filter((token) => !STOPWORDS.has(token));
}

function exactUrl(a: string, b: string) {
  try {
    const left = new URL(a);
    const right = new URL(b);
    left.hash = '';
    right.hash = '';
    left.hostname = left.hostname.toLowerCase();
    right.hostname = right.hostname.toLowerCase();
    return left.toString().replace(/\/+$/, '') === right.toString().replace(/\/+$/, '');
  } catch {
    return a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '');
  }
}

function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const left = new Set(semanticTokens(a));
  const right = new Set(semanticTokens(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function hasDistinguishingSuffix(name: string) {
  const value = normalizeChannelName(name);
  return /\b(series|سریال|sport|sports|music|news|kids|movie|movies|cinema|entertainment|tv|plus|24|one|two|1|2|3)\b/.test(value);
}

export function matchChannel(
  incoming: { name: string; nameEn: string; tvgId?: string | null; url: string },
  existing: MatchableChannel[],
): ChannelMatch {
  const incomingNames = [normalizeChannelName(incoming.name), normalizeChannelName(incoming.nameEn)].filter(Boolean);
  const incomingId = normalizeChannelName(incoming.tvgId || '');

  let best: { channel: MatchableChannel; score: number; reason: string } | null = null;
  let secondBest = 0;

  for (const channel of existing) {
    let score = 0;
    let reason = 'name similarity';
    const existingNames = [normalizeChannelName(channel.name), normalizeChannelName(channel.nameEn)].filter(Boolean);
    const existingIds = [normalizeChannelName(channel.catalogKey || '')].filter(Boolean);

    if (exactUrl(incoming.url, channel.url)) {
      score = 1;
      reason = 'exact stream URL';
    } else if (incomingId && existingIds.some((id) => id.endsWith(incomingId) || incomingId.endsWith(id))) {
      score = 0.98;
      reason = 'tvg-id/catalog key';
    } else {
      for (const left of incomingNames) {
        for (const right of existingNames) {
          score = Math.max(score, similarity(left, right));
        }
      }
      if (score >= 0.92) reason = 'near-exact normalized name';
      else if (score >= 0.82) reason = 'strong token/name similarity';
    }

    if (hasDistinguishingSuffix(incoming.name) && hasDistinguishingSuffix(channel.name)) {
      const incomingValue = normalizeChannelName(incoming.name);
      const existingValue = normalizeChannelName(channel.name);
      const suffixes = ['series', 'سریال', 'sport', 'sports', 'music', 'news', 'kids', 'movie', 'movies', 'cinema', 'entertainment', 'plus'];
      const incomingSuffix = suffixes.find((suffix) => incomingValue.includes(suffix));
      const existingSuffix = suffixes.find((suffix) => existingValue.includes(suffix));
      if (incomingSuffix && existingSuffix && incomingSuffix !== existingSuffix) score = Math.min(score, 0.45);
    }

    if (!best || score > best.score) {
      secondBest = best?.score || 0;
      best = { channel, score, reason };
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (!best) return { channel: null, score: 0, reason: 'no candidates' };
  const confident = best.score >= 0.9 || (best.score >= 0.82 && best.score - secondBest >= 0.08);
  return confident
    ? { channel: best.channel, score: best.score, reason: best.reason }
    : { channel: null, score: best.score, reason: `ambiguous match (${best.score.toFixed(2)}, runner-up ${secondBest.toFixed(2)})` };
}
