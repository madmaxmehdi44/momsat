import { prisma } from './prisma';
import { fetchCatalog, categoriesOf, Channel } from './source';

export type { Channel };

const dbInclude = {
  category: { select: { name: true, nameEn: true } },
  sources: {
    orderBy: [{ vip: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, title: true, url: true, referer: true, origin: true, country: true, vip: true },
  },
};

type DbChannel = Awaited<ReturnType<typeof prisma.channel.findMany>>[number] & {
  category: { name: string; nameEn: string };
  sources: Array<{ id: number; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean }>;
};

function toCatalog(channel: DbChannel): Channel {
  const primary = channel.url
    ? [{ id: null, title: 'Primary', url: channel.url, referer: channel.referer, origin: channel.origin, country: null, vip: channel.vip }]
    : [];
  const sources = Array.from(new Map([...primary, ...channel.sources].map((source) => [source.url, source])).values());
  return {
    id: channel.id,
    catId: channel.categoryId,
    name: channel.name,
    nameEn: channel.nameEn,
    image: channel.image,
    url: channel.url,
    referer: channel.referer,
    origin: channel.origin,
    vpn: channel.vpn,
    iran: channel.iran,
    popular: Number(channel.popular),
    vip: channel.vip,
    category: channel.categoryName || channel.category.name,
    categoryEn: channel.categoryNameEn || channel.category.nameEn,
    sources,
  };
}

export async function getCatalog() {
  const rows = await prisma.channel.findMany({ orderBy: [{ popular: 'desc' }, { name: 'asc' }], include: dbInclude });
  return rows.length ? rows.map(toCatalog) : fetchCatalog();
}

export function getCategories(channels: Channel[]) {
  return categoriesOf(channels);
}

export async function findChannel(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await prisma.channel.findUnique({ where: { id }, include: dbInclude });
  if (row) return toCatalog(row);
  const channels = await fetchCatalog();
  return channels.find((channel) => channel.id === id) ?? null;
}
