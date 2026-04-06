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
app.listen(port, () => {
  console.log(`[server]: Servidor corriendo en http://localhost:${port}`);
});
