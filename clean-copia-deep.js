const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const cotizaciones = await prisma.cotizacion.findMany();

    for (const cot of cotizaciones) {
        let updated = false;
        
        let newName = cot.nombre;
        if (newName.includes('(Copia)')) {
            newName = newName.replace(/\s*\(Copia\)/g, '').trim();
            updated = true;
        }

        let newDatos = cot.datosCotizacion;
        if (newDatos && newDatos.clienteNombre && newDatos.clienteNombre.includes('(Copia)')) {
            newDatos.clienteNombre = newDatos.clienteNombre.replace(/\s*\(Copia\)/g, '').trim();
            updated = true;
        }

        if (updated) {
            await prisma.cotizacion.update({
                where: { id: cot.id },
                data: { 
                    nombre: newName,
                    datosCotizacion: newDatos
                }
            });
            console.log(`Deep cleaned ID ${cot.id}`);
        }
    }
    console.log("Done deep cleaning.");
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
