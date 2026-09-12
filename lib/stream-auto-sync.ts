import { prisma } from './prisma';
import { fetchCatalogSources } from './source';
import { matchChannel, type MatchableChannel } from './channel-match';
import { probeStream, type StreamProbeResult } from './stream-probe';
import { reportStreamFailure, reportStreamSuccess } from './stream-health';
import { invalidateCatalogCache } from './catalog-db';

type CandidateSource = {
  url: string;
  referer: string | null;
  origin: string | null;
  title: string | null;
  country: string | null;
  vip: boolean;
};

type CandidateChannel = {
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
  sources: CandidateSource[];
};

type ExistingChannel = MatchableChannel & {
  categoryId: number;
  archiveStatus: string | null;
  image: string | null;
  referer: string | null;
  origin: string | null;
  vpn: boolean;
  iran: boolean;
  popular: bigint;
  vip: boolean;
  language: string | null;
  country: string | null;
  platform: string | null;
  satellite: string | null;
  frequency: string | null;
  polarization: string | null;
  symbolRate: string | null;
  serviceId: string | null;
  categoryName: string | null;
  categoryNameEn: string | null;
  sources: CandidateSource[];
};

type SyncStats = {
  discovered: number;
  candidates: number;
  checked: number;
  healthy95: number;
  created: number;
  updated: number;
  unchanged: number;
  skippedBelow95: number;
  duplicateChannels: number;
  sourcesAdded: number;
  sourcesSkipped: number;
  broken: number;
  suspect: number;
  sourceErrors: number;
  durationMs: number;
};

type RankedProbe = StreamProbeResult & {
  candidate: CandidateChannel;
  source: CandidateSource;
};

const AUTO_SYNC_THRESHOLD = Math.max(95, Math.min(100, Number(process.env.STREAM_AUTO_SYNC_THRESHOLD || 95)));
const AUTO_SYNC_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.STREAM_AUTO_SYNC_CONCURRENCY || 8)));
const MAX_SOURCES_PER_CHANNEL = Math.max(1, Math.min(8, Number(process.env.STREAM_AUTO_SYNC_MAX_SOURCES_PER_CHANNEL || 4)));
const MAX_CANDIDATES = Math.max(1, Math.min(2500, Number(process.env.STREAM_AUTO_SYNC_MAX_CANDIDATES || 1000)));

function cleanUrl(url: string | null | undefined) {
  return typeof url === 'string' ? url.trim() : '';
}

function sameUrl(a: string | null | undefined, b: string | null | undefined) {
  const left = cleanUrl(a).replace(/\/+$/, '').toLowerCase();
  const right = cleanUrl(b).replace(/\/+$/, '').toLowerCase();
  if (!left || !right) return false;
  try {
    const l = new URL(left);
    const r = new URL(right);
    l.hash = '';
    r.hash = '';
    l.hostname = l.hostname.toLowerCase();
    r.hostname = r.hostname.toLowerCase();
    return l.toString().replace(/\/+$/, '') === r.toString().replace(/\/+$/, '');
  } catch {
    return left === right;
  }
}

function uniqueSources(candidate: CandidateChannel) {
  const all = [
    {
      url: candidate.url,
      referer: candidate.referer,
      origin: candidate.origin,
      title: 'Primary',
      country: candidate.country,
      vip: candidate.vip,
    },
    ...(candidate.sources || []),
  ];
  return Array.from(new Map(all.filter((source) => cleanUrl(source.url)).map((source) => [cleanUrl(source.url).toLowerCase(), { ...source, url: cleanUrl(source.url) }])).values());
}

function sourceKey(channelId: number, url: string) {
  return `${channelId}|${cleanUrl(url).toLowerCase()}`;
}

function candidateKey(channel: CandidateChannel) {
  return `${channel.id}|${cleanUrl(channel.nameEn || channel.name).toLowerCase()}`;
}

async function loadExistingChannels() {
  return prisma.channel.findMany({
    select: {
      id: true,
      name: true,
      nameEn: true,
      catalogKey: true,
      url: true,
      categoryId: true,
      archiveStatus: true,
      image: true,
      referer: true,
      origin: true,
      vpn: true,
      iran: true,
      popular: true,
      vip: true,
      language: true,
      country: true,
      platform: true,
      satellite: true,
      frequency: true,
      polarization: true,
      symbolRate: true,
      serviceId: true,
      categoryName: true,
      categoryNameEn: true,
      sources: { select: { id: true, title: true, url: true, referer: true, origin: true, country: true, vip: true } },
    },
    orderBy: { id: 'asc' },
  });
}

