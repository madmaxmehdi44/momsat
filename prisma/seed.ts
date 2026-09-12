import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';

type CsvRow = Record<string, string>;

const DATA_FILE = path.join(process.cwd(), 'prisma', 'seed-data', 'seed-data.csv');

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
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])),
  );
}

function int(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string): boolean {
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
}

function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseSources(raw: string, channelId: number) {
  if (!raw.trim()) return [];

  // The source column is Python-literal-style data (single quotes / None),
  // so normalize the representation before parsing it as JSON.
  const normalized = raw
    .trim()
    .replace(/'/g, '"')
    .replace(/\bNone\b/g, 'null')
    .replace(/\bTrue\b/g, 'true')
    .replace(/\bFalse\b/g, 'false');

  try {
    const values = JSON.parse(normalized) as Array<Record<string, unknown>>;
    return values
      .map((source) => {
        const id = Number(source.ID ?? source.id);
        const url = typeof source.channel_url === 'string' ? source.channel_url.trim() : '';
        if (!Number.isInteger(id) || !url) return null;

        return {
          id,
          channelId,
          title: typeof source.title === 'string' ? nullable(source.title) : null,
          url,
          referer: typeof source.channel_referer === 'string' ? nullable(source.channel_referer) : null,
          origin: typeof source.channel_origin === 'string' ? nullable(source.channel_origin) : null,
          country: typeof source.country === 'string' ? nullable(source.country) : null,
          vip: Boolean(source.isvip),
        };
      })
      .filter((source): source is NonNullable<typeof source> => source !== null);
  } catch (error) {
    throw new Error(`Invalid sourses data for channel ${channelId}: ${String(error)}`);
  }
}

async function main() {
  if (!fs.existsSync(DATA_FILE)) {
    throw new Error(`Seed data file not found: ${DATA_FILE}`);
  }

  const rows = parseCsv(fs.readFileSync(DATA_FILE, 'utf8'));
  const seenChannels = new Set<number>();
  const seenSources = new Set<number>();

  for (const row of rows) {
    const channelId = int(row.channel_id);
    const categoryId = int(row.category_id);
    if (!channelId || !categoryId || !row.channel_name.trim() || !row.channel_url.trim()) {
      throw new Error(`Invalid channel row: ${JSON.stringify(row)}`);
    }
    if (seenChannels.has(channelId)) {
      throw new Error(`Duplicate channel_id in seed data: ${channelId}`);
    }
    seenChannels.add(channelId);

    await prisma.category.upsert({
      where: { id: categoryId },
      update: {
        name: row.category_name,
        nameEn: row.category_name_en,
      },
      create: {
        id: categoryId,
        name: row.category_name,
        nameEn: row.category_name_en,
      },
    });

    await prisma.channel.upsert({
      where: { id: channelId },
      update: {
        name: row.channel_name,
        nameEn: row.channel_name_en,
        image: nullable(row.channel_image),
        url: row.channel_url,
        referer: nullable(row.channel_referer),
        origin: nullable(row.channel_origin),
        vpn: bool(row.need_vpn),
        iran: bool(row.for_iran),
        popular: BigInt(int(row.popular)),
        vip: bool(row.isvip),
        categoryId,
        categoryName: nullable(row.category_name),
        categoryNameEn: nullable(row.category_name_en),
      },
      create: {
        id: channelId,
        name: row.channel_name,
        nameEn: row.channel_name_en,
        image: nullable(row.channel_image),
        url: row.channel_url,
        referer: nullable(row.channel_referer),
        origin: nullable(row.channel_origin),
        vpn: bool(row.need_vpn),
        iran: bool(row.for_iran),
        popular: BigInt(int(row.popular)),
        vip: bool(row.isvip),
        categoryId,
        categoryName: nullable(row.category_name),
        categoryNameEn: nullable(row.category_name_en),
      },
    });

    for (const source of parseSources(row.sourses, channelId)) {
      if (seenSources.has(source.id)) {
        throw new Error(`Duplicate source ID in seed data: ${source.id}`);
      }
      seenSources.add(source.id);

      await prisma.source.upsert({
        where: { id: source.id },
        update: source,
        create: source,
      });
    }
  }

  console.log(`Seeded ${seenChannels.size} channels and ${seenSources.size} sources from ${path.relative(process.cwd(), DATA_FILE)}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
