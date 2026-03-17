"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const personal_controller_1 = require("../controllers/personal.controller");
const router = (0, express_1.Router)();
// =======================
// RUTAS PERSONAL (TRABAJADORES)
// =======================
router.get('/', personal_controller_1.getPersonal);
router.post('/', personal_controller_1.createTrabajador);
router.put('/:id', personal_controller_1.updateTrabajador);
router.delete('/:id', personal_controller_1.deleteTrabajador);
exports.default = router;
