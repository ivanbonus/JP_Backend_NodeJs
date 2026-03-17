"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const taller_controller_1 = require("../controllers/taller.controller");
const router = (0, express_1.Router)();
// =======================
// RUTAS NUMEROS DE GUIA
// =======================
router.get('/guias', taller_controller_1.getGuias);
router.post('/guias', taller_controller_1.createGuia);
router.put('/guias/:id', taller_controller_1.updateGuia);
router.delete('/guias/:id', taller_controller_1.deleteGuia);
// =======================
// RUTAS VEHICULOS (TALLER)
// =======================
router.post('/vehiculos', taller_controller_1.createVehiculo);
// =======================
// RUTAS CITAS
// =======================
router.get('/citas', taller_controller_1.getCitas);
router.post('/citas', taller_controller_1.createCita);
router.delete('/citas/:id', taller_controller_1.deleteCita);
exports.default = router;
