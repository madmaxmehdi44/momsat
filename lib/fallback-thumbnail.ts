function escapeXml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  return (name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3) || 'TV').toUpperCase();
}

function categoryLabel(category?: string | null) {
  const value = (category || '').toLowerCase();
  if (/news|خبر|khabar/.test(value)) return 'NEWS';
  if (/sport|ورزش|football|soccer/.test(value)) return 'SPORT';
  if (/music|موسیقی|موزیک/.test(value)) return 'MUSIC';
  if (/movie|film|فیلم|cinema|سینما|series|سریال/.test(value)) return 'MOVIES';
  if (/radio|رادیو/.test(value)) return 'RADIO';
  return 'LIVE TV';
}

function sanitizeUnicode(value: string) {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) continue;
    result += value[index];
  }

  return result;
}

const SAFE_FALLBACK_THUMBNAIL = 'data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22640%22%20height%3D%22360%22%3E%3Crect%20width%3D%22640%22%20height%3D%22360%22%20fill%3D%22%2307090e%22%2F%3E%3Ctext%20x%3D%22320%22%20y%3D%22190%22%20text-anchor%3D%22middle%22%20fill%3D%22%23ffffff%22%20font-family%3D%22Arial%2Csans-serif%22%20font-size%3D%2234%22%20font-weight%3D%22800%22%3EMOMSAT%3C%2Ftext%3E%3C%2Fsvg%3E';

export function fallbackChannelThumbnail(name?: string | null, category?: string | null) {
  const label = escapeXml((name || 'MOMSAT').trim().slice(0, 42));
  const mark = escapeXml(initials(name || 'TV'));
  const type = escapeXml(categoryLabel(category));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#141a29"/><stop offset="0.55" stop-color="#211125"/><stop offset="1" stop-color="#07090e"/></linearGradient><radialGradient id="r" cx="50%" cy="35%" r="65%"><stop offset="0" stop-color="#ff1744" stop-opacity=".34"/><stop offset="1" stop-color="#ff1744" stop-opacity="0"/></radialGradient></defs><rect width="640" height="360" fill="url(#g)"/><rect width="640" height="360" fill="url(#r)"/><g fill="none" stroke="#ffffff" stroke-opacity=".08"><circle cx="320" cy="180" r="122"/><circle cx="320" cy="180" r="168"/><ellipse cx="320" cy="180" rx="240" ry="86" transform="rotate(-18 320 180)"/></g><circle cx="320" cy="165" r="54" fill="#ff1744" fill-opacity=".12" stroke="#ff1744" stroke-opacity=".45"/><text x="320" y="178" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="34" font-weight="800">${mark}</text><text x="320" y="238" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="20" font-weight="700">${label}</text><text x="320" y="266" text-anchor="middle" fill="#ff718c" font-family="Arial,sans-serif" font-size="11" font-weight="800" letter-spacing="2">${type} · MOMSAT</text><circle cx="36" cy="32" r="5" fill="#ff1744"/><text x="52" y="37" fill="#aaa" font-family="Arial,sans-serif" font-size="11">LIVE CHANNEL</text></svg>`;

  try {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(sanitizeUnicode(svg))}`;
  } catch {
    return SAFE_FALLBACK_THUMBNAIL;
  }
}
