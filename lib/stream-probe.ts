import { URL } from 'node:url';

export type StreamProbeVerdict = 'HEALTHY' | 'SUSPECT' | 'BROKEN';
export type StreamProtocol = 'HLS' | 'DASH' | 'DIRECT' | 'UNKNOWN';

export type StreamProbeResult = {
  url: string;
  protocol: StreamProtocol;
  reachable: boolean;
  live: boolean | null;
  buffering: boolean;
  manifestLoaded: boolean;
  mediaLoaded: boolean;
  changedDuringProbe: boolean | null;
  latencyMs: number | null;
  mediaBytes: number | null;
  mediaSequenceBefore: string | null;
  mediaSequenceAfter: string | null;
  contentType: string | null;
  verdict: StreamProbeVerdict;
  score: number;
  reason: string;
  checkedAt: string;
};

type FetchResult = { response: Response; elapsedMs: number };

const TIMEOUT_MS = 7000;
const LIVE_WINDOW_MS = 3200;
const MAX_TEXT_BYTES = 1_500_000;

function timeoutSignal() {
  return AbortSignal.timeout(TIMEOUT_MS);
}

async function timedFetch(url: string, init: RequestInit = {}): Promise<FetchResult> {
  const started = Date.now();
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    redirect: 'follow',
    signal: timeoutSignal(),
    headers: {
      'user-agent': process.env.STREAM_PROBE_USER_AGENT || 'MOMSAT-Stream-Probe/1.0',
      accept: '*/*',
      ...(init.headers || {}),
    },
  });
  return { response, elapsedMs: Date.now() - started };
}

async function readLimitedText(response: Response) {
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer).slice(0, MAX_TEXT_BYTES);
  return new TextDecoder().decode(bytes);
}

