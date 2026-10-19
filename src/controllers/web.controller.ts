import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { firmarTokenBoleta } from '../auth/security';
import { hoyLima, horaLima } from '../utils/fechas';
import { siguienteCorrelativo } from '../utils/caja';
import { agregarDireccionesMedia, conDireccionMedia, valorMediaParaGuardar } from '../utils/media';

// Obtener productos visibles en la web
export const getProductosWeb = async (req: Request, res: Response) => {
  try {
    const productos = await prisma.producto.findMany({
      where: { visibleEnWeb: true },
      select: { id: true, sku: true, nombre: true, descripcion: true, categoria: true, marca: true, precio: true, stockActual: true, stockMinimo: true, visibleEnWeb: true },
      orderBy: { nombre: 'asc' }
    });
    res.json(await agregarDireccionesMedia(req, 'producto', 'foto', productos));
  } catch (error) {
    console.error('Error al obtener productos web:', error);
    res.status(500).json({ error: 'Error del servidor.' });
  }
};

export const crearResena = async (req: Request, res: Response) => {
  try {
    const { nombre, email, vehiculo, servicio, calificacion, comentario } = req.body;

    if (!nombre || calificacion === undefined || !comentario) {
        res.status(400).json({ error: 'Nombre, calificaciÃ³n y comentario son obligatorios.' });
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

    // NOTIFICACIÃ“N AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: 'Nueva ReseÃ±a Recibida - Panel Web',
          text: `Se ha recibido una nueva reseÃ±a de ${nombre} (${calificacion} estrellas).`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #000; margin-top: 0;">Â¡Nueva ReseÃ±a!</h2>
              <p>Hola, se ha registrado una nueva opiniÃ³n en la web:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Cliente:</strong> ${nombre}</li>
                <li><strong>CalificaciÃ³n:</strong> ${calificacion} / 5</li>
                <li><strong>Comentario:</strong> ${comentario}</li>
              </ul>
              <p>Puedes gestionarla desde el panel de administraciÃ³n.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre nueva reseÃ±a:', err);
    }

    res.status(201).json(nuevaResena);
  } catch (error) {
    console.error('Error al crear reseÃ±a:', error);
    res.status(500).json({ error: 'Error del servidor al guardar reseÃ±a.' });
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
    console.error('Error al obtener reseÃ±as publicadas:', error);
    res.status(500).json({ error: 'Error al cargar reseÃ±as.' });
  }
};

export const obtenerTodasResenas = async (req: Request, res: Response) => {
  try {
    const resenas = await prisma.resena.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error al obtener todas las reseÃ±as:', error);
    res.status(500).json({ error: 'Error al cargar reseÃ±as.' });
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
    console.error('Error al actualizar reseÃ±a:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar reseÃ±a.' });
  }
};

export const eliminarResena = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.resena.delete({ where: { id: parseInt(id as string) } });
    res.json({ message: 'ReseÃ±a eliminada.' });
  } catch (error) {
    console.error('Error al eliminar reseÃ±a:', error);
    res.status(500).json({ error: 'Error del servidor al eliminar reseÃ±a.' });
  }
};

