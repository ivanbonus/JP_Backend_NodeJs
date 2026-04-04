"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const inventario_controller_1 = require("../controllers/inventario.controller");
const router = (0, express_1.Router)();
// =======================
// RUTAS PRODUCTOS
// =======================
router.get('/', inventario_controller_1.getProductos);
router.post('/', inventario_controller_1.createProducto);
router.put('/:id', inventario_controller_1.updateProducto);
router.patch('/:id/toggle-web', inventario_controller_1.toggleVisibleWeb);
router.delete('/:id', inventario_controller_1.deleteProducto);
// =======================
// RUTAS MOVIMIENTOS STOCK
// =======================
router.post('/movimientos', inventario_controller_1.registrarMovimiento);
exports.default = router;
