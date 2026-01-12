import type { PrismaClient } from '@epiphany/database';

export async function cleanupTopicTestData(params: {
  prisma: PrismaClient;
  redis?: { del: (key: string) => Promise<unknown> };
  topicId: string | null | undefined;
}): Promise<void> {
  const { prisma, redis, topicId } = params;
  if (!topicId) return;

  try {
    await prisma.$transaction([
      prisma.topic.updateMany({ where: { id: topicId }, data: { rootArgumentId: null } }),
      prisma.stake.deleteMany({ where: { topicId } }),
      prisma.clusterData.deleteMany({ where: { topicId } }),
      prisma.camp.deleteMany({ where: { topicId } }),
      prisma.consensusReport.deleteMany({ where: { topicId } }),
      prisma.argument.deleteMany({ where: { topicId } }),
      prisma.ledger.deleteMany({ where: { topicId } }),
      prisma.topic.deleteMany({ where: { id: topicId } }),
    ]);
  } catch {
    // best-effort cleanup only
  }

  try {
    await redis?.del(`topic:events:${topicId}`);
  } catch {
    // ignore
  }
}
