import { Router } from 'express';
import { getTransacciones, createTransaccion, anularTransaccion, updateTransaccion, getCierresCaja, createCierreCaja } from '../controllers/finanzas.controller';

const router = Router();

// =======================
// RUTAS TRANSACCIONES
// =======================
router.get('/transacciones', getTransacciones);
router.post('/transacciones', createTransaccion);
router.put('/transacciones/:id/anular', anularTransaccion);
router.put('/transacciones/:id', updateTransaccion);

// =======================
// RUTAS CIERRE CAJA
// =======================
router.get('/cierres', getCierresCaja);
router.post('/cierres', createCierreCaja);

export default router;