export const crearReclamacion = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const nuevaReclamacion = await prisma.reclamacion.create({ data });

    // NOTIFICACIÃ“N AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: 'Â¡ALERTA! Nueva ReclamaciÃ³n Libro de Reclamaciones',
          text: `Se ha registrado una nueva reclamaciÃ³n de ${data.nombres} ${data.apellidos}.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #dc2626; border-radius: 8px;">
              <h2 style="color: #dc2626; margin-top: 0;">Nueva ReclamaciÃ³n</h2>
              <p>Se ha registrado un nuevo reclamo formal en el Libro de Reclamaciones Virtual:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Cliente:</strong> ${data.nombres} ${data.apellidos}</li>
                <li><strong>Documento:</strong> ${data.numeroDocumento}</li>
                <li><strong>TelÃ©fono:</strong> ${data.telefonoCelular}</li>
                <li><strong>Motivo:</strong> ${data.descripcionReclamacion}</li>
              </ul>
              <p>Por favor, revise el panel de administraciÃ³n para responder a la brevedad conforme a ley.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre reclamaciÃ³n:', err);
    }

    res.status(201).json(nuevaReclamacion);
  } catch (error) {
    console.error('Error al crear reclamaciÃ³n:', error);
    res.status(500).json({ error: 'Error del servidor al guardar reclamaciÃ³n.' });
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
    console.error('Error al actualizar reclamaciÃ³n:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar reclamaciÃ³n.' });
  }
};

export const responderReclamacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { mensaje } = req.body;

    const rec = await prisma.reclamacion.findUnique({
      where: { id: parseInt(id as string) }
    });

    if (!rec) {
      res.status(404).json({ error: 'ReclamaciÃ³n no encontrada.' });
      return;
    }

    // 1. Enviar el correo
    const subject = `Respuesta a su ${rec.tipoReclamacion} - Frenos y Embragues Juan Pablo`;
    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #000; padding: 30px; text-align: center;">
          <h1 style="color: #fae800; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">Frenos y Embragues Juan Pablo</h1>
        </div>
        <div style="padding: 40px; background-color: #fff; color: #1a1f2e; line-height: 1.6;">
          <h2 style="color: #000; margin-top: 0;">Estimado(a) ${rec.nombres} ${rec.apellidos},</h2>
          <p style="font-size: 16px;">
            Le saludamos de <strong>Frenos y Embragues Juan Pablo</strong>. Hacemos referencia a su ${rec.tipoReclamacion.toLowerCase()} registrado el ${new Date(rec.fecha).toLocaleDateString()} bajo el nÃºmero de documento ${rec.numeroDocumento}.
          </p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid #fae800; padding: 25px; margin: 25px 0;">
            <p style="margin-top: 0; font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase;">Respuesta de la AdministraciÃ³n:</p>
            <div style="font-size: 16px; color: #1e293b;">
              ${mensaje.replace(/\n/g, '<br>')}
            </div>
          </div>

          <p style="font-size: 16px;">
            Agradecemos su tiempo y la oportunidad de mejorar nuestros servicios. Si tiene alguna duda adicional, no dude en contactarnos.
          </p>

          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #64748b;">
            Atentamente,<br>
            <strong>Gerencia de AtenciÃ³n al Cliente</strong><br>
            Frenos y Embragues Juan Pablo
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
          Este documento es una respuesta oficial a su reclamaciÃ³n.
        </div>
      </div>
    `;

    try {
      await sendEmail({
        to: rec.email,
        subject,
        html,
        text: `Respuesta a su ${rec.tipoReclamacion}: ${mensaje}`
      });
    } catch (err) {
      console.error('[RECLAMACION-REPLY] Error enviando email:', err);
      // No bloqueamos, pero avisamos al frontend (opcionalmente)
    }

    // 2. Actualizar estado a ATENDIDO
    const actualizada = await prisma.reclamacion.update({
      where: { id: parseInt(id as string) },
      data: { estado: 'ATENDIDO' }
    });

    res.json({ message: 'Respuesta enviada y estado actualizado.', data: actualizada });
  } catch (error) {
    console.error('Error al responder reclamaciÃ³n:', error);
    res.status(500).json({ error: 'Error del servidor al procesar la respuesta.' });
  }
};

