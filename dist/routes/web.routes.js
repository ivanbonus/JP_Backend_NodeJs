"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const web_controller_1 = require("../controllers/web.controller");
const webCita_controller_1 = require("../controllers/webCita.controller");
const bloqueoCita_controller_1 = require("../controllers/bloqueoCita.controller");
const router = (0, express_1.Router)();
// Rutas Públicas
router.post('/resenas', web_controller_1.crearResena);
router.get('/resenas/publicadas', web_controller_1.obtenerResenasPublicadas);
router.post('/reclamaciones', web_controller_1.crearReclamacion);
router.post('/postulaciones', web_controller_1.crearPostulacion);
router.get('/productos-web', web_controller_1.getProductosWeb);
router.post('/ventas', web_controller_1.registrarVentaWeb);
router.post('/citas', webCita_controller_1.crearCitaWeb);
router.get('/novedades', web_controller_1.obtenerNovedadesWeb);
router.post('/novedades/:id/like', web_controller_1.darLikeNovedad);
// Rutas Admin
router.get('/admin/novedades', web_controller_1.obtenerTodasNovedadesAdmin);
router.post('/admin/novedades', web_controller_1.crearNovedad);
router.put('/admin/novedades/:id', web_controller_1.actualizarNovedad);
router.delete('/admin/novedades/:id', web_controller_1.eliminarNovedad);
router.get('/resenas', web_controller_1.obtenerTodasResenas);
router.put('/resenas/:id', web_controller_1.actualizarEstadoResena);
router.delete('/resenas/:id', web_controller_1.eliminarResena);
router.get('/reclamaciones', web_controller_1.obtenerReclamaciones);
router.patch('/reclamaciones/:id/estado', web_controller_1.actualizarEstadoReclamacion);
router.post('/reclamaciones/:id/responder', web_controller_1.responderReclamacion);
router.get('/postulaciones', web_controller_1.obtenerPostulaciones);
router.patch('/postulaciones/:id/estado', web_controller_1.actualizarEstadoPostulacion);
router.get('/ventas', web_controller_1.obtenerVentasWeb);
// Citas
router.get("/admin/citas", webCita_controller_1.obtenerCitasWeb); // Ruta para admin
router.patch("/citas/:id/estado", webCita_controller_1.actualizarEstadoCitaWeb);
// Bloqueos de Disponibilidad
router.get("/bloqueos", bloqueoCita_controller_1.obtenerBloqueos);
router.post("/bloqueos", bloqueoCita_controller_1.crearBloqueo);
router.delete("/bloqueos/:id", bloqueoCita_controller_1.eliminarBloqueo);
exports.default = router;
