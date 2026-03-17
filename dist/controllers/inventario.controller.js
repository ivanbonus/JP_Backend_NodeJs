"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteProducto = exports.updateProducto = exports.registrarMovimiento = exports.createProducto = exports.getProductos = void 0;
const index_1 = require("../index");
const getProductos = async (req, res) => {
    try {
        const productos = await index_1.prisma.producto.findMany({
            include: {
                movimientos: {
                    orderBy: { fecha: 'desc' }
                }
            },
            orderBy: { nombre: 'asc' }
        });
        res.json(productos);
    }
    catch (error) {
        console.error('Error al obtener productos:', error);
        res.status(500).json({ error: 'Error del servidor al obtener productos.' });
    }
};
exports.getProductos = getProductos;
const createProducto = async (req, res) => {
    try {
        const { sku, nombre, precio, categoria, marca, stockActual, foto } = req.body;
        if (!sku || !nombre || precio === undefined) {
            res.status(400).json({ error: 'Faltan campos obligatorios para el producto.' });
            return;
        }
        const nuevoProducto = await index_1.prisma.producto.create({
            data: {
                sku,
                nombre,
                precio: Number(precio),
                categoria,
                marca,
                stockActual: Number(stockActual) || 0,
                foto
            }
        });
        res.status(201).json(nuevoProducto);
    }
    catch (error) {
        console.error('Error al crear producto:', error);
        res.status(500).json({ error: 'Error del servidor al crear producto.' });
    }
};
exports.createProducto = createProducto;
const registrarMovimiento = async (req, res) => {
    try {
        const { productoId, tipo, cantidad, motivo, numeroGuiaId } = req.body;
        // Primero, creamos el movimiento
        const movimiento = await index_1.prisma.movimientoInventario.create({
            data: {
                productoId: Number(productoId),
                tipo,
                cantidad: Number(cantidad),
                motivo,
                numeroGuiaId: numeroGuiaId ? Number(numeroGuiaId) : undefined
            }
        });
        // Luego, actualizamos el stock del producto
        await index_1.prisma.producto.update({
            where: { id: Number(productoId) },
            data: {
                stockActual: {
                    [tipo === 'ENTRADA' ? 'increment' : 'decrement']: Number(cantidad)
                }
            }
        });
        res.status(201).json(movimiento);
    }
    catch (error) {
        console.error('Error al registrar movimiento:', error);
        res.status(500).json({ error: 'Error del servidor al registrar movimiento.' });
    }
};
exports.registrarMovimiento = registrarMovimiento;
const updateProducto = async (req, res) => {
    try {
        const { id } = req.params;
        const { sku, nombre, precio, categoria, marca, stockActual, foto } = req.body;
        const actualizado = await index_1.prisma.producto.update({
            where: { id: Number(id) },
            data: { sku, nombre, precio: Number(precio), categoria, marca, stockActual: Number(stockActual), foto }
        });
        res.json(actualizado);
    }
    catch (error) {
        console.error('Error al actualizar producto:', error);
        res.status(500).json({ error: 'Error al actualizar producto.' });
    }
};
exports.updateProducto = updateProducto;
const deleteProducto = async (req, res) => {
    try {
        const { id } = req.params;
        // Borramos dependencias primero
        await index_1.prisma.movimientoInventario.deleteMany({ where: { productoId: Number(id) } });
        await index_1.prisma.producto.delete({ where: { id: Number(id) } });
        res.json({ success: true, message: 'Producto eliminado' });
    }
    catch (error) {
        console.error('Error al eliminar producto:', error);
        res.status(500).json({ error: 'Error al eliminar producto.' });
    }
};
exports.deleteProducto = deleteProducto;
