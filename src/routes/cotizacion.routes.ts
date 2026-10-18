import { Router } from 'express';
import { createCotizacion, getCotizaciones, updateCotizacionStatus, generarCotizacionPdf, responderCotizacion, responderYGenerarPdfWhatsapp, duplicarCotizacion } from '../controllers/cotizacion.controller';

import { panelOperativo } from '../middlewares/auth.middleware';

const router = Router();

// Pública: formulario de cotización de la web
router.post('/', createCotizacion);

// Panel administrativo
router.use(panelOperativo);
router.get('/', getCotizaciones);
router.put('/:id', updateCotizacionStatus);
router.post('/pdf', generarCotizacionPdf);
router.post('/:id/responder', responderCotizacion);
router.post('/:id/whatsapp', responderYGenerarPdfWhatsapp);
router.post('/:id/duplicar', duplicarCotizacion);

export default router;
