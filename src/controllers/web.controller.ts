import { Request, Response } from 'express';
import { prisma } from '../index';

// Obtener productos visibles en la web
export const getProductosWeb = async (req: Request, res: Response) => {
  try {
    const productos = await prisma.producto.findMany({
      where: { visibleEnWeb: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(productos);
  } catch (error) {
    console.error('Error al obtener productos web:', error);
    res.status(500).json({ error: 'Error del servidor.' });
  }
};

export const crearResena = async (req: Request, res: Response) => {
  try {
    const { nombre, email, vehiculo, servicio, calificacion, comentario } = req.body;

    if (!nombre || calificacion === undefined || !comentario) {
        res.status(400).json({ error: 'Nombre, calificación y comentario son obligatorios.' });
        return;
    }

    const nuevaResena = await prisma.resena.create({
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
  } catch (error) {
    console.error('Error al crear reseña:', error);
    res.status(500).json({ error: 'Error del servidor al guardar reseña.' });
  }
};

export const obtenerResenasPublicadas = async (req: Request, res: Response) => {
  try {
    const resenas = await prisma.resena.findMany({
        where: { estado: 'Publicada' },
        orderBy: { fecha: 'desc' }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error al obtener reseñas publicadas:', error);
    res.status(500).json({ error: 'Error al cargar reseñas.' });
  }
};

export const obtenerTodasResenas = async (req: Request, res: Response) => {
  try {
    const resenas = await prisma.resena.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error al obtener todas las reseñas:', error);
    res.status(500).json({ error: 'Error al cargar reseñas.' });
  }
};

export const actualizarEstadoResena = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { respuesta, estado } = req.body;

    const resenaActualizada = await prisma.resena.update({
      where: { id: parseInt(id as string) },
      data: {
        respuesta,
        estado
      }
    });

    res.json(resenaActualizada);
  } catch (error) {
    console.error('Error al actualizar reseña:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar reseña.' });
  }
};

export const eliminarResena = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.resena.delete({ where: { id: parseInt(id as string) } });
    res.json({ message: 'Reseña eliminada.' });
  } catch (error) {
    console.error('Error al eliminar reseña:', error);
    res.status(500).json({ error: 'Error del servidor al eliminar reseña.' });
  }
};

export const crearReclamacion = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const nuevaReclamacion = await prisma.reclamacion.create({ data });
    res.status(201).json(nuevaReclamacion);
  } catch (error) {
    console.error('Error al crear reclamación:', error);
    res.status(500).json({ error: 'Error del servidor al guardar reclamación.' });
  }
};

export const obtenerReclamaciones = async (req: Request, res: Response) => {
  try {
    const reclamaciones = await prisma.reclamacion.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(reclamaciones);
  } catch (error) {
    console.error('Error al obtener reclamaciones:', error);
    res.status(500).json({ error: 'Error al cargar reclamaciones.' });
  }
};

export const actualizarEstadoReclamacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const reclamacionActualizada = await prisma.reclamacion.update({
      where: { id: parseInt(id as string) },
      data: { estado }
    });
    res.json(reclamacionActualizada);
  } catch (error) {
    console.error('Error al actualizar reclamación:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar reclamación.' });
  }
};

export const crearPostulacion = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const nuevaPostulacion = await prisma.postulacion.create({ data });
    res.status(201).json(nuevaPostulacion);
  } catch (error) {
    console.error('Error al crear postulación:', error);
    res.status(500).json({ error: 'Error del servidor al guardar postulación.' });
  }
};

export const obtenerPostulaciones = async (req: Request, res: Response) => {
  try {
    const postulaciones = await prisma.postulacion.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(postulaciones);
  } catch (error) {
    console.error('Error al obtener postulaciones:', error);
    res.status(500).json({ error: 'Error al cargar postulaciones.' });
  }
};

export const actualizarEstadoPostulacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;
    const postulacionActualizada = await prisma.postulacion.update({
      where: { id: parseInt(id as string) },
      data: { estado }
    });
    res.json(postulacionActualizada);
  } catch (error) {
    console.error('Error al actualizar postulacion:', error);
    res.status(500).json({ error: 'Error al actualizar postulación.' });
  }
};

// ==========================================
// VENTAS WEB (TIENDA ONLINE)
// ==========================================

export const registrarVentaWeb = async (req: Request, res: Response) => {
  try {
    const { clienteNombre, clienteDoc, metodoPago, monto, productos } = req.body;

    console.log('[WEB-VENTA] Body recibido:', JSON.stringify({ clienteNombre, clienteDoc, metodoPago, monto, productos }));

    if (!clienteNombre || !monto || !productos || productos.length === 0) {
      res.status(400).json({ error: 'Faltan datos obligatorios para la venta.' });
      return;
    }

    // 1. Generar correlativo
    let nuevoNumero = 'WEB-001';
    const ultima = await prisma.transaccion.findFirst({
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

    const nuevaVenta = await prisma.transaccion.create({
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
        nota: `DNI/RUC: ${clienteDoc || 'S/D'}\nDETALLES:${JSON.stringify(
          productos.map((p: any) => ({ cantidad: p.cantidad, nombre: p.nombre, precio: p.precio }))
        )}`,
        estado: 'COMPLETADO'
      }
    });
    console.log('[WEB-VENTA] Transacción creada, ID:', nuevaVenta.id);

    // 3. Descontar stock (no bloquea la venta si falla)
    for (const p of productos) {
      try {
        const pid = parseInt(String(p.id));
        const qty = parseInt(String(p.cantidad));
        if (isNaN(pid) || isNaN(qty)) continue;

        await prisma.producto.update({
          where: { id: pid },
          data: { stockActual: { decrement: qty } }
        });

        await prisma.movimientoInventario.create({
          data: {
            productoId: pid,
            tipo: 'SALIDA',
            cantidad: qty,
            motivo: `VENTA_WEB #${nuevoNumero}`,
            fecha: hoy
          }
        });
        console.log('[WEB-VENTA] Stock descontado para producto:', pid);
      } catch (stockError: any) {
        console.error('[WEB-VENTA] Error descontando stock del producto', p.id, ':', stockError.message);
      }
    }

    res.status(201).json(nuevaVenta);
  } catch (error: any) {
    console.error('[WEB-VENTA] ERROR GENERAL:', error);
    res.status(500).json({ 
      error: 'Error del servidor al procesar la compra.',
      details: error.message 
    });
  }
};

export const obtenerVentasWeb = async (req: Request, res: Response) => {
    try {
        const ventas = await prisma.transaccion.findMany({
            where: { categoria: 'Venta Online' },
            orderBy: { id: 'desc' }
        });
        res.json(ventas);
    } catch (error) {
        console.error('Error al obtener ventas web:', error);
        res.status(500).json({ error: 'Error al cargar historial de ventas.' });
    }
};
