import dns from 'node:dns/promises';
import net from 'node:net';

export type DiscoveredMediaSource = {
  url: string;
  referer: string | null;
  origin: string | null;
  discoveredFrom: string;
  depth: number;
};

export type WebDiscoveryResult = {
  requestedUrl: string;
  sources: DiscoveredMediaSource[];
  visitedPages: string[];
  errors: string[];
};

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

function isPrivateIp(value: string) {
  const version = net.isIP(value);
  if (version === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  if (version === 6) {
    const normalized = value.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

export async function isSafePublicUrl(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return false;

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.local') || PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return false;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);

  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.length > 0 && records.every((record) => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

function envInt(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function decode(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\\\//g, '/');
}

function absoluteUrl(value: string, base: string) {
  const cleaned = decode(value.trim()).replace(/^['"]|['"]$/g, '');
  try {
    const url = new URL(cleaned, base);
    return /^https?:$/i.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function looksLikeMediaUrl(value: string) {
  const url = value.toLowerCase();
  return /(?:\.m3u8(?:$|[?#])|\.mp4(?:$|[?#])|\.webm(?:$|[?#])|\.m4v(?:$|[?#])|\/playlist(?:[/?#]|$)|\/manifest(?:[/?#]|$)|\/stream(?:[/?#]|$)|[?&](?:file|source|src|stream|playlist|manifest)=)/i.test(url);
}

function extractAttributeValues(html: string, attribute: string) {
  const values: string[] = [];
  const pattern = new RegExp(`${attribute}\\s*=\\s*(["'])(.*?)\\1`, 'gis');
  for (const match of html.matchAll(pattern)) values.push(match[2]);
  return values;
}

function extractUrlLiterals(html: string) {
  const values: string[] = [];
  const patterns = [
    /https?:\/\/[^"'`\s<>]+/gi,
    /(?:file|src|source|url|streamUrl|playlist|manifest|hls|dash|media)\s*[:=]\s*["'`]([^"'`\s]+)["'`]/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) values.push(match[1] ?? match[0]);
  }
  return values;
}

function extractPageCandidates(html: string, pageUrl: string) {
  const candidates = new Set<string>();
  for (const attribute of ['src', 'data-src', 'data-url', 'data-file', 'data-stream', 'data-playlist', 'data-hls']) {
    for (const value of extractAttributeValues(html, attribute)) {
      const absolute = absoluteUrl(value, pageUrl);
      if (absolute && /(?:iframe|player|embed|video|live)/i.test(absolute) && !looksLikeMediaUrl(absolute)) candidates.add(absolute);
    }
  }
  return Array.from(candidates);
}

function extractMediaCandidates(html: string, pageUrl: string) {
  const candidates = new Set<string>();
  const values = [
    ...extractAttributeValues(html, 'src'),
    ...extractAttributeValues(html, 'data-src'),
    ...extractAttributeValues(html, 'data-url'),
    ...extractAttributeValues(html, 'data-file'),
    ...extractAttributeValues(html, 'data-stream'),
    ...extractAttributeValues(html, 'data-playlist'),
    ...extractAttributeValues(html, 'data-hls'),
    ...extractAttributeValues(html, 'file'),
    ...extractAttributeValues(html, 'source'),
    ...extractUrlLiterals(html),
  ];

  for (const value of values) {
    const absolute = absoluteUrl(value, pageUrl);
    if (absolute && looksLikeMediaUrl(absolute)) candidates.add(absolute);
  }

  return Array.from(candidates);
}

async function fetchHtml(url: string) {
  const timeout = envInt('SOURCE_WEB_FETCH_TIMEOUT_MS', 12000, 2000, 60000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': process.env.SOURCE_HTTP_USER_AGENT || 'MomSatWebSourceExtractor/1.0',
      },
    });
    if (!response.ok) throw new Error(`${response.status} from ${url}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html|xhtml|text\//i.test(contentType)) throw new Error(`non-html content from ${url}`);
    return { url: response.url || url, html: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverMediaSources(initialUrl: string): Promise<WebDiscoveryResult> {
  const requestedUrl = initialUrl.trim();
  const result: WebDiscoveryResult = { requestedUrl, sources: [], visitedPages: [], errors: [] };
  if (!(await isSafePublicUrl(requestedUrl))) {
    result.errors.push('Blocked or invalid discovery URL.');
    return result;
  }

  const maxDepth = envInt('SOURCE_WEB_DISCOVERY_MAX_DEPTH', 3, 0, 6);
  const maxPages = envInt('SOURCE_WEB_DISCOVERY_MAX_PAGES', 18, 1, 50);
  const queue: Array<{ url: string; parentUrl: string | null; depth: number }> = [{ url: requestedUrl, parentUrl: null, depth: 0 }];
  const visited = new Set<string>();
  const seenMedia = new Set<string>();

  while (queue.length > 0 && result.visitedPages.length < maxPages) {
    const current = queue.shift()!;
    if (current.depth > maxDepth) continue;
    const canonical = current.url.split('#')[0];
    if (visited.has(canonical)) continue;
    visited.add(canonical);

    try {
      const page = await fetchHtml(current.url);
      const currentUrl = page.url;
      result.visitedPages.push(currentUrl);
      const referer = current.parentUrl || currentUrl;
      const origin = (() => { try { return new URL(currentUrl).origin; } catch { return null; } })();

      for (const mediaUrl of extractMediaCandidates(page.html, currentUrl)) {
        if (!(await isSafePublicUrl(mediaUrl))) continue;
        if (seenMedia.has(mediaUrl)) continue;
        seenMedia.add(mediaUrl);
        result.sources.push({ url: mediaUrl, referer, origin, discoveredFrom: currentUrl, depth: current.depth });
      }

      if (current.depth < maxDepth) {
        for (const pageUrl of extractPageCandidates(page.html, currentUrl)) {
          if (!(await isSafePublicUrl(pageUrl))) continue;
          if (!visited.has(pageUrl)) queue.push({ url: pageUrl, parentUrl: currentUrl, depth: current.depth + 1 });
        }
      }
    } catch (error) {
      result.errors.push(`${current.url}: ${error instanceof Error ? error.message : 'discovery failed'}`);
    }
  }

  result.sources.sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  return result;
}
