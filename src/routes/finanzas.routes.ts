import { Router } from 'express';
import { getTransacciones, createTransaccion, anularTransaccion, updateTransaccion, getCierresCaja, createCierreCaja, generarBoletaPdf } from '../controllers/finanzas.controller';

import { requireRole } from '../middlewares/auth.middleware';
import { ROLES } from '../auth/security';

const router = Router();

// =======================
// RUTAS TRANSACCIONES
// =======================
router.get('/transacciones', getTransacciones);
router.post('/transacciones', createTransaccion);
// Anular una operación financiera: solo administrador
router.put('/transacciones/:id/anular', requireRole(ROLES.ADMIN), anularTransaccion);
router.put('/transacciones/:id', updateTransaccion);
router.post('/transacciones/:id/boleta', generarBoletaPdf);

// =======================
// RUTAS CIERRE CAJA
// =======================
router.get('/cierres', getCierresCaja);
router.post('/cierres', createCierreCaja);

export default router;