async function allocateChannelId(preferred: number, key: string) {
  let id = Number.isInteger(preferred) && preferred > 0 ? preferred : stableIntId(key);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const existing = await prisma.channel.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return id;
    id = stableIntId(`${key}:${attempt + 1}`);
  }
  throw new Error(`Unable to allocate a channel id for ${key}`);
}

function stableIntId(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) & 0x7fffffff || 1;
}

async function allocateSourceId(preferred: number | null, key: string) {
  let id = Number.isInteger(preferred) && Number(preferred) > 0 ? Number(preferred) : stableIntId(key);
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const existing = await prisma.source.findUnique({ where: { id }, select: { channelId: true } });
    if (!existing) return id;
    id = stableIntId(`${key}:${attempt + 1}`);
  }
  throw new Error(`Unable to allocate a source id for ${key}`);
}

async function ensureCategory(candidate: CandidateChannel) {
  await prisma.category.upsert({
    where: { id: candidate.catId || 1 },
    update: { name: candidate.category || 'Persian TV', nameEn: candidate.categoryEn || candidate.category || 'persian-tv' },
    create: { id: candidate.catId || 1, name: candidate.category || 'Persian TV', nameEn: candidate.categoryEn || candidate.category || 'persian-tv' },
  });
  return candidate.catId || 1;
}

async function addSource(channelId: number, source: CandidateSource, channelKey: string, stats: SyncStats) {
  const url = cleanUrl(source.url);
  if (!url) return false;
  const duplicate = await prisma.source.findFirst({ where: { channelId, url } });
  if (duplicate) {
    stats.sourcesSkipped += 1;
    return false;
  }
  const id = await allocateSourceId(null, `${channelKey}:source:${url}`);
  await prisma.source.create({
    data: {
      id,
      channelId,
      title: source.title,
      url,
      referer: source.referer,
      origin: source.origin,
      country: source.country,
      vip: Boolean(source.vip),
    },
  });
  stats.sourcesAdded += 1;
  return true;
}

async function createChannel(candidate: CandidateChannel, best: RankedProbe, stats: SyncStats) {
  const categoryId = await ensureCategory(candidate);
  const catalogKey = `auto:${cleanName(candidate.nameEn || candidate.name)}`;
  const id = await allocateChannelId(candidate.id, `${catalogKey}:${best.url}`);
  const sourceList = uniqueSources(candidate).slice(0, MAX_SOURCES_PER_CHANNEL);
  await prisma.channel.create({
    data: {
      id,
      name: candidate.name,
      nameEn: candidate.nameEn || candidate.name,
      catalogKey,
      image: candidate.image,
      url: best.url,
      referer: best.source.referer ?? candidate.referer,
      origin: best.source.origin ?? candidate.origin,
      vpn: candidate.vpn,
      iran: candidate.iran,
      popular: BigInt(Math.max(0, Math.trunc(candidate.popular || 0))),
      vip: candidate.vip,
      language: candidate.language,
      country: candidate.country,
      platform: candidate.platform,
      satellite: candidate.satellite,
      frequency: candidate.frequency,
      polarization: candidate.polarization,
      symbolRate: candidate.symbolRate,
      serviceId: candidate.serviceId,
      categoryId,
      categoryName: candidate.category || null,
      categoryNameEn: candidate.categoryEn || null,
    },
  });
  for (const source of sourceList) {
    await addSource(id, source, catalogKey, stats);
  }
  await reportStreamSuccess({ channelId: id, url: best.url, latencyMs: best.latencyMs });
  stats.created += 1;
  return id;
}

function cleanName(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 180) || 'channel';
}

