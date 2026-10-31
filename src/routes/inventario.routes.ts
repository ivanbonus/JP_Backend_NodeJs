import { Router } from 'express';
import {
  getProductos, createProducto, registrarMovimiento, updateProducto, deleteProducto, toggleVisibleWeb,
  fichaProducto, obtenerConfigInventario, actualizarUmbralAlzaCosto,
} from '../controllers/inventario.controller';
import { requireRole } from '../middlewares/auth.middleware';
import { ROLES } from '../auth/security';

const router = Router();

// =======================
// RUTAS PRODUCTOS
// =======================
router.get('/', getProductos);
router.post('/', createProducto);
router.get('/configuracion', obtenerConfigInventario);
router.put('/configuracion/umbral-alza-costo', requireRole(ROLES.ADMIN), actualizarUmbralAlzaCosto);
router.get('/:id/ficha', fichaProducto);
router.put('/:id', updateProducto);
router.patch('/:id/toggle-web', toggleVisibleWeb);
router.delete('/:id', deleteProducto);

// =======================
// RUTAS MOVIMIENTOS STOCK
// =======================
router.post('/movimientos', registrarMovimiento);

export default router;
