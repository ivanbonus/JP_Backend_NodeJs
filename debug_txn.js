const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const v = await prisma.transaccion.findMany({
    where: { numero: { startsWith: 'WEB-' } },
    orderBy: { id: 'desc' },
    take: 5
  });
  console.log('Ultimas ventas WEB:', JSON.stringify(v, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
