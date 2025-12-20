import { PrismaClient, Prisma } from '@prisma/client';

let prismaClient: PrismaClient | undefined;

export function getPrisma() {
  prismaClient ??= new PrismaClient();
  return prismaClient;
}

export { PrismaClient, Prisma };

