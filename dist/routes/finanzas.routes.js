"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const finanzas_controller_1 = require("../controllers/finanzas.controller");
const router = (0, express_1.Router)();
// =======================
// RUTAS TRANSACCIONES
// =======================
router.get('/transacciones', finanzas_controller_1.getTransacciones);
router.post('/transacciones', finanzas_controller_1.createTransaccion);
router.put('/transacciones/:id/anular', finanzas_controller_1.anularTransaccion);
router.put('/transacciones/:id', finanzas_controller_1.updateTransaccion);
// =======================
// RUTAS CIERRE CAJA
// =======================
router.get('/cierres', finanzas_controller_1.getCierresCaja);
router.post('/cierres', finanzas_controller_1.createCierreCaja);
exports.default = router;