async function updateExistingChannel(existing: ExistingChannel, candidate: CandidateChannel, best: RankedProbe, stats: SyncStats) {
  const currentPrimary = cleanUrl(existing.url);
  const currentPrimaryProbe = bestOfExistingPrimary(existing, best);
  const shouldReplacePrimary = !currentPrimary || best.url !== currentPrimary && best.score > currentPrimaryProbe;
  let changed = false;

  const primarySource = uniqueSources(candidate).find((source) => sameUrl(source.url, best.url));
  const knownSource = existing.sources.some((source) => sameUrl(source.url, best.url));

  if (!knownSource) {
    await addSource(existing.id, primarySource || { url: best.url, referer: best.referer, origin: best.origin, title: 'Auto verified', country: candidate.country, vip: candidate.vip }, `auto:${cleanName(existing.nameEn || existing.name)}`, stats);
    changed = true;
  }

  if (shouldReplacePrimary) {
    await prisma.channel.update({ where: { id: existing.id }, data: { url: best.url, referer: best.referer ?? existing.referer, origin: best.origin ?? existing.origin, archiveStatus: null, archiveNote: null, archiveSince: null } });
    changed = true;
  } else if (existing.archiveStatus) {
    await prisma.channel.update({ where: { id: existing.id }, data: { archiveStatus: null, archiveNote: null, archiveSince: null } });
    changed = true;
  }

  await reportStreamSuccess({ channelId: existing.id, url: best.url, latencyMs: best.latencyMs });
  if (changed) stats.updated += 1;
  else stats.unchanged += 1;
}

function bestOfExistingPrimary(existing: ExistingChannel, probe: RankedProbe) {
  const health = probe.url === existing.url ? probe.score : -1;
  return health;
}

async function persistProbe(result: RankedProbe, stats: SyncStats) {
  if (result.verdict === 'HEALTHY') {
    stats.healthy95 += result.score >= AUTO_SYNC_THRESHOLD ? 1 : 0;
    await reportStreamSuccess({ channelId: result.candidate.id, url: result.url, latencyMs: result.latencyMs });
  } else {
    if (result.verdict === 'BROKEN') stats.broken += 1;
    else stats.suspect += 1;
    await reportStreamFailure({ channelId: result.candidate.id, url: result.url, latencyMs: result.latencyMs, error: result.reason });
  }
}

function normalizeCandidate(channel: CandidateChannel): CandidateChannel {
  return {
    ...channel,
    name: channel.name?.trim() || 'Unknown Channel',
    nameEn: channel.nameEn?.trim() || channel.name?.trim() || 'Unknown Channel',
    url: cleanUrl(channel.url),
    sources: uniqueSources(channel),
  };
}

