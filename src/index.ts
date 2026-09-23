import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './prisma';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// (Prisma client moved to src/prisma.ts)

// Importar Rutas Principales
import apiRoutes from './routes/index.routes';

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Main API Router
app.use('/api', apiRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
  res.send('API Taller Backend Funcionado Correctamente');
});

// ⚠️ ENDPOINT TEMPORAL DE LIMPIEZA GENERAL
app.delete('/api/admin/limpiar-todo', async (req: Request, res: Response) => {
  const secret = req.headers['x-secret-key'];
  if (secret !== 'LIMPIAR-TODO-JP-2026') {
    res.status(403).json({ error: 'No autorizado' });
    return;
  }
  try {
    const log: any = {};

    // 1. Cierres de Caja
    const cierres = await prisma.cierreCaja.deleteMany({});
    log.cierresEliminados = cierres.count;

    // 2. Transacciones
    const txns = await prisma.transaccion.deleteMany({});
    log.transaccionesEliminadas = txns.count;

    // 3. Movimientos de inventario
    const movs = await prisma.movimientoInventario.deleteMany({});
    log.movimientosEliminados = movs.count;

    // 4. Citas del taller
    const citas = await prisma.cita.deleteMany({});
    log.citasEliminadas = citas.count;

    // 5. Desconectar Trabajadores de Guías (many-to-many) usando raw SQL
    await prisma.$executeRaw`DELETE FROM "_GuiaTrabajadores"`;
    log.relacionesGuiaTrabajadorEliminadas = true;

    // 6. Asistencias
    const asistencias = await prisma.asistencia.deleteMany({});
    log.asistenciasEliminadas = asistencias.count;

    // 7. Trabajadores
    const trabajadores = await prisma.trabajador.deleteMany({});
    log.trabajadoresEliminados = trabajadores.count;

    // 8. Productos
    const productos = await prisma.producto.deleteMany({});
    log.productosEliminados = productos.count;

    // 9. Cotizaciones
    const cotizaciones = await prisma.cotizacion.deleteMany({});
    log.cotizacionesEliminadas = cotizaciones.count;

    // 10. Reseñas
    const resenas = await prisma.resena.deleteMany({});
    log.resenasEliminadas = resenas.count;

    // 11. Usuarios
    const usuarios = await prisma.usuario.deleteMany({});
    log.usuariosEliminados = usuarios.count;

    // 12. Obtener IDs de clientes y vehículos usados en guías (conservar)
    const guias = await prisma.numeroGuia.findMany({ select: { clienteId: true, vehiculoId: true } });
    const clientesConGuia = [...new Set(guias.map(g => g.clienteId))];
    const vehiculosConGuia = [...new Set(guias.map(g => g.vehiculoId))];

    // 13. Borrar clientes SIN guías
    const clientes = await prisma.cliente.deleteMany({
      where: { id: { notIn: clientesConGuia.length > 0 ? clientesConGuia : [-1] } }
    });
    log.clientesEliminados = clientes.count;
    log.clientesConservados = clientesConGuia.length;

    // 14. Borrar vehículos SIN guías
    const vehiculos = await prisma.vehiculo.deleteMany({
      where: { id: { notIn: vehiculosConGuia.length > 0 ? vehiculosConGuia : [-1] } }
    });
    log.vehiculosEliminados = vehiculos.count;
    log.vehiculosConservados = vehiculosConGuia.length;

    res.json({ ok: true, ...log });
  } catch (error: any) {
    console.error('Error en limpieza:', error);
    res.status(500).json({ error: 'Error al limpiar', detalle: error?.message });
  }
});

// Inicialización: crear configuración admin por defecto si no existe
async function initAdmin() {
  try {
    const config = await prisma.configuracion.findFirst();
    if (!config) {
      await prisma.configuracion.create({
        data: {
          id: 1,
          nombreResponsable: 'Administrador',
          email: 'admin@tallerjp.com',
          telefono: '+51 999 888 777',
          nombreTaller: 'Frenos y Embragues Juan Pablo',
          ruc: '20601234567',
          direccion: 'Av. Los Mecánicos 123, Lima',
          usuario: 'administrador',
          password: 'TallerJuanP2026'
        }
      });
      console.log('[INIT] Configuración admin creada exitosamente (administrador / TallerJuanP2026)');
    } else {
      // Forzar actualización de credenciales para producción/desarrollo si ya existe configuración
      await prisma.configuracion.update({
        where: { id: config.id },
        data: {
          usuario: 'administrador',
          password: 'TallerJuanP2026'
        }
      });
      console.log('[INIT] Configuración admin actualizada a (administrador / TallerJuanP2026)');
    }
  } catch (error) {
    console.error('[INIT] Error al crear o actualizar configuración admin:', error);
  }
}

// Inicialización del servidor
const server = app.listen(port, () => {
  console.log(`[server]: Servidor corriendo en http://localhost:${port}`);
  initAdmin();
});

// Manejo de errores en el servidor (ej: EADDRINUSE)
server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[PDF-ERROR] El puerto ${port} ya está en uso. Por favor, cierra el proceso anterior.`);
  } else {
    console.error(`[PDF-ERROR] Error en el servidor:`, error);
  }
  process.exit(1);
});

// Intervalo de mantenimiento para asegurar que el event loop no se vacíe (especialmente en Windows local)
setInterval(() => {
    // Keep alive
}, 60000);
