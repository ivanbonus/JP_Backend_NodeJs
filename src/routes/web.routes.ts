import { Router } from 'express';
import { 
    crearResena, 
    obtenerResenasPublicadas, 
    obtenerTodasResenas, 
    actualizarEstadoResena, 
    eliminarResena 
} from '../controllers/web.controller';

const router = Router();

// Rutas Públicas
router.post('/resenas', crearResena);
router.get('/resenas/publicadas', obtenerResenasPublicadas);

// Rutas Admin
router.get('/resenas', obtenerTodasResenas);
router.put('/resenas/:id', actualizarEstadoResena);
router.delete('/resenas/:id', eliminarResena);

export default router;
