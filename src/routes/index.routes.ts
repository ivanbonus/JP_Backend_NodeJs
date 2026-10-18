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
import webRoutes from './web.routes';
import usuariosRoutes from './usuarios.routes';
import { panelOperativo, soloAdmin, requireAuth, requireRole } from '../middlewares/auth.middleware';
import { ROLES_PANEL } from '../auth/security';
import { auditarCambios } from '../auth/auditoria';
import { listarAuditoria } from '../controllers/auditoria.controller';
import { servirMedia } from '../utils/media';

const router = Router();

// Públicas (con sus propias rutas protegidas internamente)
router.use('/auth', authRoutes);
// Fotos y videos (pública, pero solo con la huella exacta del contenido)
router.get('/media/:tipo/:id/:hash', servirMedia);
router.use('/web', auditarCambios('web'), webRoutes);
router.use('/cotizaciones', auditarCambios('cotizaciones'), cotizacionRoutes);

// Panel administrativo: requieren sesión, rol y quedan auditadas
router.use('/taller', panelOperativo, auditarCambios('taller'), tallerRoutes);
router.use('/clientes', panelOperativo, auditarCambios('clientes'), clientesRoutes);
router.use('/inventario', panelOperativo, auditarCambios('inventario'), inventarioRoutes);
router.use('/finanzas', panelOperativo, auditarCambios('finanzas'), finanzasRoutes);
router.use('/dashboard', requireAuth, requireRole(...ROLES_PANEL), dashboardRoutes);
router.use('/personal', soloAdmin, auditarCambios('personal'), personalRoutes);
router.use('/configuracion', soloAdmin, auditarCambios('configuracion'), configuracionRoutes);
router.use('/usuarios', auditarCambios('usuarios'), usuariosRoutes);
router.get('/auditoria', soloAdmin, listarAuditoria);

export default router;
