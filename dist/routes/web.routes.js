"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const web_controller_1 = require("../controllers/web.controller");
const router = (0, express_1.Router)();
// Rutas Públicas
router.post('/resenas', web_controller_1.crearResena);
router.get('/resenas/publicadas', web_controller_1.obtenerResenasPublicadas);
router.post('/reclamaciones', web_controller_1.crearReclamacion);
router.post('/postulaciones', web_controller_1.crearPostulacion);
router.get('/productos-web', web_controller_1.getProductosWeb);
router.post('/ventas', web_controller_1.registrarVentaWeb);
// Rutas Admin
router.get('/resenas', web_controller_1.obtenerTodasResenas);
router.put('/resenas/:id', web_controller_1.actualizarEstadoResena);
router.delete('/resenas/:id', web_controller_1.eliminarResena);
router.get('/reclamaciones', web_controller_1.obtenerReclamaciones);
router.patch('/reclamaciones/:id/estado', web_controller_1.actualizarEstadoReclamacion);
router.get('/postulaciones', web_controller_1.obtenerPostulaciones);
router.patch('/postulaciones/:id/estado', web_controller_1.actualizarEstadoPostulacion);
router.get('/ventas', web_controller_1.obtenerVentasWeb);
exports.default = router;