export async function autoSynchronizeStreams() {
  const startedAt = Date.now();
  const stats: SyncStats = {
    discovered: 0, candidates: 0, checked: 0, healthy95: 0, created: 0, updated: 0, unchanged: 0,
    skippedBelow95: 0, duplicateChannels: 0, sourcesAdded: 0, sourcesSkipped: 0, broken: 0, suspect: 0, sourceErrors: 0, durationMs: 0,
  };

  const [sourceResults, existingRows] = await Promise.all([fetchCatalogSources(), loadExistingChannels()]);
  stats.sourceErrors = sourceResults.filter((result) => result.status === 'failed').length;
  const sourceChannels = sourceResults.flatMap((result) => result.channels.map(normalizeCandidate));
  stats.discovered = sourceChannels.length;

  const existing = existingRows as ExistingChannel[];
  const workingExisting: MatchableChannel[] = existing.map((channel) => ({ id: channel.id, name: channel.name, nameEn: channel.nameEn, catalogKey: channel.catalogKey, url: channel.url }));
  const dedupedCandidates: CandidateChannel[] = [];
  const seenCandidateIds = new Set<string>();

  for (const candidate of sourceChannels) {
    if (!candidate.url && candidate.sources.length === 0) continue;
    const match = matchChannel({ name: candidate.name, nameEn: candidate.nameEn, url: candidate.url }, workingExisting);
    const key = match.channel ? `existing:${match.channel.id}` : `new:${candidateKey(candidate)}`;
    if (seenCandidateIds.has(key)) {
      stats.duplicateChannels += 1;
      continue;
    }
    seenCandidateIds.add(key);
    dedupedCandidates.push(candidate);
  }

  const candidates = dedupedCandidates.slice(0, MAX_CANDIDATES);
  stats.candidates = candidates.length;

  const jobs: Array<{ candidate: CandidateChannel; source: CandidateSource }> = [];
  for (const candidate of candidates) {
    const match = matchChannel({ name: candidate.name, nameEn: candidate.nameEn, url: candidate.url }, workingExisting);
    const existingChannel = match.channel ? existing.find((item) => item.id === match.channel!.id) : null;
    const existingUrls = existingChannel ? new Set([existingChannel.url, ...existingChannel.sources.map((source) => source.url)].map((url) => cleanUrl(url).toLowerCase()).filter(Boolean)) : new Set<string>();
    const sources = uniqueSources(candidate)
      .sort((a, b) => (existingUrls.has(b.url.toLowerCase()) ? 1 : 0) - (existingUrls.has(a.url.toLowerCase()) ? 1 : 0))
      .slice(0, MAX_SOURCES_PER_CHANNEL);
    for (const source of sources) jobs.push({ candidate, source });
  }

  const ranked: RankedProbe[] = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= jobs.length) return;
      const job = jobs[index];
      try {
        const result = await probeStream(job.source.url, { referer: job.source.referer, origin: job.source.origin });
        stats.checked += 1;
        ranked.push({ ...result, candidate: job.candidate, source: job.source });
      } catch (error) {
        stats.checked += 1;
        ranked.push({
          url: job.source.url, protocol: 'UNKNOWN', reachable: false, live: false, buffering: false, manifestLoaded: false, mediaLoaded: false,
          changedDuringProbe: false, latencyMs: null, mediaBytes: null, mediaSequenceBefore: null, mediaSequenceAfter: null, contentType: null,
          verdict: 'BROKEN', score: 0, reason: error instanceof Error ? error.message : 'probe failed', checkedAt: new Date().toISOString(),
          candidate: job.candidate, source: job.source,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(AUTO_SYNC_CONCURRENCY, Math.max(1, jobs.length)) }, () => worker()));

  const bestByCandidate = new Map<string, RankedProbe>();
  for (const result of ranked) {
    const key = candidateKey(result.candidate);
    const current = bestByCandidate.get(key);
    if (!current || result.score > current.score) bestByCandidate.set(key, result);
  }

  const existingById = new Map(existing.map((channel) => [channel.id, channel]));
  for (const candidate of candidates) {
    const best = bestByCandidate.get(candidateKey(candidate));
    if (!best) continue;
    const match = matchChannel({ name: candidate.name, nameEn: candidate.nameEn, url: candidate.url }, workingExisting);
    const existingChannel = match.channel ? existingById.get(match.channel.id) : null;

    if (!existingChannel && (best.verdict !== 'HEALTHY' || best.score < AUTO_SYNC_THRESHOLD)) {
      stats.skippedBelow95 += 1;
      continue;
    }

    if (existingChannel) {
      if (best.score < AUTO_SYNC_THRESHOLD || best.verdict !== 'HEALTHY') {
        stats.skippedBelow95 += 1;
        continue;
      }
      await updateExistingChannel(existingChannel, candidate, best, stats);
      existingChannel.url = best.url;
      existingChannel.referer = best.referer;
      existingChannel.origin = best.origin;
      if (!workingExisting.some((item) => item.id === existingChannel.id)) {
        workingExisting.push({ id: existingChannel.id, name: existingChannel.name, nameEn: existingChannel.nameEn, catalogKey: existingChannel.catalogKey, url: best.url });
      }
      continue;
    }

    try {
      const newId = await createChannel(candidate, best, stats);
      workingExisting.push({ id: newId, name: candidate.name, nameEn: candidate.nameEn, catalogKey: `auto:${cleanName(candidate.nameEn || candidate.name)}`, url: best.url });
    } catch (error) {
      console.warn('[stream-auto-sync] Failed to create channel.', { channel: candidate.name, error });
    }
  }

  if (stats.created > 0 || stats.updated > 0 || stats.sourcesAdded > 0) invalidateCatalogCache();
  stats.durationMs = Date.now() - startedAt;
  return { threshold: AUTO_SYNC_THRESHOLD, ...stats, sourceAdapters: sourceResults.map((result) => ({ adapter: result.adapter, status: result.status, channels: result.channels.length, error: result.error })) };
}