function absolute(base: string, value: string) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function detectProtocol(url: string, contentType: string, body: string) {
  const lower = `${url} ${contentType}`.toLowerCase();
  if (body.includes('#EXTM3U') || /\.m3u8(?:$|[?#])/i.test(url) || /mpegurl/.test(lower)) return 'HLS' as const;
  if (/\.mpd(?:$|[?#])/i.test(url) || /dash|application\/dash\+xml/.test(lower) || /<MPD\b/i.test(body)) return 'DASH' as const;
  if (/video\/|audio\/|mpegurl|octet-stream/.test(lower) || /\.(mp4|ts|aac|m4s|webm)(?:$|[?#])/i.test(url)) return 'DIRECT' as const;
  return 'UNKNOWN' as const;
}

function hlsVariant(body: string, baseUrl: string) {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isMaster = lines.some((line) => line.startsWith('#EXT-X-STREAM-INF:'));
  if (!isMaster) return null;
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const next = lines.slice(i + 1).find((line) => !line.startsWith('#'));
    if (next) return absolute(baseUrl, next);
  }
  return null;
}

function hlsDetails(body: string, baseUrl: string) {
  const mediaSequence = body.match(/#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)/i)?.[1] ?? null;
  const segments = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => absolute(baseUrl, line))
    .filter((value): value is string => Boolean(value));
  const endList = /#EXT-X-ENDLIST/i.test(body);
  const live = segments.length > 0 && !endList;
  return { mediaSequence, segments, live };
}

async function probeHls(initialUrl: string, firstBody: string, firstContentType: string, firstLatency: number): Promise<StreamProbeResult> {
  const variant = hlsVariant(firstBody, initialUrl);
  const manifestUrl = variant || initialUrl;
  let mediaBody = firstBody;
  let mediaContentType = firstContentType;
  let latencyMs = firstLatency;
  if (variant) {
    const variantFetch = await timedFetch(variant);
    latencyMs += variantFetch.elapsedMs;
    if (!variantFetch.response.ok) throw new Error(`HLS variant returned HTTP ${variantFetch.response.status}`);
    mediaContentType = variantFetch.response.headers.get('content-type') || firstContentType;
    mediaBody = await readLimitedText(variantFetch.response);
  }

  const before = hlsDetails(mediaBody, manifestUrl);
  const mediaUrl = before.segments.at(-1) || before.segments[0] || null;
  let mediaLoaded = false;
  let mediaBytes: number | null = null;
  if (mediaUrl) {
    try {
      const mediaFetch = await timedFetch(mediaUrl, { headers: { range: 'bytes=0-131071' } });
      latencyMs += mediaFetch.elapsedMs;
      if (mediaFetch.response.ok || mediaFetch.response.status === 206) {
        mediaLoaded = true;
        mediaBytes = (await mediaFetch.response.arrayBuffer()).byteLength;
      }
    } catch {}
  }

  await new Promise((resolve) => setTimeout(resolve, LIVE_WINDOW_MS));
  const secondFetch = await timedFetch(manifestUrl);
  latencyMs += secondFetch.elapsedMs;
  if (!secondFetch.response.ok) throw new Error(`HLS second manifest returned HTTP ${secondFetch.response.status}`);
  const secondBody = await readLimitedText(secondFetch.response);
  const after = hlsDetails(secondBody, manifestUrl);
  const changedDuringProbe = before.mediaSequence !== null && after.mediaSequence !== null
    ? before.mediaSequence !== after.mediaSequence
    : before.segments.at(-1) !== after.segments.at(-1);

  const live = before.live || after.live;
  const buffering = mediaLoaded && mediaBytes !== null && mediaBytes > 0;
  const score = (live ? 35 : 0) + buffering ? 0 : 0;
  const finalScore = (live ? 40 : 0) + (buffering ? 35 : 0) + (changedDuringProbe ? 20 : 0) + (latencyMs < 5000 ? 5 : 0);
  let verdict: StreamProbeVerdict = 'BROKEN';
  if (buffering && live && (changedDuringProbe || after.segments.length >= 2)) verdict = 'HEALTHY';
  else if (buffering || live) verdict = 'SUSPECT';

  return {
    url: initialUrl,
    protocol: 'HLS',
    reachable: true,
    live,
    buffering,
    manifestLoaded: true,
    mediaLoaded,
    changedDuringProbe,
    latencyMs,
    mediaBytes,
    mediaSequenceBefore: before.mediaSequence,
    mediaSequenceAfter: after.mediaSequence,
    contentType: mediaContentType || null,
    verdict,
    score: finalScore,
    reason: verdict === 'HEALTHY'
      ? 'مانيفست زنده دریافت شد، قطعه رسانه قابل دریافت است و جریان در پنجره تست تغییر کرده است.'
      : verdict === 'SUSPECT'
        ? 'استریم قابل دسترس است اما یکی از نشانه‌های زنده بودن یا دریافت رسانه کامل نیست.'
        : 'مانيفست یا قطعه رسانه قابل اجرای قابل اتکا پیدا نشد.',
    checkedAt: new Date().toISOString(),
  };
}

async function probeDash(initialUrl: string, body: string, contentType: string, latencyMs: number): Promise<StreamProbeResult> {
  const dynamic = /type\s*=\s*["']dynamic["']/i.test(body) || /minimumUpdatePeriod/i.test(body);
  const hasSegments = /SegmentTemplate|SegmentTimeline|SegmentList/i.test(body);
  const score = (dynamic ? 45 : 20) + (hasSegments ? 25 : 0) + (latencyMs < 5000 ? 10 : 0);
  const verdict: StreamProbeVerdict = dynamic && hasSegments ? 'HEALTHY' : hasSegments ? 'SUSPECT' : 'BROKEN';
  return {
    url: initialUrl,
    protocol: 'DASH',
    reachable: true,
    live: dynamic,
    buffering: hasSegments,
    manifestLoaded: true,
    mediaLoaded: false,
    changedDuringProbe: null,
    latencyMs,
    mediaBytes: null,
    mediaSequenceBefore: null,
    mediaSequenceAfter: null,
    contentType: contentType || null,
    verdict,
    score,
    reason: verdict === 'HEALTHY'
      ? 'MPD پویا و ساختار segment برای پخش زنده شناسایی شد.'
      : verdict === 'SUSPECT'
        ? 'MPD قابل دسترس است اما زنده بودن یا مسیر قطعات به‌صورت کامل قابل اثبات نیست.'
        : 'ساختار قابل اتکایی برای پخش رسانه‌ای پیدا نشد.',
    checkedAt: new Date().toISOString(),
  };
}

export async function probeStream(url: string): Promise<StreamProbeResult> {
  const normalized = url.trim();
  const checkedAt = new Date().toISOString();
  if (!normalized) throw new Error('Stream URL is empty');
  try {
    const first = await timedFetch(normalized);
    const contentType = first.response.headers.get('content-type') || '';
    const body = await readLimitedText(first.response);
    const protocol = detectProtocol(normalized, contentType, body);
    if (!first.response.ok) throw new Error(`HTTP ${first.response.status}`);
    if (protocol === 'HLS') return await probeHls(normalized, body, contentType, first.elapsedMs);
    if (protocol === 'DASH') return await probeDash(normalized, body, contentType, first.elapsedMs);

    const buffering = first.response.status >= 200 && first.response.status < 400;
    const mediaLike = /video\/|audio\/|octet-stream/.test(contentType.toLowerCase()) || /\.(mp4|ts|aac|webm)(?:$|[?#])/i.test(normalized);
    return {
      url: normalized,
      protocol: protocol === 'UNKNOWN' && mediaLike ? 'DIRECT' : protocol,
      reachable: true,
      live: null,
      buffering,
      manifestLoaded: false,
      mediaLoaded: buffering,
      changedDuringProbe: null,
      latencyMs: first.elapsedMs,
      mediaBytes: buffering ? body.length : null,
      mediaSequenceBefore: null,
      mediaSequenceAfter: null,
      contentType: contentType || null,
      verdict: buffering && mediaLike ? 'SUSPECT' : 'BROKEN',
      score: buffering && mediaLike ? 55 : 20,
      reason: buffering && mediaLike ? 'رسانه مستقیم قابل دسترسی است، اما زنده بودن آن از روی HTTP قابل اثبات نیست.' : 'پاسخ رسانه‌ای قابل اتکا شناسایی نشد.',
      checkedAt,
    };
  } catch (error) {
    return {
      url: normalized,
      protocol: 'UNKNOWN',
      reachable: false,
      live: false,
      buffering: false,
      manifestLoaded: false,
      mediaLoaded: false,
      changedDuringProbe: false,
      latencyMs: null,
      mediaBytes: null,
      mediaSequenceBefore: null,
      mediaSequenceAfter: null,
      contentType: null,
      verdict: 'BROKEN',
      score: 0,
      reason: error instanceof Error ? error.message : 'Stream probe failed',
      checkedAt,
    };
  }
}