export const crearPostulacion = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const nuevaPostulacion = await prisma.postulacion.create({ data });

    // NOTIFICACIÃ“N AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: 'Nueva PostulaciÃ³n Recibida - Ã�rea: ' + data.areaPostula,
          text: `Se ha recibido una nueva postulaciÃ³n de ${data.nombres} ${data.apellidoPaterno}.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #000; margin-top: 0;">Nueva PostulaciÃ³n</h2>
              <p>Hay un nuevo interesado en unirse al equipo:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Candidato:</strong> ${data.nombres} ${data.apellidoPaterno}</li>
                <li><strong>Ã�rea a la que postula:</strong> ${data.areaPostula}</li>
                <li><strong>Email:</strong> ${data.email}</li>
                <li><strong>TelÃ©fono:</strong> ${data.telefono}</li>
              </ul>
              <p>Puedes revisar su perfil completo en la pestaÃ±a de Postulaciones.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre postulaciÃ³n:', err);
    }

    res.status(201).json(nuevaPostulacion);
  } catch (error) {
    console.error('Error al crear postulaciÃ³n:', error);
    res.status(500).json({ error: 'Error del servidor al guardar postulaciÃ³n.' });
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

import { sendEmail } from '../utils/mailer';

export const actualizarEstadoPostulacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado, mensajePersonalizado } = req.body;

    const postulacionActualizada = await prisma.postulacion.update({
      where: { id: parseInt(id as string) },
      data: { estado }
    });

    // Enviar correo si el estado es CONTACTADO o DESCARTADO
    if (estado === 'CONTACTADO' || estado === 'DESCARTADO') {
        const esAceptado = estado === 'CONTACTADO';
        const subject = esAceptado 
            ? 'ActualizaciÃ³n de tu postulaciÃ³n - Frenos y Embragues Juan Pablo' 
            : 'InformaciÃ³n sobre tu postulaciÃ³n - Frenos y Embragues Juan Pablo';

        const html = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #000; padding: 30px; text-align: center;">
              <h1 style="color: #fae800; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">Frenos y Embragues Juan Pablo</h1>
            </div>
            <div style="padding: 40px; background-color: #fff; color: #1a1f2e; line-height: 1.6;">
              <h2 style="color: #000; margin-top: 0;">Hola, ${postulacionActualizada.nombres}</h2>
              <p style="font-size: 16px;">
                ${esAceptado 
                  ? 'Nos complace informarte que hemos revisado tu postulaciÃ³n para el Ã¡rea de <strong>' + postulacionActualizada.areaPostula + '</strong> y nos gustarÃ­a avanzar con el proceso.' 
                  : 'Agradecemos mucho tu interÃ©s en formar parte de nuestro equipo en <strong>Frenos y Embragues Juan Pablo</strong>.'}
              </p>
              
              ${mensajePersonalizado ? `
              <div style="background-color: #f8fafc; border-left: 4px solid #fae800; padding: 20px; margin: 25px 0; font-style: italic;">
                "${mensajePersonalizado}"
              </div>
              ` : ''}

              <p style="font-size: 16px;">
                ${esAceptado 
                  ? 'Nuestro equipo se pondrÃ¡ en contacto contigo pronto para coordinar una entrevista. Â¡Estamos emocionados de conocerte!' 
                  : 'En esta ocasiÃ³n hemos decidido no avanzar con tu perfil, pero guardaremos tus datos para futuras vacantes que se ajusten a tu experiencia.'}
              </p>

              <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #64748b;">
                Atentamente,<br>
                <strong>Equipo de Reclutamiento</strong><br>
                Frenos y Embragues Juan Pablo
              </div>
            </div>
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
              Este es un correo automÃ¡tico, por favor no respondas directamente a este mensaje.
            </div>
          </div>
        `;

        try {
            await sendEmail({ 
                to: postulacionActualizada.email, 
                subject, 
                html,
                text: esAceptado ? 'Tu postulaciÃ³n ha sido actualizada.' : 'InformaciÃ³n sobre tu postulaciÃ³n.'
            });
            console.log(`[POSTULACION] Email enviado a ${postulacionActualizada.email} con estado ${estado}`);
        } catch (emailError) {
            console.error('[POSTULACION] Error al enviar email:', emailError);
        }
    }

    res.json(postulacionActualizada);
  } catch (error) {
    console.error('Error al actualizar postulacion:', error);
    res.status(500).json({ error: 'Error al actualizar postulaciÃ³n.' });
  }
};

// ==========================================
// VENTAS WEB (TIENDA ONLINE)
// ==========================================

class ErrorPedido extends Error {}

const METODOS_WEB = ['Efectivo', 'Transferencia', 'Yape/Plin'];

/**
 * Pedido de la tienda web. Queda POR_VERIFICAR: no es un ingreso hasta que el administrador
 * confirme que el dinero llegó (Finanzas → Verificar pago). Los precios y el stock se toman
 * de la base de datos, nunca de lo que envía el navegador. El stock se reserva al pedir y se
 * devuelve si el pedido se rechaza.
 */
