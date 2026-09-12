import fs from 'node:fs';
import path from 'node:path';
import { ensureChannelThumbnail } from './channel-thumbnail';
import { fallbackChannelThumbnail } from './fallback-thumbnail';
import type { Channel } from './source';

type CsvRow = Record<string, string>;
type LiteralValue = string | number | boolean | null | LiteralValue[] | { [key: string]: LiteralValue };

const DATA_FILE = path.join(process.cwd(), 'prisma', 'seed-data', 'seed-data.csv');
const FALLBACK_CATEGORY = { id: 0, name: 'بدون دسته‌بندی', nameEn: 'Uncategorized' };

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  if (rows.length === 0) return [];

  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function int(value: string, fallback = 0) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string) {
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

class PythonLiteralParser {
  private index = 0;

  constructor(private readonly input: string) {}

  parse(): LiteralValue {
    this.skipWhitespace();
    const value = this.parseValue();
    this.skipWhitespace();
    if (this.index !== this.input.length) throw new SyntaxError(`Unexpected character at position ${this.index}`);
    return value;
  }

  private parseValue(): LiteralValue {
    this.skipWhitespace();
    const char = this.input[this.index];
    if (char === '[') return this.parseList();
    if (char === '{') return this.parseObject();
    if (char === '\'' || char === '"') return this.parseString();
    if (this.input.startsWith('None', this.index)) {
      this.index += 4;
      return null;
    }
    if (this.input.startsWith('True', this.index)) {
      this.index += 4;
      return true;
    }
    if (this.input.startsWith('False', this.index)) {
      this.index += 5;
      return false;
    }
    const number = this.input.slice(this.index).match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      this.index += number[0].length;
      return Number(number[0]);
    }
    throw new SyntaxError(`Unexpected token at position ${this.index}`);
  }

  private parseList(): LiteralValue[] {
    this.index += 1;
    const result: LiteralValue[] = [];
    this.skipWhitespace();
    if (this.input[this.index] === ']') {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.parseValue());
      this.skipWhitespace();
      if (this.input[this.index] === ',') {
        this.index += 1;
        this.skipWhitespace();
        if (this.input[this.index] === ']') {
          this.index += 1;
          return result;
        }
        continue;
      }
      if (this.input[this.index] === ']') {
        this.index += 1;
        return result;
      }
      throw new SyntaxError(`Expected ',' or ']' at position ${this.index}`);
    }
  }

  private parseObject(): { [key: string]: LiteralValue } {
    this.index += 1;
    const result: { [key: string]: LiteralValue } = {};
    this.skipWhitespace();
    if (this.input[this.index] === '}') {
      this.index += 1;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      const key = this.parseString();
      this.skipWhitespace();
      if (this.input[this.index] !== ':') throw new SyntaxError(`Expected ':' at position ${this.index}`);
      this.index += 1;
      result[key] = this.parseValue();
      this.skipWhitespace();
      if (this.input[this.index] === ',') {
        this.index += 1;
        this.skipWhitespace();
        if (this.input[this.index] === '}') {
          this.index += 1;
          return result;
        }
        continue;
      }
      if (this.input[this.index] === '}') {
        this.index += 1;
        return result;
      }
      throw new SyntaxError(`Expected ',' or '}' at position ${this.index}`);
    }
  }

  private parseString(): string {
    const quote = this.input[this.index];
    this.index += 1;
    let result = '';
    while (this.index < this.input.length) {
      const char = this.input[this.index++];
      if (char === quote) return result;
      if (char !== '\\') {
        result += char;
        continue;
      }
      if (this.index >= this.input.length) throw new SyntaxError('Unterminated escape sequence');
      const escaped = this.input[this.index++];
      const escapes: Record<string, string> = {
        n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0',
        '\\': '\\', "'": "'", '"': '"',
      };
      result += escapes[escaped] ?? escaped;
    }
    throw new SyntaxError('Unterminated string literal');
  }

  private skipWhitespace() {
    while (/\s/.test(this.input[this.index] ?? '')) this.index += 1;
  }
}

function parseSources(raw: string, channelId: number) {
  if (!raw.trim()) return [];
  const parsed = new PythonLiteralParser(raw.trim()).parse();
  if (!Array.isArray(parsed)) throw new SyntaxError(`Expected a list of sources for channel ${channelId}`);

  return parsed
    .map((source) => {
      if (!source || Array.isArray(source) || typeof source !== 'object') return null;
      const record = source as Record<string, LiteralValue>;
      const id = Number(record.ID ?? record.id);
      const url = typeof record.channel_url === 'string' ? record.channel_url.trim() : '';
      if (!Number.isInteger(id) || !url) return null;
      return {
        id,
        title: typeof record.title === 'string' ? nullable(record.title) : null,
        url,
        referer: typeof record.channel_referer === 'string' ? nullable(record.channel_referer) : null,
        origin: typeof record.channel_origin === 'string' ? nullable(record.channel_origin) : null,
        country: typeof record.country === 'string' ? nullable(record.country) : null,
        vip: record.isvip === true || record.isvip === 1,
      };
    })
    .filter((source): source is NonNullable<typeof source> => source !== null);
}

export function loadVerifiedCatalog(): Channel[] {
  if (!fs.existsSync(DATA_FILE)) return [];
  const rows = parseCsv(fs.readFileSync(DATA_FILE, 'utf8'));
  const seen = new Set<number>();
  const channels: Channel[] = [];

  for (const row of rows) {
    const id = int(row.channel_id);
    if (!id || seen.has(id) || !row.channel_name.trim() || !row.channel_url.trim()) continue;
    seen.add(id);

    const categoryId = int(row.category_id);
    const category = categoryId === 0
      ? FALLBACK_CATEGORY
      : { id: categoryId, name: row.category_name || FALLBACK_CATEGORY.name, nameEn: row.category_name_en || FALLBACK_CATEGORY.nameEn };

    let parsedSources: ReturnType<typeof parseSources> = [];
    try {
      parsedSources = parseSources(row.sourses, id);
    } catch {
      parsedSources = [];
    }

    const primary = {
      id: null,
      title: 'Primary',
      url: row.channel_url.trim(),
      referer: nullable(row.channel_referer),
      origin: nullable(row.channel_origin),
      country: null,
      vip: bool(row.isvip),
    };
    const sourceMap = new Map<string, Channel['sources'][number]>();
    for (const source of [primary, ...parsedSources]) sourceMap.set(source.url, source);
    const sources = Array.from(sourceMap.values());
    const imageSeed = nullable(row.channel_image);
    const name = row.channel_name.trim();
    const nameEn = row.channel_name_en.trim() || name;

    channels.push({
      id,
      catId: category.id,
      name,
      nameEn,
      image: ensureChannelThumbnail(nameEn, imageSeed) || fallbackChannelThumbnail(nameEn, category.name),
      url: sources[0]?.url || row.channel_url.trim(),
      referer: sources[0]?.referer ?? nullable(row.channel_referer),
      origin: sources[0]?.origin ?? nullable(row.channel_origin),
      vpn: bool(row.need_vpn),
      iran: bool(row.for_iran),
      popular: int(row.popular),
      vip: bool(row.isvip),
      language: null,
      country: sources[0]?.country ?? null,
      platform: null,
      satellite: null,
      frequency: null,
      polarization: null,
      symbolRate: null,
      serviceId: null,
      category: category.name,
      categoryEn: category.nameEn,
      sources,
    });
  }

  return channels;
}
