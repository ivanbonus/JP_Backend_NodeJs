import { Router } from 'express';
import tallerRoutes from './taller.routes';
import clientesRoutes from './clientes.routes';
import personalRoutes from './personal.routes';
import inventarioRoutes from './inventario.routes';
import finanzasRoutes from './finanzas.routes';
import dashboardRoutes from './dashboard.routes';
import configuracionRoutes from './configuracion.routes';
import authRoutes from './auth.routes';
import cotizacionRoutes from './cotizacion.routes';

const router = Router();

router.use('/taller', tallerRoutes);
router.use('/clientes', clientesRoutes);
router.use('/personal', personalRoutes);
router.use('/inventario', inventarioRoutes);
router.use('/finanzas', finanzasRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/configuracion', configuracionRoutes);
router.use('/auth', authRoutes);
router.use('/cotizaciones', cotizacionRoutes);

export default router;
