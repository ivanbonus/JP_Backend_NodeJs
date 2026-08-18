const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const cotizaciones = await prisma.cotizacion.findMany({
        where: {
            nombre: {
                contains: '(Copia)'
            }
        }
    });

    for (const cot of cotizaciones) {
        const newName = cot.nombre.replace(/\s*\(Copia\)/g, '').trim();
        await prisma.cotizacion.update({
            where: { id: cot.id },
            data: { nombre: newName }
        });
        console.log(`Updated ID ${cot.id} to ${newName}`);
    }
    console.log("Done updating names.");
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
