import { Request, Response } from 'express';
import { agregarDireccionesMedia, conDireccionMedia, valorMediaParaGuardar } from '../utils/media';
import { prisma } from '../prisma';

export const getProductos = async (req: Request, res: Response) => {
  try {
    // Sin la foto completa: cada foto se pide aparte por su dirección (/api/media/...)
    const productos = await prisma.producto.findMany({
      select: {
        id: true, sku: true, nombre: true, descripcion: true, categoria: true, marca: true, precio: true, stockActual: true, stockMinimo: true, visibleEnWeb: true,
        movimientos: {
          orderBy: { fecha: 'desc' }
        }
      },
      orderBy: { nombre: 'asc' }
    });
    res.json(await agregarDireccionesMedia(req, 'producto', 'foto', productos));
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).json({ error: 'Error del servidor al obtener productos.' });
  }
};

export const createProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const { sku, nombre, precio, categoria, marca, stockActual, foto } = req.body;
    
    if (!sku || !nombre || precio === undefined) {
      res.status(400).json({ error: 'Faltan campos obligatorios para el producto.' });
      return;
    }

    const nuevoProducto = await prisma.producto.create({
      data: { 
        sku, 
        nombre, 
        precio: Number(precio), 
        categoria, 
        marca, 
        stockActual: Number(stockActual) || 0,
        foto: valorMediaParaGuardar(foto, 'producto') ?? null
      }
    });

    res.status(201).json(conDireccionMedia(req, 'producto', 'foto', nuevoProducto));
  } catch (error) {
    console.error('Error al crear producto:', error);
    res.status(500).json({ error: 'Error del servidor al crear producto.' });
  }
};

export const registrarMovimiento = async (req: Request, res: Response) => {
  try {
    const { productoId, tipo, cantidad, motivo, numeroGuiaId } = req.body;
    
    // Primero, creamos el movimiento
    const movimiento = await prisma.movimientoInventario.create({
      data: { 
        productoId: Number(productoId), 
        tipo, 
        cantidad: Number(cantidad), 
        motivo, 
        numeroGuiaId: numeroGuiaId ? Number(numeroGuiaId) : undefined 
      }
    });

    // Luego, actualizamos el stock del producto
    await prisma.producto.update({
      where: { id: Number(productoId) },
      data: {
        stockActual: {
          [tipo === 'ENTRADA' ? 'increment' : 'decrement']: Number(cantidad)
        }
      }
    });

    res.status(201).json(movimiento);
  } catch (error) {
    console.error('Error al registrar movimiento:', error);
    res.status(500).json({ error: 'Error del servidor al registrar movimiento.' });
  }
};

export const updateProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { sku, nombre, precio, categoria, marca, stockActual, foto, visibleEnWeb } = req.body;
    const actualizado = await prisma.producto.update({
      where: { id: Number(id) },
      data: { 
        sku, nombre, precio: Number(precio), categoria, marca, 
        stockActual: Number(stockActual),
        // La dirección propia de la foto significa "sin cambios"
        ...(valorMediaParaGuardar(foto, 'producto') !== undefined ? { foto: valorMediaParaGuardar(foto, 'producto') } : {}),
        ...(visibleEnWeb !== undefined ? { visibleEnWeb: Boolean(visibleEnWeb) } : {})
      }
    });
    res.json(conDireccionMedia(req, 'producto', 'foto', actualizado));
  } catch (error) {
    console.error('Error al actualizar producto:', error);
    res.status(500).json({ error: 'Error al actualizar producto.' });
  }
};

export const toggleVisibleWeb = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const producto = await prisma.producto.findUnique({ where: { id: Number(id) } });
    if (!producto) {
      res.status(404).json({ error: 'Producto no encontrado' });
      return;
    }
    const actualizado = await prisma.producto.update({
      where: { id: Number(id) },
      data: { visibleEnWeb: !producto.visibleEnWeb }
    });
    res.json(conDireccionMedia(req, 'producto', 'foto', actualizado));
  } catch (error) {
    console.error('Error al cambiar visibilidad web:', error);
    res.status(500).json({ error: 'Error al cambiar visibilidad.' });
  }
};

export const deleteProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    // Borramos dependencias primero
    await prisma.movimientoInventario.deleteMany({ where: { productoId: Number(id) } });
    await prisma.producto.delete({ where: { id: Number(id) } });
    res.json({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    console.error('Error al eliminar producto:', error);
    res.status(500).json({ error: 'Error al eliminar producto.' });
  }
};
