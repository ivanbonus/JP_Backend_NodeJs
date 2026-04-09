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
app.use(express.json());

// Main API Router
app.use('/api', apiRoutes);

// Ruta de prueba
app.get('/', (req: Request, res: Response) => {
  res.send('API Taller Backend Funcionado Correctamente');
});

// Inicialización del servidor
const server = app.listen(port, () => {
  console.log(`[server]: Servidor corriendo en http://localhost:${port}`);
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
