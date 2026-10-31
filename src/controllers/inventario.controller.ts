import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { agregarDireccionesMedia, conDireccionMedia, valorMediaParaGuardar } from '../utils/media';
import { prisma } from '../prisma';
import { quien } from '../auth/auditoria';
import { historialCostos, umbralAlzaCosto } from '../utils/costos';
import { pendientesDeRecibir } from './recepcion.controller';

const D = Prisma.Decimal;

class ErrorInventario extends Error {
  constructor(message: string, public status = 400, public extra?: Record<string, unknown>) { super(message); }
}

const responderError = (res: Response, error: unknown, contexto: string, mensaje: string) => {
  if (error instanceof ErrorInventario) return void res.status(error.status).json({ error: error.message, ...(error.extra || {}) });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return void res.status(409).json({ error: 'Ya existe un producto con ese código (SKU).' });
  }
  console.error(`Error al ${contexto}:`, error);
  res.status(500).json({ error: mensaje });
};

/** Cantidad entera mayor que cero (el stock se lleva en unidades enteras) */
const cantidadEntera = (v: unknown) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0 || n > 1_000_000) throw new ErrorInventario('La cantidad debe ser un número entero mayor que cero.');
  return n;
};
const texto = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

export const getProductos = async (req: Request, res: Response) => {
  try {
    // Sin la foto completa: cada foto se pide aparte por su dirección (/api/media/...)
    const productos = await prisma.producto.findMany({
      select: {
        id: true, sku: true, nombre: true, descripcion: true, categoria: true, marca: true, precio: true, stockActual: true, stockMinimo: true, visibleEnWeb: true,
        // Solo los últimos: el historial completo está en la ficha del producto
        movimientos: {
          orderBy: { fecha: 'desc' },
          take: 20,
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

    const stockInicial = Number(stockActual) || 0;
    if (!Number.isInteger(stockInicial) || stockInicial < 0) throw new ErrorInventario('El stock inicial debe ser un número entero (0 o más).');
    if (!Number.isFinite(Number(precio)) || Number(precio) < 0) throw new ErrorInventario('El precio no es válido.');

    const nuevoProducto = await prisma.$transaction(async tx => {
      const p = await tx.producto.create({
        data: {
          sku: String(sku).trim(),
          nombre: String(nombre).trim(),
          precio: Number(precio),
          categoria,
          marca,
          stockActual: stockInicial,
          foto: valorMediaParaGuardar(foto, 'producto') ?? null
        }
      });
      // El stock con el que nace el producto también queda en su historial
      if (stockInicial > 0) {
        await tx.movimientoInventario.create({
          data: { productoId: p.id, tipo: 'ENTRADA', cantidad: stockInicial, motivo: 'STOCK_INICIAL', responsable: quien(req), stockResultante: stockInicial },
        });
      }
      return p;
    });

    res.status(201).json(conDireccionMedia(req, 'producto', 'foto', nuevoProducto));
  } catch (error) {
    responderError(res, error, 'crear producto', 'Error del servidor al crear producto.');
  }
};

/**
 * Ingreso o salida manual. Es atómico, no deja el stock en negativo y registra quién lo hizo.
 * Si el producto tiene mercadería facturada aún sin recibir, un ingreso manual podría duplicar
 * el stock: se pide confirmación (lo correcto es usar "Recibir mercadería" en la factura).
 */
export const registrarMovimiento = async (req: Request, res: Response) => {
  try {
    const { productoId, tipo, motivo, numeroGuiaId } = req.body;
    if (tipo !== 'ENTRADA' && tipo !== 'SALIDA') throw new ErrorInventario('El tipo de movimiento debe ser ENTRADA o SALIDA.');
    const cantidad = cantidadEntera(req.body.cantidad);
    const id = Number(productoId);
    const producto = await prisma.producto.findUnique({ where: { id }, select: { id: true, nombre: true } });
    if (!producto) throw new ErrorInventario('El producto no existe.', 404);

    if (tipo === 'ENTRADA' && req.body.confirmarSinFactura !== true) {
      const pendientes = await pendientesDeRecibir(id);
      if (new D(pendientes.unidades).gt(0)) {
        throw new ErrorInventario(
          `${producto.nombre} tiene ${pendientes.unidades} unidad(es) facturadas aún sin recibir (${pendientes.documentos.map(d => `${d.serie}-${d.numero}`).join(', ')}). Si esta mercadería es de esa factura, regístrala con "Recibir mercadería" en Compras para no sumarla dos veces.`,
          409,
          { requiereConfirmacion: true, pendientes },
        );
      }
    }

    const movimiento = await prisma.$transaction(async tx => {
      let stock: number;
      if (tipo === 'ENTRADA') {
        stock = (await tx.producto.update({ where: { id }, data: { stockActual: { increment: cantidad } }, select: { stockActual: true } })).stockActual;
      } else {
        // Solo descuenta si alcanza (lo comprueba la base, aunque dos personas registren a la vez)
        const r = await tx.producto.updateMany({ where: { id, stockActual: { gte: cantidad } }, data: { stockActual: { decrement: cantidad } } });
        if (!r.count) throw new ErrorInventario('Stock insuficiente para esta salida.', 409);
        stock = (await tx.producto.findUniqueOrThrow({ where: { id }, select: { stockActual: true } })).stockActual;
      }
      return tx.movimientoInventario.create({
        data: {
          productoId: id, tipo, cantidad, motivo: texto(motivo), responsable: quien(req), stockResultante: stock,
          numeroGuiaId: numeroGuiaId ? Number(numeroGuiaId) : undefined,
        }
      });
    });

    res.status(201).json(movimiento);
  } catch (error) {
    responderError(res, error, 'registrar movimiento', 'Error del servidor al registrar movimiento.');
  }
};

export const updateProducto = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { sku, nombre, precio, categoria, marca, stockActual, foto, visibleEnWeb } = req.body;
    if (precio !== undefined && (!Number.isFinite(Number(precio)) || Number(precio) < 0)) throw new ErrorInventario('El precio no es válido.');
    const nuevoStock = stockActual !== undefined ? Number(stockActual) : undefined;
    if (nuevoStock !== undefined && (!Number.isInteger(nuevoStock) || nuevoStock < 0)) throw new ErrorInventario('El stock debe ser un número entero (0 o más).');

    const actualizado = await prisma.$transaction(async tx => {
      const antes = await tx.producto.findUnique({ where: { id: Number(id) }, select: { stockActual: true } });
      if (!antes) throw new ErrorInventario('Producto no encontrado.', 404);
      const p = await tx.producto.update({
        where: { id: Number(id) },
        data: {
          sku, nombre, ...(precio !== undefined ? { precio: Number(precio) } : {}), categoria, marca,
          ...(nuevoStock !== undefined ? { stockActual: nuevoStock } : {}),
          // La dirección propia de la foto significa "sin cambios"
          ...(valorMediaParaGuardar(foto, 'producto') !== undefined ? { foto: valorMediaParaGuardar(foto, 'producto') } : {}),
          ...(visibleEnWeb !== undefined ? { visibleEnWeb: Boolean(visibleEnWeb) } : {})
        }
      });
      // Corregir el stock a mano deja un ajuste en el historial (con la diferencia y quién lo hizo)
      if (nuevoStock !== undefined && nuevoStock !== antes.stockActual) {
        const diferencia = nuevoStock - antes.stockActual;
        await tx.movimientoInventario.create({
          data: {
            productoId: p.id, tipo: diferencia > 0 ? 'ENTRADA' : 'SALIDA', cantidad: Math.abs(diferencia), motivo: 'AJUSTE',
            responsable: quien(req), stockResultante: nuevoStock, observacion: `Stock corregido al editar el producto (${antes.stockActual} → ${nuevoStock})`,
          },
        });
      }
      return p;
    });
    res.json(conDireccionMedia(req, 'producto', 'foto', actualizado));
  } catch (error) {
    responderError(res, error, 'actualizar producto', 'Error al actualizar producto.');
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

// ==========================================
// Ficha del producto (Fase 5)
// ==========================================
export const fichaProducto = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const producto = await prisma.producto.findUnique({
      where: { id },
      select: { id: true, sku: true, nombre: true, descripcion: true, categoria: true, marca: true, precio: true, stockActual: true, stockMinimo: true, visibleEnWeb: true },
    });
    if (!producto) return void res.status(404).json({ error: 'Producto no encontrado.' });

    const [costos, pendientes, movimientos] = await Promise.all([
      historialCostos(id),
      pendientesDeRecibir(id),
      prisma.movimientoInventario.findMany({
        where: { productoId: id },
        orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true, tipo: true, cantidad: true, motivo: true, fecha: true, responsable: true, observacion: true, stockResultante: true, costoUnitario: true, revierteId: true,
          numeroGuia: { select: { id: true, vehiculo: { select: { placa: true } } } },
          detalleCompra: { select: { documento: { select: { id: true, codigo: true, serie: true, numero: true } } } },
        },
      }),
    ]);

    // Margen estimado: el precio de venta se toma con IGV incluido y se compara sin IGV con el último costo
    const ultimo = costos.estadisticas ? new D(costos.estadisticas.ultimoPen) : null;
    const precioSinIgv = new D(producto.precio).div('1.18');
    const margen = ultimo && precioSinIgv.gt(0)
      ? {
          precioVenta: new D(producto.precio).toFixed(2),
          precioVentaSinIgv: precioSinIgv.toFixed(2),
          costoReferencia: ultimo.toFixed(2),
          gananciaPorUnidad: precioSinIgv.sub(ultimo).toFixed(2),
          margenPct: precioSinIgv.sub(ultimo).div(precioSinIgv).mul(100).toDecimalPlaces(1).toNumber(),
        }
      : null;

    res.json({
      producto,
      movimientos: movimientos.map(({ detalleCompra, ...m }) => ({ ...m, documento: detalleCompra?.documento ?? null })),
      costos,
      pendientesRecepcion: pendientes,
      margen,
      notas: {
        costos: 'Costos en soles, sin IGV, por unidad de inventario (si se compra por caja, se divide entre las unidades que trae).',
        margen: 'Margen bruto estimado: precio de venta (con IGV incluido) sin IGV menos el último costo de compra. No incluye mano de obra ni gastos del negocio: no es la utilidad neta.',
      },
    });
  } catch (error) {
    responderError(res, error, 'obtener ficha del producto', 'Error al obtener la ficha del producto.');
  }
};

/** Porcentaje de alza de costo que activa el aviso */
export const obtenerConfigInventario = async (_req: Request, res: Response) => {
  try {
    res.json({ umbralAlzaCosto: (await umbralAlzaCosto()).toString() });
  } catch (error) {
    responderError(res, error, 'obtener configuración de inventario', 'Error del servidor.');
  }
};

/** Solo administrador */
export const actualizarUmbralAlzaCosto = async (req: Request, res: Response) => {
  try {
    const t = String(req.body?.umbralAlzaCosto ?? '').trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t) || new D(t).lte(0) || new D(t).gt(500)) throw new ErrorInventario('Indica un porcentaje entre 0.01 y 500.');
    await prisma.configuracion.updateMany({ data: { umbralAlzaCosto: new D(t) } });
    res.json({ umbralAlzaCosto: new D(t).toString() });
  } catch (error) {
    responderError(res, error, 'actualizar umbral de alza de costo', 'Error del servidor.');
  }
};
