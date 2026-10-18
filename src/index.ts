import './env';
import express, { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { randomBytes } from 'crypto';
import { prisma } from './prisma';
import { hashPassword } from './auth/security';

// Importar Rutas Principales
import apiRoutes from './routes/index.routes';

const app: Express = express();
const port = process.env.PORT || 3000;

// Render (y otros hosts) pasan las peticiones por un proxy: necesario para el límite de intentos por IP
app.set('trust proxy', 1);

// Cabeceras de seguridad
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS: si CORS_ORIGINS está definido, solo esos dominios (separados por coma)
const origenesPermitidos = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);
if (origenesPermitidos.length === 0) {
  console.warn('[SEGURIDAD] CORS_ORIGINS no definido: se aceptan peticiones de cualquier dominio.');
}
app.use(cors(origenesPermitidos.length ? { origin: origenesPermitidos } : undefined));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Main API Router
app.use('/api', apiRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
  res.send('API Taller Backend Funcionado Correctamente');
});

// Errores no controlados (JSON mal formado, cuerpo demasiado grande, etc.): sin exponer detalles internos
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido.' });
    return;
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'El archivo o los datos enviados son demasiado grandes.' });
    return;
  }
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

/**
 * Inicialización: crea la configuración del taller si no existe.
 * Ya NO sobrescribe las credenciales existentes en cada arranque.
 * La contraseña inicial solo se toma de ADMIN_INITIAL_PASSWORD (nunca del código).
 */
async function initAdmin() {
  try {
    const config = await prisma.configuracion.findFirst();
    if (config) return;

    const inicial = process.env.ADMIN_INITIAL_PASSWORD;
    await prisma.configuracion.create({
      data: {
        id: 1,
        nombreResponsable: 'Administrador',
        nombreTaller: 'Frenos y Embragues Juan Pablo',
        usuario: 'administrador',
        // Sin contraseña inicial se guarda una aleatoria: nadie puede entrar con un valor por defecto
        password: await hashPassword(inicial || randomBytes(32).toString('hex')),
      }
    });
    console.log(
      inicial
        ? '[INIT] Configuración creada con la contraseña de ADMIN_INITIAL_PASSWORD.'
        : '[INIT] Configuración creada SIN contraseña: define ADMIN_INITIAL_PASSWORD y reinicia, o crea un usuario ADMIN.'
    );
  } catch (error) {
    console.error('[INIT] Error al crear la configuración inicial:', error);
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
    console.error(`[server] El puerto ${port} ya está en uso. Por favor, cierra el proceso anterior.`);
  } else {
    console.error(`[server] Error en el servidor:`, error);
  }
  process.exit(1);
});

// Intervalo de mantenimiento para asegurar que el event loop no se vacíe (especialmente en Windows local)
setInterval(() => {
    // Keep alive
}, 60000);
