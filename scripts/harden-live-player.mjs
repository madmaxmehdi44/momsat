import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const playerFile = resolve(process.cwd(), 'components/PlayerPro.tsx');
let playerSource = readFileSync(playerFile, 'utf8');

const currentConfig = `          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 45,
            maxMaxBufferLength: 90,
            liveSyncDurationCount: 4,
            liveMaxLatencyDurationCount: 12,
            maxLiveSyncPlaybackRate: 1.15,
            manifestLoadingMaxRetry: 2,
            levelLoadingMaxRetry: 3,
            fragLoadingMaxRetry: 3,
            manifestLoadingTimeOut: 12000,
            levelLoadingTimeOut: 12000,
            fragLoadingTimeOut: 15000,
            capLevelToPlayerSize: true,
            startLevel: -1,
            maxBufferHole: 0.8,
          });`;

const resilientConfig = `          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            liveSyncMode: 'buffered',
            backBufferLength: 90,
            maxBufferLength: 50,
            maxMaxBufferLength: 60,
            maxBufferSize: 100 * 1000 * 1000,
            liveSyncDuration: 35,
            liveMaxLatencyDuration: 50,
            maxLiveSyncPlaybackRate: 1.02,
            initialLiveManifestSize: 5,
            manifestLoadingMaxRetry: 6,
            levelLoadingMaxRetry: 8,
            fragLoadingMaxRetry: 10,
            manifestLoadingTimeOut: 30000,
            levelLoadingTimeOut: 30000,
            fragLoadingTimeOut: 30000,
            manifestLoadingRetryDelay: 1000,
            levelLoadingRetryDelay: 1000,
            fragLoadingRetryDelay: 1000,
            capLevelToPlayerSize: true,
            startLevel: -1,
            maxBufferHole: 1.2,
            maxSeekHole: 4,
            nudgeMaxRetry: 6,
          });`;

if (playerSource.includes(currentConfig)) playerSource = playerSource.replace(currentConfig, resilientConfig);

const oldWaiting = `    const onWaiting = () => {\n      if (!cancelled && epoch === epochRef.current && playingRef.current) setLoading(true);\n    };`;
const resilientWaiting = `    const onWaiting = () => {\n      if (cancelled || epoch !== epochRef.current || !playingRef.current) return;\n      const buffered = video.buffered;\n      const ahead = buffered.length > 0\n        ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime)\n        : 0;\n      setLoading(ahead < 1.5);\n    };`;
if (playerSource.includes(oldWaiting)) playerSource = playerSource.replace(oldWaiting, resilientWaiting);

const marker = 'export default function PlayerPro';
const helper = `function getBufferedAhead(video: HTMLVideoElement) {\n  try {\n    const ranges = video.buffered;\n    if (!ranges.length) return 0;\n    return Math.max(0, ranges.end(ranges.length - 1) - video.currentTime);\n  } catch {\n    return 0;\n  }\n}\n\n`;
if (!playerSource.includes('function getBufferedAhead(') && playerSource.includes(marker)) playerSource = playerSource.replace(marker, `${helper}${marker}`);

const oldWaitingWithFallback = `      const buffered = video.buffered;\n      const ahead = buffered.length > 0\n        ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime)\n        : 0;`;
playerSource = playerSource.replace(oldWaitingWithFallback, `      const ahead = getBufferedAhead(video);`);
writeFileSync(playerFile, playerSource, 'utf8');

const catalogFile = resolve(process.cwd(), 'components/LiveChannelCatalogFixed.tsx');
let catalogSource = readFileSync(catalogFile, 'utf8');

