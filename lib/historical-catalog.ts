import { prisma } from './prisma';

export type HistoricalStatus = 'MEMORY' | 'SHUTDOWN';

export type HistoricalChannel = {
  id: number;
  name: string;
  nameEn: string;
  image: string | null;
  status: HistoricalStatus;
  note: string | null;
  since: string | null;
  channelId: number | null;
  category: string | null;
};

const select = {
  id: true,
  name: true,
  nameEn: true,
  image: true,
  archiveStatus: true,
  archiveNote: true,
  archiveSince: true,
  categoryName: true,
} as const;

export async function getHistoricalChannels(status?: HistoricalStatus): Promise<HistoricalChannel[]> {
  if (!process.env.DATABASE_URL?.trim()) return [];
  try {
    const rows = await prisma.channel.findMany({
      ...(status ? { where: { archiveStatus: status } } : {}),
      select,
      orderBy: [{ archiveSince: 'desc' }, { name: 'asc' }],
    });
    return rows.filter((row) => row.archiveStatus).map((row) => ({
      id: row.id,
      name: row.name,
      nameEn: row.nameEn,
      image: row.image,
      status: row.archiveStatus as HistoricalStatus,
      note: row.archiveNote,
      since: row.archiveSince?.toISOString() ?? null,
      channelId: row.id,
      category: row.categoryName,
    }));
  } catch (error) {
    console.warn('[historical-catalog] Unable to load historical catalog.', error);
    return [];
  }
}

export async function updateHistoricalChannel(input: {
  channelId: number;
  status: HistoricalStatus | null;
  note?: string | null;
  since?: string | null;
}) {
  const status = input.status ?? null;
  return prisma.channel.update({
    where: { id: input.channelId },
    data: {
      archiveStatus: status,
      archiveNote: status ? (input.note?.trim() || null) : null,
      archiveSince: status && input.since ? new Date(input.since) : null,
    },
    select: { id: true, name: true, archiveStatus: true, archiveNote: true, archiveSince: true },
  });
}
