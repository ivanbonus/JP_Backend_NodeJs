"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.obtenerVentasWeb = exports.registrarVentaWeb = exports.actualizarEstadoPostulacion = exports.obtenerPostulaciones = exports.crearPostulacion = exports.actualizarEstadoReclamacion = exports.obtenerReclamaciones = exports.crearReclamacion = exports.eliminarResena = exports.actualizarEstadoResena = exports.obtenerTodasResenas = exports.obtenerResenasPublicadas = exports.crearResena = exports.getProductosWeb = void 0;
const index_1 = require("../index");
// Obtener productos visibles en la web
const getProductosWeb = async (req, res) => {
    try {
        const productos = await index_1.prisma.producto.findMany({
            where: { visibleEnWeb: true },
            orderBy: { nombre: 'asc' }
        });
        res.json(productos);
    }
    catch (error) {
        console.error('Error al obtener productos web:', error);
        res.status(500).json({ error: 'Error del servidor.' });
    }
};
exports.getProductosWeb = getProductosWeb;
const crearResena = async (req, res) => {
    try {
        const { nombre, email, vehiculo, servicio, calificacion, comentario } = req.body;
        if (!nombre || calificacion === undefined || !comentario) {
            res.status(400).json({ error: 'Nombre, calificación y comentario son obligatorios.' });
            return;
        }
        const nuevaResena = await index_1.prisma.resena.create({
            data: {
                nombre,
                email,
                vehiculo,
                servicio,
                calificacion: parseFloat(calificacion),
                comentario,
                estado: 'Pendiente'
            }
        });
        res.status(201).json(nuevaResena);
    }
    catch (error) {
        console.error('Error al crear reseña:', error);
        res.status(500).json({ error: 'Error del servidor al guardar reseña.' });
    }
};
exports.crearResena = crearResena;
const obtenerResenasPublicadas = async (req, res) => {
    try {
        const resenas = await index_1.prisma.resena.findMany({
            where: { estado: 'Publicada' },
            orderBy: { fecha: 'desc' }
        });
        res.json(resenas);
    }
    catch (error) {
        console.error('Error al obtener reseñas publicadas:', error);
        res.status(500).json({ error: 'Error al cargar reseñas.' });
    }
};
exports.obtenerResenasPublicadas = obtenerResenasPublicadas;
const obtenerTodasResenas = async (req, res) => {
    try {
        const resenas = await index_1.prisma.resena.findMany({
            orderBy: { fecha: 'desc' }
        });
        res.json(resenas);
    }
    catch (error) {
        console.error('Error al obtener todas las reseñas:', error);
        res.status(500).json({ error: 'Error al cargar reseñas.' });
    }
};
exports.obtenerTodasResenas = obtenerTodasResenas;
const actualizarEstadoResena = async (req, res) => {
    try {
        const { id } = req.params;
        const { respuesta, estado } = req.body;
        const resenaActualizada = await index_1.prisma.resena.update({
            where: { id: parseInt(id) },
            data: {
                respuesta,
                estado
            }
        });
        res.json(resenaActualizada);
    }
    catch (error) {
        console.error('Error al actualizar reseña:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar reseña.' });
    }
};
exports.actualizarEstadoResena = actualizarEstadoResena;
const eliminarResena = async (req, res) => {
    try {
        const { id } = req.params;
        await index_1.prisma.resena.delete({ where: { id: parseInt(id) } });
        res.json({ message: 'Reseña eliminada.' });
    }
    catch (error) {
        console.error('Error al eliminar reseña:', error);
        res.status(500).json({ error: 'Error del servidor al eliminar reseña.' });
    }
};
exports.eliminarResena = eliminarResena;
const crearReclamacion = async (req, res) => {
    try {
        const data = req.body;
        const nuevaReclamacion = await index_1.prisma.reclamacion.create({ data });
        res.status(201).json(nuevaReclamacion);
    }
    catch (error) {
        console.error('Error al crear reclamación:', error);
        res.status(500).json({ error: 'Error del servidor al guardar reclamación.' });
    }
};
exports.crearReclamacion = crearReclamacion;
const obtenerReclamaciones = async (req, res) => {
    try {
        const reclamaciones = await index_1.prisma.reclamacion.findMany({
            orderBy: { fecha: 'desc' }
        });
        res.json(reclamaciones);
    }
    catch (error) {
        console.error('Error al obtener reclamaciones:', error);
        res.status(500).json({ error: 'Error al cargar reclamaciones.' });
    }
};
exports.obtenerReclamaciones = obtenerReclamaciones;
const actualizarEstadoReclamacion = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        const reclamacionActualizada = await index_1.prisma.reclamacion.update({
            where: { id: parseInt(id) },
            data: { estado }
        });
        res.json(reclamacionActualizada);
    }
    catch (error) {
        console.error('Error al actualizar reclamación:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar reclamación.' });
    }
};
exports.actualizarEstadoReclamacion = actualizarEstadoReclamacion;
const crearPostulacion = async (req, res) => {
    try {
        const data = req.body;
        const nuevaPostulacion = await index_1.prisma.postulacion.create({ data });
        res.status(201).json(nuevaPostulacion);
    }
    catch (error) {
        console.error('Error al crear postulación:', error);
        res.status(500).json({ error: 'Error del servidor al guardar postulación.' });
    }
};
exports.crearPostulacion = crearPostulacion;
const obtenerPostulaciones = async (req, res) => {
    try {
        const postulaciones = await index_1.prisma.postulacion.findMany({
            orderBy: { fecha: 'desc' }
        });
        res.json(postulaciones);
    }
    catch (error) {
        console.error('Error al obtener postulaciones:', error);
        res.status(500).json({ error: 'Error al cargar postulaciones.' });
    }
};
exports.obtenerPostulaciones = obtenerPostulaciones;
const actualizarEstadoPostulacion = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        const postulacionActualizada = await index_1.prisma.postulacion.update({
            where: { id: parseInt(id) },
            data: { estado }
        });
        res.json(postulacionActualizada);
    }
    catch (error) {
        console.error('Error al actualizar postulacion:', error);
        res.status(500).json({ error: 'Error al actualizar postulación.' });
    }
};
exports.actualizarEstadoPostulacion = actualizarEstadoPostulacion;
// ==========================================
// VENTAS WEB (TIENDA ONLINE)
// ==========================================
const registrarVentaWeb = async (req, res) => {
    try {
        const { clienteNombre, clienteDoc, metodoPago, monto, productos } = req.body;
        console.log('[WEB-VENTA] Body recibido:', JSON.stringify({ clienteNombre, clienteDoc, metodoPago, monto, productos }));
        if (!clienteNombre || !monto || !productos || productos.length === 0) {
            res.status(400).json({ error: 'Faltan datos obligatorios para la venta.' });
            return;
        }
        // 1. Generar correlativo
        let nuevoNumero = 'WEB-001';
        const ultima = await index_1.prisma.transaccion.findFirst({
            where: { numero: { startsWith: 'WEB-' } },
            orderBy: { id: 'desc' }
        });
        if (ultima) {
            const parts = ultima.numero.split('-');
            const numActual = parseInt(parts[1] || '0');
            nuevoNumero = `WEB-${String(numActual + 1).padStart(3, '0')}`;
        }
        console.log('[WEB-VENTA] Número asignado:', nuevoNumero);
        // 2. Crear transacción
        const hoy = new Date();
        const fechaStr = `${String(hoy.getDate()).padStart(2, '0')}/${String(hoy.getMonth() + 1).padStart(2, '0')}/${hoy.getFullYear()}`;
        const horaStr = `${String(hoy.getHours()).padStart(2, '0')}:${String(hoy.getMinutes()).padStart(2, '0')}`;
        const nuevaVenta = await index_1.prisma.transaccion.create({
            data: {
                numero: nuevoNumero,
                tipo: 'INGRESO',
                monto: parseFloat(String(monto)),
                metodoPago: metodoPago || 'Efectivo',
                concepto: `Venta Online #${nuevoNumero}`,
                categoria: 'Venta Online',
                fecha: fechaStr,
                hora: horaStr,
                clienteNombre,
                nota: `DNI/RUC: ${clienteDoc || 'S/D'}\nDETALLES:${JSON.stringify(productos.map((p) => ({ cantidad: p.cantidad, nombre: p.nombre, precio: p.precio })))}`,
                estado: 'COMPLETADO'
            }
        });
        console.log('[WEB-VENTA] Transacción creada, ID:', nuevaVenta.id);
        // 3. Descontar stock (no bloquea la venta si falla)
        for (const p of productos) {
            try {
                const pid = parseInt(String(p.id));
                const qty = parseInt(String(p.cantidad));
                if (isNaN(pid) || isNaN(qty))
                    continue;
                await index_1.prisma.producto.update({
                    where: { id: pid },
                    data: { stockActual: { decrement: qty } }
                });
                await index_1.prisma.movimientoInventario.create({
                    data: {
                        productoId: pid,
                        tipo: 'SALIDA',
                        cantidad: qty,
                        motivo: `VENTA_WEB #${nuevoNumero}`,
                        fecha: hoy
                    }
                });
                console.log('[WEB-VENTA] Stock descontado para producto:', pid);
            }
            catch (stockError) {
                console.error('[WEB-VENTA] Error descontando stock del producto', p.id, ':', stockError.message);
            }
        }
        res.status(201).json(nuevaVenta);
    }
    catch (error) {
        console.error('[WEB-VENTA] ERROR GENERAL:', error);
        res.status(500).json({
            error: 'Error del servidor al procesar la compra.',
            details: error.message
        });
    }
};
exports.registrarVentaWeb = registrarVentaWeb;
const obtenerVentasWeb = async (req, res) => {
    try {
        const ventas = await index_1.prisma.transaccion.findMany({
            where: { categoria: 'Venta Online' },
            orderBy: { id: 'desc' }
        });
        res.json(ventas);
    }
    catch (error) {
        console.error('Error al obtener ventas web:', error);
        res.status(500).json({ error: 'Error al cargar historial de ventas.' });
    }
};
exports.obtenerVentasWeb = obtenerVentasWeb;
