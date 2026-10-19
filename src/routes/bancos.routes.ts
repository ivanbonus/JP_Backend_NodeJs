import { Router } from 'express';
import {
    obtenerConfiguracion, actualizarUmbral,
    listarCuentas, crearCuenta, actualizarCuenta,
    listarMovimientos, obtenerMovimiento, crearMovimiento, actualizarMovimiento,
    anularMovimiento, revisarMovimiento, conciliarMovimiento,
    subirComprobantes, enlaceArchivo, quitarArchivo,
    resumenBancario, exportarMovimientos,
} from '../controllers/bancos.controller';
import {
    previsualizarExtracto, importarExtracto, estadoConciliacion,
    vincular, desvincular, registrarDesdeLinea, ignorarLinea, reconciliar,
} from '../controllers/conciliacion.controller';
import { requireRole } from '../middlewares/auth.middleware';
import { ROLES } from '../auth/security';

const router = Router();
const soloAdministrador = requireRole(ROLES.ADMIN);

router.get('/configuracion', obtenerConfiguracion);
router.put('/configuracion/umbral', soloAdministrador, actualizarUmbral);

router.get('/resumen', resumenBancario);

router.get('/cuentas', listarCuentas);
router.post('/cuentas', soloAdministrador, crearCuenta);
router.put('/cuentas/:id', soloAdministrador, actualizarCuenta);

router.get('/movimientos', listarMovimientos);
router.get('/movimientos/exportar', exportarMovimientos);
router.get('/movimientos/:id', obtenerMovimiento);
router.post('/movimientos', crearMovimiento);
router.put('/movimientos/:id', actualizarMovimiento);
router.post('/movimientos/:id/anular', soloAdministrador, anularMovimiento);
router.post('/movimientos/:id/revision', soloAdministrador, revisarMovimiento);
router.post('/movimientos/:id/conciliar', soloAdministrador, conciliarMovimiento);
router.post('/movimientos/:id/archivos', subirComprobantes);

router.get('/archivos/:id/enlace', enlaceArchivo);
router.delete('/archivos/:id', quitarArchivo);

// Conciliación con extractos bancarios (Fase 2B)
router.post('/extractos/previsualizar', soloAdministrador, previsualizarExtracto);
router.post('/extractos/importar', soloAdministrador, importarExtracto);
router.get('/conciliacion', estadoConciliacion);
router.post('/conciliacion/vincular', soloAdministrador, vincular);
router.post('/conciliacion/desvincular', soloAdministrador, desvincular);
router.post('/conciliacion/registrar-desde-linea', soloAdministrador, registrarDesdeLinea);
router.post('/conciliacion/ignorar', soloAdministrador, ignorarLinea);
router.post('/conciliacion/reconciliar', soloAdministrador, reconciliar);

export default router;
