"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const configuracion_controller_1 = require("../controllers/configuracion.controller");
const router = (0, express_1.Router)();
router.get('/', configuracion_controller_1.getConfiguracion);
router.put('/', configuracion_controller_1.updateConfiguracion);
exports.default = router;
