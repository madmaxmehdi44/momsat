import { prisma } from './prisma';
import { fetchCatalogSources, type Channel } from './source';
import { matchChannel, type MatchableChannel } from './channel-match';
import { probeStream, type StreamProbeResult } from './stream-probe';
import { reportStreamFailure, reportStreamSuccess } from './stream-health';
import { invalidateCatalogCache } from './catalog-db';

type StreamSource = { url: string; referer: string | null; origin: string | null; title: string | null; country: string | null; vip: boolean };
type Existing = MatchableChannel & { categoryId: number; archiveStatus: 'MEMORY' | 'SHUTDOWN' | null; image: string | null; referer: string | null; origin: string | null; vpn: boolean; iran: boolean; popular: bigint; vip: boolean; language: string | null; country: string | null; platform: string | null; satellite: string | null; frequency: string | null; polarization: string | null; symbolRate: string | null; serviceId: string | null; categoryName: string | null; categoryNameEn: string | null; sources: StreamSource[] };
type Candidate = Channel;
type Probe = StreamProbeResult & { candidate: Candidate; source: StreamSource; channelId: number | null };

const THRESHOLD = 95;
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.STREAM_AUTO_SYNC_CONCURRENCY || 8)));
const SOURCES_PER_CHANNEL = Math.max(1, Math.min(8, Number(process.env.STREAM_AUTO_SYNC_MAX_SOURCES_PER_CHANNEL || 4)));
const MAX_CANDIDATES = Math.max(1, Math.min(2000, Number(process.env.STREAM_AUTO_SYNC_MAX_CANDIDATES || 1000)));

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
const sameUrl = (a: string, b: string) => normalizeUrl(a) === normalizeUrl(b);
const normName = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
const candidateKey = (c: Candidate) => `${normName(c.nameEn || c.name)}:${normName(c.categoryEn || c.category)}`;
const toSource = (source: { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean }): StreamSource => ({ url: source.url.trim(), title: source.title ?? null, referer: source.referer ?? null, origin: source.origin ?? null, country: source.country ?? null, vip: Boolean(source.vip) });

function sourcesFor(candidate: Candidate) {
  const primary = candidate.url ? toSource({ url: candidate.url, title: 'Primary', referer: candidate.referer, origin: candidate.origin, country: candidate.country, vip: candidate.vip }) : null;
  const all = primary ? [primary, ...candidate.sources.map(toSource)] : candidate.sources.map(toSource);
  return Array.from(new Map(all.filter((s) => s.url).map((s) => [normalizeUrl(s.url), s])).values());
}

function matchExisting(candidate: Candidate, existing: Existing[]) {
  const incomingSources = sourcesFor(candidate);
  const urlMatch = existing.find((channel) => incomingSources.some((s) => sameUrl(s.url, channel.url) || channel.sources.some((stored) => sameUrl(stored.url, s.url))));
  if (urlMatch) return { channel: urlMatch, score: 1, reason: 'exact stream URL' };
  return matchChannel({ name: candidate.name, nameEn: candidate.nameEn, url: candidate.url }, existing);
}

function preferredSources(candidate: Candidate, existing: Existing | null) {
  const list: StreamSource[] = [];
  if (existing) {
    if (existing.url) list.push(toSource({ url: existing.url, title: 'Current primary', referer: existing.referer, origin: existing.origin, country: existing.country, vip: existing.vip }));
    list.push(...existing.sources);
  }
  list.push(...sourcesFor(candidate));
  return Array.from(new Map(list.filter((s) => s.url).map((s) => [normalizeUrl(s.url), s])).values()).slice(0, SOURCES_PER_CHANNEL);
}

async function loadExisting(): Promise<Existing[]> {
  return prisma.channel.findMany({
    select: {
      id: true, name: true, nameEn: true, catalogKey: true, url: true, categoryId: true, archiveStatus: true, image: true,
      referer: true, origin: true, vpn: true, iran: true, popular: true, vip: true, language: true, country: true, platform: true,
      satellite: true, frequency: true, polarization: true, symbolRate: true, serviceId: true, categoryName: true, categoryNameEn: true,
      sources: { select: { id: true, title: true, url: true, referer: true, origin: true, country: true, vip: true } },
    }, orderBy: { id: 'asc' },
  }) as Promise<Existing[]>;
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) & 0x7fffffff || 1;
}

