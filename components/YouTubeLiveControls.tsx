'use client';

import { Maximize2, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Props = { onRetry?: () => void; onFullscreen?: () => void; onMute?: () => void; muted?: boolean; playing?: boolean };

export default function YouTubeLiveControls({ onRetry, onFullscreen, onMute, muted = false, playing = false }: Props) {
  const [visible, setVisible] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = () => {
      setVisible(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(false), 2600);
    };
    window.addEventListener('mousemove', show, { passive: true });
    window.addEventListener('keydown', show);
    return () => {
      window.removeEventListener('mousemove', show);
      window.removeEventListener('keydown', show);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className={`momsat-live-controls${visible ? ' visible' : ''}`} aria-hidden={!visible}>
      <div className="momsat-live-controls-left">
        <button type="button" onClick={onMute} title={muted ? 'فعال‌کردن صدا' : 'بی‌صدا'}>{muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <span className="momsat-live-state"><i /> {playing ? 'LIVE' : 'READY'}</span>
      </div>
      <div className="momsat-live-controls-right">
        <button type="button" onClick={onRetry} title="تلاش مجدد"><RotateCcw size={16} /></button>
        <button type="button" onClick={onFullscreen} title="تمام صفحه"><Maximize2 size={16} /></button>
        {!playing ? <span className="momsat-live-playhint"><Play size={13} fill="currentColor" /> برای شروع روی تصویر کلیک کنید</span> : null}
      </div>
    </div>
  );
}