const hardenedCapture = `async function capture(channel: Channel): Promise<{ dataUrl: string | null; sourceUrl: string } | null> {
  for (const candidate of candidates(channel)) {
    const url = proxyUrl(candidate, channel);
    const video = document.createElement('video');
    const hlsInstances: Hls[] = [];
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);

    try {
      const playable = await new Promise<boolean>((resolve) => {
        let settled = false;
        let playingTimer: number | null = null;
        const finish = (value: boolean) => {
          if (settled) return;
          settled = true;
          if (playingTimer != null) window.clearTimeout(playingTimer);
          window.clearTimeout(timeout);
          resolve(value);
        };
        const onPlaying = () => {
          if (playingTimer != null) window.clearTimeout(playingTimer);
          const startedAt = video.currentTime;
          playingTimer = window.setTimeout(() => {
            const advanced = Math.abs(video.currentTime - startedAt) >= 0.05 || !video.paused;
            finish(advanced && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
          }, 900);
        };
        const timeout = window.setTimeout(() => finish(false), 10_000);
        video.addEventListener('playing', onPlaying, { once: false });
        video.addEventListener('error', () => {
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            // Do not fail immediately: HLS can recover from transient media errors.
          }
        }, { once: true });

        if (/\\.m3u8(?:$|[?#])/i.test(url)) {
          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              backBufferLength: 8,
              maxBufferLength: 12,
              maxMaxBufferLength: 20,
              manifestLoadingMaxRetry: 3,
              levelLoadingMaxRetry: 4,
              fragLoadingMaxRetry: 4,
              manifestLoadingTimeOut: 6000,
              levelLoadingTimeOut: 6000,
              fragLoadingTimeOut: 7000,
              liveSyncDurationCount: 4,
            });
            hlsInstances.push(hls);
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
            });
            hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => undefined); });
            hls.loadSource(url);
            hls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            void video.play().catch(() => undefined);
          } else finish(false);
        } else {
          video.src = url;
          void video.play().catch(() => undefined);
        }
      });

      if (!playable) continue;

      let dataUrl: string | null = null;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 480;
          canvas.height = Math.max(270, Math.round((480 * video.videoHeight) / video.videoWidth));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const candidateDataUrl = canvas.toDataURL('image/jpeg', 0.72);
            if (candidateDataUrl.length >= 1000) dataUrl = candidateDataUrl;
          }
        } catch {
          // Playback success is authoritative. Thumbnail capture is best-effort only.
        }
      }

      return { dataUrl, sourceUrl: url };
    } catch {
      // Try the next source.
    } finally {
      for (const instance of hlsInstances) {
        try { instance.destroy(); } catch { /* ignore cleanup errors */ }
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
  }
  return null;
}`;

const capturePattern = /async function capture\(channel: Channel\): Promise<\{ dataUrl: string; sourceUrl: string \} \| null> \{[\s\S]*?\n\}\nfunction readIds/;
if (capturePattern.test(catalogSource)) {
  catalogSource = catalogSource.replace(capturePattern, `${hardenedCapture}\nfunction readIds`);
}

catalogSource = catalogSource.replace(
  /const fresh = Boolean\(cached && Date\.now\(\) - cached\.updatedAt < SNAPSHOT_TTL\);/,
  `const cacheAge = cached ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;\n      const fresh = Boolean(cached && cacheAge < (cached.status === 'offline' ? 10_000 : SNAPSHOT_TTL));`,
);

catalogSource = catalogSource.replace(
  /const entry: LiveThumbnailEntry = \{ channelId: id, dataUrl: result\?\.dataUrl \|\| cached\?\.dataUrl \|\| null, sourceUrl: result\?\.sourceUrl \|\| cached\?\.sourceUrl \|\| null, status: result \? 'online' : 'offline', updatedAt: Date\.now\(\), failures: result \? 0 : \(cached\?\.failures \|\| 0\) \+ 1 \};/,
  `const failures = result ? 0 : (cached?.status === 'offline' ? (cached?.failures || 0) + 1 : 1);\n      const status: LiveThumbnailEntry['status'] = result ? 'online' : failures >= 2 ? 'offline' : cached?.status === 'online' ? 'online' : 'loading';\n      const entry: LiveThumbnailEntry = { channelId: id, dataUrl: result?.dataUrl || cached?.dataUrl || null, sourceUrl: result?.sourceUrl || cached?.sourceUrl || null, status, updatedAt: Date.now(), failures };`,
);
writeFileSync(catalogFile, catalogSource, 'utf8');
console.log('[MOMSAT] Hardened player + verified playback probe: playback success is independent from thumbnail capture.');
