import { Router } from 'express';
import { getTransacciones, createTransaccion, anularTransaccion, updateTransaccion, getCierresCaja, createCierreCaja, generarBoletaPdf } from '../controllers/finanzas.controller';

import { obtenerPagos, registrarPago, verificarPedidoWeb } from '../controllers/cobros.controller';
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
// Cobros: pagos en partes (adelantos/abonos) y verificación de pedidos web (Fase 2C)
router.get('/transacciones/:id/pagos', obtenerPagos);
router.post('/transacciones/:id/pagos', registrarPago);
router.post('/transacciones/:id/verificar', requireRole(ROLES.ADMIN), verificarPedidoWeb);
router.post('/transacciones/:id/boleta', generarBoletaPdf);

// =======================
// RUTAS CIERRE CAJA
// =======================
router.get('/cierres', getCierresCaja);
router.post('/cierres', createCierreCaja);

export default router;
