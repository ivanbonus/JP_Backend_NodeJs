import { Router } from 'express';
import { getProductos, createProducto, registrarMovimiento, updateProducto, deleteProducto, toggleVisibleWeb } from '../controllers/inventario.controller';

const router = Router();

// =======================
// RUTAS PRODUCTOS
// =======================
router.get('/', getProductos);
router.post('/', createProducto);
router.put('/:id', updateProducto);
router.patch('/:id/toggle-web', toggleVisibleWeb);
router.delete('/:id', deleteProducto);

// =======================
// RUTAS MOVIMIENTOS STOCK
// =======================
router.post('/movimientos', registrarMovimiento);

export default router;
