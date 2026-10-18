import { Router } from 'express';
import { 
    crearResena, 
    obtenerResenasPublicadas, 
    obtenerTodasResenas, 
    actualizarEstadoResena, 
    eliminarResena,
    crearReclamacion,
    obtenerReclamaciones,
    actualizarEstadoReclamacion,
    crearPostulacion,
    obtenerPostulaciones,
    actualizarEstadoPostulacion,
    getProductosWeb,
    registrarVentaWeb,
    obtenerVentasWeb,
    responderReclamacion,
    obtenerNovedadesWeb,
    obtenerTodasNovedadesAdmin,
    crearNovedad,
    actualizarNovedad,
    eliminarNovedad,
    darLikeNovedad
} from '../controllers/web.controller';
import { 
    crearCitaWeb, 
    obtenerCitasWeb, 
    actualizarEstadoCitaWeb 
} from '../controllers/webCita.controller';
import { crearBloqueo, obtenerBloqueos, eliminarBloqueo } from "../controllers/bloqueoCita.controller";
import { createCotizacion } from '../controllers/cotizacion.controller';
import { generarBoletaPdf } from '../controllers/finanzas.controller';
import { panelOperativo } from '../middlewares/auth.middleware';
import { verificarTokenBoleta } from '../auth/security';

const router = Router();

// Rutas Públicas
router.post('/resenas', crearResena);
router.get('/resenas/publicadas', obtenerResenasPublicadas);
router.post('/reclamaciones', crearReclamacion);
router.post('/postulaciones', crearPostulacion);
router.post('/cotizaciones', createCotizacion);
router.get('/productos-web', getProductosWeb);
router.post('/ventas', registrarVentaWeb);
// Boleta de una compra web: solo con el token entregado al registrar esa venta
router.post('/ventas/:id/boleta', (req, res, next) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!verificarTokenBoleta(token, Number(req.params.id))) {
        res.status(403).json({ error: 'El enlace de la boleta no es válido o expiró.' });
        return;
    }
    next();
}, generarBoletaPdf);
router.post('/citas', crearCitaWeb);
router.get('/novedades', obtenerNovedadesWeb);
router.post('/novedades/:id/like', darLikeNovedad);
router.get("/bloqueos", obtenerBloqueos);

// ── A partir de aquí: panel administrativo ──
router.use(panelOperativo);

// Rutas Admin
router.get('/admin/novedades', obtenerTodasNovedadesAdmin);
router.post('/admin/novedades', crearNovedad);
router.put('/admin/novedades/:id', actualizarNovedad);
router.delete('/admin/novedades/:id', eliminarNovedad);

router.get('/resenas', obtenerTodasResenas);
router.put('/resenas/:id', actualizarEstadoResena);
router.delete('/resenas/:id', eliminarResena);

router.get('/reclamaciones', obtenerReclamaciones);
router.patch('/reclamaciones/:id/estado', actualizarEstadoReclamacion);
router.post('/reclamaciones/:id/responder', responderReclamacion);

router.get('/postulaciones', obtenerPostulaciones);
router.patch('/postulaciones/:id/estado', actualizarEstadoPostulacion);
router.get('/ventas', obtenerVentasWeb);

// Citas
router.get("/admin/citas", obtenerCitasWeb); // Ruta para admin
router.patch("/citas/:id/estado", actualizarEstadoCitaWeb);

// Bloqueos de Disponibilidad
router.post("/bloqueos", crearBloqueo);
router.delete("/bloqueos/:id", eliminarBloqueo);

export default router;
