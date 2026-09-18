import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config();
const prisma = new PrismaClient();
async function limpiar() {
  console.log('Limpiando Transacciones...');
  const txns = await prisma.transaccion.deleteMany({});
  console.log(txns.count + ' transacciones eliminadas.');
  console.log('Limpiando Cierres de Caja...');
  const cierres = await prisma.cierreCaja.deleteMany({});
  console.log(cierres.count + ' cierres eliminados.');
  console.log('Listo!');
  await prisma.$disconnect();
}
limpiar().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