export const registrarVentaWeb = async (req: Request, res: Response) => {
  try {
    const { clienteNombre, clienteDoc, metodoPago, productos, operacionCliente } = req.body || {};

    const nombre = typeof clienteNombre === 'string' ? clienteNombre.trim().slice(0, 120) : '';
    if (!nombre || !Array.isArray(productos) || productos.length === 0 || productos.length > 30) {
      res.status(400).json({ error: 'Faltan datos obligatorios para el pedido.' });
      return;
    }
    if (!METODOS_WEB.includes(metodoPago)) {
      res.status(400).json({ error: 'Elige un método de pago válido.' });
      return;
    }
    const documento = typeof clienteDoc === 'string' ? clienteDoc.trim().slice(0, 15) : '';
    const operacion = typeof operacionCliente === 'string' ? operacionCliente.replace(/\s/g, '').slice(0, 40) || null : null;

    // Cantidades por producto (sumando repetidos)
    const cantidades = new Map<number, number>();
    for (const p of productos) {
      const id = Number(p?.id);
      const cantidad = Number(p?.cantidad);
      if (!Number.isInteger(id) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
        res.status(400).json({ error: 'Hay un producto o una cantidad no válida en el pedido.' });
        return;
      }
      cantidades.set(id, (cantidades.get(id) || 0) + cantidad);
    }

    const catalogo = await prisma.producto.findMany({
      where: { id: { in: [...cantidades.keys()] }, visibleEnWeb: true },
      select: { id: true, nombre: true, precio: true, stockActual: true },
    });
    if (catalogo.length !== cantidades.size) {
      res.status(400).json({ error: 'Algún producto ya no está disponible en la tienda. Actualiza la página.' });
      return;
    }
    const items = catalogo.map(p => ({ id: p.id, nombre: p.nombre, precio: p.precio, cantidad: cantidades.get(p.id)! }));
    const total = Math.round(items.reduce((s, i) => s + i.precio * i.cantidad, 0) * 100) / 100;
    if (total <= 0) {
      res.status(400).json({ error: 'El pedido no tiene un total válido.' });
      return;
    }

    let nuevaVenta: any = null;
    for (let intento = 0; intento < 5 && !nuevaVenta; intento++) {
      try {
        nuevaVenta = await prisma.$transaction(async tx => {
          const existentes = await tx.transaccion.findMany({ where: { numero: { startsWith: 'WEB-' } }, select: { numero: true } });
          const numero = siguienteCorrelativo('WEB', existentes.map(e => e.numero));

          // Reserva de stock: solo si alcanza (evita stock negativo con compras simultáneas)
          for (const i of items) {
            const r = await tx.producto.updateMany({
              where: { id: i.id, stockActual: { gte: i.cantidad } },
              data: { stockActual: { decrement: i.cantidad } },
            });
            if (r.count === 0) throw new ErrorPedido(`No hay stock suficiente de «${i.nombre}».`);
            await tx.movimientoInventario.create({
              data: { productoId: i.id, tipo: 'SALIDA', cantidad: i.cantidad, motivo: `VENTA_WEB #${numero}` },
            });
          }

          return tx.transaccion.create({
            data: {
              numero,
              tipo: 'INGRESO',
              monto: total,
              metodoPago,
              concepto: `Venta Online #${numero}`,
              categoria: 'Venta Online',
              fecha: hoyLima(),
              hora: horaLima(),
              clienteNombre: nombre,
              operacionCliente: operacion,
              nota: `DNI/RUC: ${documento || 'S/D'}\nDETALLES:${JSON.stringify(items.map(i => ({ id: i.id, cantidad: i.cantidad, nombre: i.nombre, precio: i.precio })))}`,
              estado: 'POR_VERIFICAR',
            },
          });
        });
      } catch (e: any) {
        if (e instanceof ErrorPedido) {
          res.status(409).json({ error: e.message });
          return;
        }
        if (e?.code !== 'P2002') throw e; // número repetido por otro pedido simultáneo: se reintenta
      }
    }
    if (!nuevaVenta) {
      res.status(409).json({ error: 'No se pudo registrar el pedido, intenta nuevamente.' });
      return;
    }

    // Aviso al administrador en segundo plano (el cliente no espera al correo)
    void (async () => {
     try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: `Nuevo pedido web por verificar #${nuevaVenta.numero}`,
          text: `Pedido ${nuevaVenta.numero} de ${nombre} por S/ ${total.toFixed(2)} (${metodoPago}). Verifica el pago en Finanzas antes de entregarlo.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #f59e0b; border-radius: 8px;">
              <h2 style="color: #d97706; margin-top: 0;">Nuevo pedido web por verificar</h2>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Pedido:</strong> #${nuevaVenta.numero}</li>
                <li><strong>Cliente:</strong> ${nombre.replace(/[<>&]/g, '')}</li>
                <li><strong>Total:</strong> S/ ${total.toFixed(2)}</li>
                <li><strong>Método:</strong> ${metodoPago}</li>
                ${operacion ? `<li><strong>N.º de operación informado:</strong> ${operacion.replace(/[<>&]/g, '')}</li>` : ''}
              </ul>
              <p>Confirma que el dinero llegó (Finanzas → Ventas → Verificar pago) antes de entregar el pedido.</p>
            </div>
          `
        });
      }
     } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre pedido web:', err);
     }
    })();

    // Token temporal para que el comprador descargue su comprobante de pedido sin iniciar sesión
    res.status(201).json({
      id: nuevaVenta.id, numero: nuevaVenta.numero, monto: nuevaVenta.monto, metodoPago: nuevaVenta.metodoPago,
      estado: nuevaVenta.estado, fecha: nuevaVenta.fecha, hora: nuevaVenta.hora,
      boletaToken: firmarTokenBoleta(nuevaVenta.id),
    });
  } catch (error: any) {
    console.error('[WEB-VENTA] ERROR GENERAL:', error);
    res.status(500).json({ error: 'Error del servidor al procesar la compra.' });
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

// ==========================================
// MÓDULO NOVEDADES (WEB)
// ==========================================

// Campos de una novedad SIN el archivo (la foto o el video se piden aparte por su dirección)
const CAMPOS_NOVEDAD = { id: true, titulo: true, descripcion: true, etiqueta: true, videoUrl: true, likes: true, estado: true, fecha: true } as const;

export const obtenerNovedadesWeb = async (req: Request, res: Response) => {
    try {
        const novedades = await prisma.novedad.findMany({
            where: { estado: "ACTIVO" },
            select: CAMPOS_NOVEDAD,
            orderBy: { fecha: "desc" }
        });
        res.json(await agregarDireccionesMedia(req, 'novedad', 'imagen', novedades));
    } catch (error) {
        console.error("Error al obtener novedades:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
};

export const obtenerTodasNovedadesAdmin = async (req: Request, res: Response) => {
    try {
        const novedades = await prisma.novedad.findMany({
            select: CAMPOS_NOVEDAD,
            orderBy: { fecha: "desc" }
        });
        res.json(await agregarDireccionesMedia(req, 'novedad', 'imagen', novedades));
    } catch (error) {
        console.error("Error al obtener todas las novedades:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
};

export const crearNovedad = async (req: Request, res: Response) => {
    try {
        const { titulo, descripcion, etiqueta, imagen, videoUrl, estado } = req.body;
        if (!titulo || !descripcion) {
            res.status(400).json({ error: "Título y descripción son obligatorios" });
            return;
        }

        const nuevaNovedad = await prisma.novedad.create({
            data: {
                titulo,
                descripcion,
                etiqueta,
                imagen: valorMediaParaGuardar(imagen, 'novedad') ?? null,
                videoUrl,
                estado: estado || "ACTIVO"
            }
        });
        res.status(201).json(conDireccionMedia(req, 'novedad', 'imagen', nuevaNovedad));
    } catch (error) {
        console.error("Error al crear novedad:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
};

export const actualizarNovedad = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const { titulo, descripcion, etiqueta, imagen, videoUrl, estado } = req.body;

        const novedadActualizada = await prisma.novedad.update({
            where: { id },
            data: {
                titulo,
                descripcion,
                etiqueta,
                // La dirección propia del archivo significa "sin cambios"
                ...(valorMediaParaGuardar(imagen, 'novedad') !== undefined ? { imagen: valorMediaParaGuardar(imagen, 'novedad') } : {}),
                videoUrl,
                estado
            }
        });
        res.json(conDireccionMedia(req, 'novedad', 'imagen', novedadActualizada));
    } catch (error) {
        console.error("Error al actualizar novedad:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
};

export const eliminarNovedad = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        await prisma.novedad.delete({ where: { id } });
        res.json({ message: "Novedad eliminada exitosamente" });
    } catch (error) {
        console.error("Error al eliminar novedad:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
};

// ==========================================
// DAR LIKE A NOVEDAD (WEB)
// ==========================================
export const darLikeNovedad = async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id as string);
        const novedad = await prisma.novedad.update({
            where: { id },
            data: {
                likes: { increment: 1 }
            }
        });
        res.json({ message: "Like registrado", likes: novedad.likes });
    } catch (error) {
        console.error("Error al dar like a novedad:", error);
        res.status(500).json({ error: "Error del servidor" });
    }
};

