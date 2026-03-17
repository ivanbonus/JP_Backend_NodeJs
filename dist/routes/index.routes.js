"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const taller_routes_1 = __importDefault(require("./taller.routes"));
const clientes_routes_1 = __importDefault(require("./clientes.routes"));
const personal_routes_1 = __importDefault(require("./personal.routes"));
const inventario_routes_1 = __importDefault(require("./inventario.routes"));
const finanzas_routes_1 = __importDefault(require("./finanzas.routes"));
const dashboard_routes_1 = __importDefault(require("./dashboard.routes"));
const router = (0, express_1.Router)();
router.use('/taller', taller_routes_1.default);
router.use('/clientes', clientes_routes_1.default);
router.use('/personal', personal_routes_1.default);
router.use('/inventario', inventario_routes_1.default);
router.use('/finanzas', finanzas_routes_1.default);
router.use('/dashboard', dashboard_routes_1.default);
// Pronto añadiremos los demás módulos...
exports.default = router;
