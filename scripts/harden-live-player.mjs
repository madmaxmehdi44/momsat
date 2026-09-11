import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), 'components/PlayerPro.tsx');
let source = readFileSync(file, 'utf8');

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

if (source.includes(currentConfig)) {
  source = source.replace(currentConfig, resilientConfig);
}

const oldWaiting = `    const onWaiting = () => {\n      if (!cancelled && epoch === epochRef.current && playingRef.current) setLoading(true);\n    };`;

const resilientWaiting = `    const onWaiting = () => {\n      if (cancelled || epoch !== epochRef.current || !playingRef.current) return;\n      const buffered = video.buffered;\n      const ahead = buffered.length > 0\n        ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime)\n        : 0;\n      // Keep the existing picture playing without flashing the global "connecting" UI\n      // while the browser still has a meaningful safety buffer available.\n      setLoading(ahead < 1.5);\n    };`;

if (source.includes(oldWaiting)) {
  source = source.replace(oldWaiting, resilientWaiting);
}

const marker = "export default function PlayerPro";
const helper = `function getBufferedAhead(video: HTMLVideoElement) {\n  try {\n    const ranges = video.buffered;\n    if (!ranges.length) return 0;\n    return Math.max(0, ranges.end(ranges.length - 1) - video.currentTime);\n  } catch {\n    return 0;\n  }\n}\n\n`;

if (!source.includes('function getBufferedAhead(') && source.includes(marker)) {
  source = source.replace(marker, `${helper}${marker}`);
}

const oldWaitingWithFallback = `      const buffered = video.buffered;\n      const ahead = buffered.length > 0\n        ? Math.max(0, buffered.end(buffered.length - 1) - video.currentTime)\n        : 0;`;
const newWaitingWithFallback = `      const ahead = getBufferedAhead(video);`;
source = source.replace(oldWaitingWithFallback, newWaitingWithFallback);

writeFileSync(file, source, 'utf8');
console.log('[MOMSAT] Hardened live player: 35s target latency, 50s max live latency, 50s forward buffer.');
