"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const clientes_controller_1 = require("../controllers/clientes.controller");
const router = (0, express_1.Router)();
// =======================
// RUTAS CLIENTES
// =======================
router.get('/', clientes_controller_1.getClientes);
router.post('/', clientes_controller_1.createCliente);
router.put('/:id', clientes_controller_1.updateCliente);
router.delete('/:id', clientes_controller_1.deleteCliente);
exports.default = router;
