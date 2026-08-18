import { Router } from 'express';
import { createCotizacion, getCotizaciones, updateCotizacionStatus, generarCotizacionPdf, responderCotizacion, responderYGenerarPdfWhatsapp, duplicarCotizacion } from '../controllers/cotizacion.controller';

const router = Router();

router.post('/', createCotizacion);
router.get('/', getCotizaciones);
router.put('/:id', updateCotizacionStatus);
router.post('/pdf', generarCotizacionPdf);
router.post('/:id/responder', responderCotizacion);
router.post('/:id/whatsapp', responderYGenerarPdfWhatsapp);
router.post('/:id/duplicar', duplicarCotizacion);

export default router;
