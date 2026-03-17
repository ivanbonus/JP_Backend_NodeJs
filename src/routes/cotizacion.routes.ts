import { Router } from 'express';
import { createCotizacion, getCotizaciones, updateCotizacionStatus } from '../controllers/cotizacion.controller';

const router = Router();

router.post('/', createCotizacion);
router.get('/', getCotizaciones);
router.put('/:id', updateCotizacionStatus);

export default router;