async function freeChannelId(preferred: number, key: string) {
  let id = preferred > 0 ? preferred : stableId(key);
  for (let i = 0; i < 32; i += 1) {
    if (!(await prisma.channel.findUnique({ where: { id }, select: { id: true } }))) return id;
    id = stableId(`${key}:${i + 1}`);
  }
  throw new Error('channel id allocation failed');
}

async function freeSourceId(key: string) {
  let id = stableId(key);
  for (let i = 0; i < 32; i += 1) {
    if (!(await prisma.source.findUnique({ where: { id }, select: { id: true } }))) return id;
    id = stableId(`${key}:${i + 1}`);
  }
  throw new Error('source id allocation failed');
}

async function saveSource(channelId: number, source: StreamSource, stats: { added: number; skipped: number }, key: string) {
  if (!source.url) return;
  if (await prisma.source.findFirst({ where: { channelId, url: source.url }, select: { id: true } })) { stats.skipped += 1; return; }
  const id = await freeSourceId(`${key}:${normalizeUrl(source.url)}`);
  await prisma.source.create({ data: { id, channelId, title: source.title, url: source.url, referer: source.referer, origin: source.origin, country: source.country, vip: source.vip } });
  stats.added += 1;
}

async function createNew(candidate: Candidate, best: Probe, stats: { created: number; sourcesAdded: number; sourcesSkipped: number }) {
  const categoryId = candidate.catId || 1;
  await prisma.category.upsert({ where: { id: categoryId }, update: { name: candidate.category || 'Persian TV', nameEn: candidate.categoryEn || candidate.category || 'persian-tv' }, create: { id: categoryId, name: candidate.category || 'Persian TV', nameEn: candidate.categoryEn || candidate.category || 'persian-tv' } });
  const key = `auto:${candidateKey(candidate)}`;
  const id = await freeChannelId(candidate.id, `${key}:${best.url}`);
  await prisma.channel.create({ data: {
    id, name: candidate.name, nameEn: candidate.nameEn || candidate.name, catalogKey: key, image: candidate.image, url: best.url,
    referer: best.source.referer ?? candidate.referer, origin: best.source.origin ?? candidate.origin, vpn: candidate.vpn, iran: candidate.iran,
    popular: BigInt(Math.max(0, Math.trunc(candidate.popular || 0))), vip: candidate.vip, language: candidate.language, country: candidate.country,
    platform: candidate.platform, satellite: candidate.satellite, frequency: candidate.frequency, polarization: candidate.polarization, symbolRate: candidate.symbolRate,
    serviceId: candidate.serviceId, categoryId, categoryName: candidate.category || null, categoryNameEn: candidate.categoryEn || null,
  } });
  const sourceStats = { added: 0, skipped: 0 };
  for (const source of sourcesFor(candidate).slice(0, SOURCES_PER_CHANNEL)) await saveSource(id, source, sourceStats, key);
  stats.created += 1; stats.sourcesAdded += sourceStats.added; stats.sourcesSkipped += sourceStats.skipped;
  await reportStreamSuccess({ channelId: id, url: best.url, latencyMs: best.latencyMs });
  return id;
}

