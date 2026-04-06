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
    responderReclamacion
} from '../controllers/web.controller';
import { 
    crearCitaWeb, 
    obtenerCitasWeb, 
    actualizarEstadoCitaWeb 
} from '../controllers/webCita.controller';
import { crearBloqueo, obtenerBloqueos, eliminarBloqueo } from "../controllers/bloqueoCita.controller";

const router = Router();

// Rutas Públicas
router.post('/resenas', crearResena);
router.get('/resenas/publicadas', obtenerResenasPublicadas);
router.post('/reclamaciones', crearReclamacion);
router.post('/postulaciones', crearPostulacion);
router.get('/productos-web', getProductosWeb);
router.post('/ventas', registrarVentaWeb);
router.post('/citas', crearCitaWeb);

// Rutas Admin
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
router.get("/bloqueos", obtenerBloqueos);
router.post("/bloqueos", crearBloqueo);
router.delete("/bloqueos/:id", eliminarBloqueo);

export default router;
