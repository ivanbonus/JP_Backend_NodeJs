import { Router } from 'express';
import {
    catalogosCompras, resumenCompras, historialCompras,
    listarProveedores, crearProveedor, actualizarProveedor,
    listarDocumentos, obtenerDocumento, crearDocumento, actualizarDocumento,
    revisarDocumento, marcarContabilidad, anularDocumento,
    subirArchivosDocumento, enlaceArchivoCompra, quitarArchivoCompra,
    registrarPagoProveedor, anularAsignacion, pagosDisponibles, cuentasPorPagar,
} from '../controllers/compras.controller';
import { requireRole } from '../middlewares/auth.middleware';
import { ROLES } from '../auth/security';

// Compras, proveedores y cuentas por pagar (Fase 3)
const router = Router();
const soloAdministrador = requireRole(ROLES.ADMIN);

router.get('/catalogos', catalogosCompras);
router.get('/resumen', resumenCompras);
router.get('/historial', historialCompras);

router.get('/proveedores', listarProveedores);
router.post('/proveedores', crearProveedor);
router.put('/proveedores/:id', actualizarProveedor);

router.get('/documentos', listarDocumentos);
router.get('/documentos/:id', obtenerDocumento);
router.post('/documentos', crearDocumento);
router.put('/documentos/:id', actualizarDocumento);
router.post('/documentos/:id/revision', soloAdministrador, revisarDocumento);
router.post('/documentos/:id/contabilidad', marcarContabilidad);
router.post('/documentos/:id/anular', soloAdministrador, anularDocumento);
router.post('/documentos/:id/archivos', subirArchivosDocumento);

router.get('/archivos/:id/enlace', enlaceArchivoCompra);
router.delete('/archivos/:id', soloAdministrador, quitarArchivoCompra);

router.get('/por-pagar', cuentasPorPagar);
router.get('/pagos/disponibles', pagosDisponibles);
router.post('/pagos', soloAdministrador, registrarPagoProveedor);
router.post('/asignaciones/:id/anular', soloAdministrador, anularAsignacion);

export default router;