async function processExisting(existing: Existing, best: Probe, all: Probe[], stats: { updated: number; unchanged: number; sourcesAdded: number; sourcesSkipped: number; healthy95: number; suspect: number; broken: number }) {
  for (const result of all) {
    if (result.verdict === 'HEALTHY' && result.score >= THRESHOLD) { stats.healthy95 += 1; await reportStreamSuccess({ channelId: existing.id, url: result.url, latencyMs: result.latencyMs }); }
    else if (result.verdict === 'BROKEN') { stats.broken += 1; await reportStreamFailure({ channelId: existing.id, url: result.url, latencyMs: result.latencyMs, error: result.reason }); }
    else { stats.suspect += 1; await reportStreamFailure({ channelId: existing.id, url: result.url, latencyMs: result.latencyMs, error: result.reason }); }
  }

  const currentProbe = all.find((r) => sameUrl(r.url, existing.url));
  const currentScore = currentProbe?.score ?? 0;
  if (best.verdict !== 'HEALTHY' || best.score < THRESHOLD || best.score <= currentScore) { stats.unchanged += 1; return; }

  const alreadyStored = sameUrl(best.url, existing.url) || existing.sources.some((source) => sameUrl(source.url, best.url));
  if (!alreadyStored) {
    const sourceStats = { added: 0, skipped: 0 };
    await saveSource(existing.id, best.source, sourceStats, `auto:${candidateKey(best.candidate)}`);
    stats.sourcesAdded += sourceStats.added; stats.sourcesSkipped += sourceStats.skipped;
  }
  await prisma.channel.update({ where: { id: existing.id }, data: { url: best.url, referer: best.source.referer ?? existing.referer, origin: best.source.origin ?? existing.origin, archiveStatus: null, archiveNote: null, archiveSince: null } });
  stats.updated += 1;
}

export async function autoSynchronizeStreamsV2() {
  const started = Date.now();
  const stats = { discovered: 0, candidates: 0, checked: 0, healthy95: 0, created: 0, updated: 0, unchanged: 0, skippedBelow95: 0, duplicateChannels: 0, sourcesAdded: 0, sourcesSkipped: 0, suspect: 0, broken: 0, sourceErrors: 0, durationMs: 0 };
  const [sourceResults, existing] = await Promise.all([fetchCatalogSources(), loadExisting()]);
  stats.sourceErrors = sourceResults.filter((r) => r.status === 'failed').length;
  const discovered = sourceResults.flatMap((r) => r.channels).filter((c) => c.url || c.sources.length);
  stats.discovered = discovered.length;

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of discovered) {
    const matched = matchExisting(candidate, existing);
    const key = matched.channel ? `existing:${matched.channel.id}` : `new:${candidateKey(candidate)}`;
    if (seen.has(key)) { stats.duplicateChannels += 1; continue; }
    seen.add(key); candidates.push(candidate);
  }
  const selected = candidates.slice(0, MAX_CANDIDATES);
  stats.candidates = selected.length;

  const jobs: Array<{ candidate: Candidate; existing: Existing | null; source: StreamSource }> = [];
  for (const candidate of selected) {
    const matched = matchExisting(candidate, existing);
    const row = matched.channel ? existing.find((c) => c.id === matched.channel!.id) ?? null : null;
    for (const source of preferredSources(candidate, row)) jobs.push({ candidate, existing: row, source });
  }

  const probes: Probe[] = [];
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= jobs.length) return;
      const job = jobs[i];
      const result = await probeStream(job.source.url, { referer: job.source.referer, origin: job.source.origin });
      stats.checked += 1;
      probes.push({ ...result, candidate: job.candidate, source: job.source, channelId: job.existing?.id ?? null });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, jobs.length)) }, worker));

  const existingById = new Map(existing.map((c) => [c.id, c]));
  let changed = false;
  for (const candidate of selected) {
    const key = candidateKey(candidate);
    const all = probes.filter((p) => candidateKey(p.candidate) === key);
    if (!all.length) continue;
    const best = [...all].sort((a, b) => b.score - a.score)[0];
    const matched = matchExisting(candidate, existing);
    const row = matched.channel ? existingById.get(matched.channel.id) ?? null : null;

    if (row) {
      const before = stats.updated;
      await processExisting(row, best, all, stats);
      if (stats.updated > before) changed = true;
      continue;
    }
    if (best.verdict !== 'HEALTHY' || best.score < THRESHOLD) { stats.skippedBelow95 += 1; continue; }
    try { await createNew(candidate, best, stats); changed = true; }
    catch (error) { console.warn('[stream-auto-sync-v2] create failed', { channel: candidate.name, error }); }
  }

  if (changed || stats.sourcesAdded > 0) invalidateCatalogCache();
  stats.durationMs = Date.now() - started;
  return { threshold: THRESHOLD, ...stats, sourceAdapters: sourceResults.map((r) => ({ adapter: r.adapter, status: r.status, channels: r.channels.length, error: r.error })) };
}
