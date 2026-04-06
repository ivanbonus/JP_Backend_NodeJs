import { Request, Response } from 'express';
import { prisma } from '../prisma';

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

    // NOTIFICACIÓN AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: 'Nueva Reseña Recibida - Panel Web',
          text: `Se ha recibido una nueva reseña de ${nombre} (${calificacion} estrellas).`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #000; margin-top: 0;">¡Nueva Reseña!</h2>
              <p>Hola, se ha registrado una nueva opinión en la web:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Cliente:</strong> ${nombre}</li>
                <li><strong>Calificación:</strong> ${calificacion} / 5</li>
                <li><strong>Comentario:</strong> ${comentario}</li>
              </ul>
              <p>Puedes gestionarla desde el panel de administración.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre nueva reseña:', err);
    }

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

    // NOTIFICACIÓN AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: '¡ALERTA! Nueva Reclamación Libro de Reclamaciones',
          text: `Se ha registrado una nueva reclamación de ${data.nombres} ${data.apellidos}.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #dc2626; border-radius: 8px;">
              <h2 style="color: #dc2626; margin-top: 0;">Nueva Reclamación</h2>
              <p>Se ha registrado un nuevo reclamo formal en el Libro de Reclamaciones Virtual:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Cliente:</strong> ${data.nombres} ${data.apellidos}</li>
                <li><strong>Documento:</strong> ${data.numeroDocumento}</li>
                <li><strong>Teléfono:</strong> ${data.telefonoCelular}</li>
                <li><strong>Motivo:</strong> ${data.descripcionReclamacion}</li>
              </ul>
              <p>Por favor, revise el panel de administración para responder a la brevedad conforme a ley.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre reclamación:', err);
    }

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

export const responderReclamacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { mensaje } = req.body;

    const rec = await prisma.reclamacion.findUnique({
      where: { id: parseInt(id as string) }
    });

    if (!rec) {
      res.status(404).json({ error: 'Reclamación no encontrada.' });
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
            Le saludamos de <strong>Frenos y Embragues Juan Pablo</strong>. Hacemos referencia a su ${rec.tipoReclamacion.toLowerCase()} registrado el ${new Date(rec.fecha).toLocaleDateString()} bajo el número de documento ${rec.numeroDocumento}.
          </p>
          
          <div style="background-color: #f8fafc; border-left: 4px solid #fae800; padding: 25px; margin: 25px 0;">
            <p style="margin-top: 0; font-weight: bold; color: #64748b; font-size: 12px; text-transform: uppercase;">Respuesta de la Administración:</p>
            <div style="font-size: 16px; color: #1e293b;">
              ${mensaje.replace(/\n/g, '<br>')}
            </div>
          </div>

          <p style="font-size: 16px;">
            Agradecemos su tiempo y la oportunidad de mejorar nuestros servicios. Si tiene alguna duda adicional, no dude en contactarnos.
          </p>

          <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #64748b;">
            Atentamente,<br>
            <strong>Gerencia de Atención al Cliente</strong><br>
            Frenos y Embragues Juan Pablo
          </div>
        </div>
        <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
          Este documento es una respuesta oficial a su reclamación.
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
    console.error('Error al responder reclamación:', error);
    res.status(500).json({ error: 'Error del servidor al procesar la respuesta.' });
  }
};

export const crearPostulacion = async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const nuevaPostulacion = await prisma.postulacion.create({ data });

    // NOTIFICACIÓN AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: 'Nueva Postulación Recibida - Área: ' + data.areaPostula,
          text: `Se ha recibido una nueva postulación de ${data.nombres} ${data.apellidoPaterno}.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
              <h2 style="color: #000; margin-top: 0;">Nueva Postulación</h2>
              <p>Hay un nuevo interesado en unirse al equipo:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Candidato:</strong> ${data.nombres} ${data.apellidoPaterno}</li>
                <li><strong>Área a la que postula:</strong> ${data.areaPostula}</li>
                <li><strong>Email:</strong> ${data.email}</li>
                <li><strong>Teléfono:</strong> ${data.telefono}</li>
              </ul>
              <p>Puedes revisar su perfil completo en la pestaña de Postulaciones.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre postulación:', err);
    }

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
            ? 'Actualización de tu postulación - Frenos y Embragues Juan Pablo' 
            : 'Información sobre tu postulación - Frenos y Embragues Juan Pablo';

        const html = `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #000; padding: 30px; text-align: center;">
              <h1 style="color: #fae800; margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px;">Frenos y Embragues Juan Pablo</h1>
            </div>
            <div style="padding: 40px; background-color: #fff; color: #1a1f2e; line-height: 1.6;">
              <h2 style="color: #000; margin-top: 0;">Hola, ${postulacionActualizada.nombres}</h2>
              <p style="font-size: 16px;">
                ${esAceptado 
                  ? 'Nos complace informarte que hemos revisado tu postulación para el área de <strong>' + postulacionActualizada.areaPostula + '</strong> y nos gustaría avanzar con el proceso.' 
                  : 'Agradecemos mucho tu interés en formar parte de nuestro equipo en <strong>Frenos y Embragues Juan Pablo</strong>.'}
              </p>
              
              ${mensajePersonalizado ? `
              <div style="background-color: #f8fafc; border-left: 4px solid #fae800; padding: 20px; margin: 25px 0; font-style: italic;">
                "${mensajePersonalizado}"
              </div>
              ` : ''}

              <p style="font-size: 16px;">
                ${esAceptado 
                  ? 'Nuestro equipo se pondrá en contacto contigo pronto para coordinar una entrevista. ¡Estamos emocionados de conocerte!' 
                  : 'En esta ocasión hemos decidido no avanzar con tu perfil, pero guardaremos tus datos para futuras vacantes que se ajusten a tu experiencia.'}
              </p>

              <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; font-size: 14px; color: #64748b;">
                Atentamente,<br>
                <strong>Equipo de Reclutamiento</strong><br>
                Frenos y Embragues Juan Pablo
              </div>
            </div>
            <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 12px; color: #94a3b8;">
              Este es un correo automático, por favor no respondas directamente a este mensaje.
            </div>
          </div>
        `;

        try {
            await sendEmail({ 
                to: postulacionActualizada.email, 
                subject, 
                html,
                text: esAceptado ? 'Tu postulación ha sido actualizada.' : 'Información sobre tu postulación.'
            });
            console.log(`[POSTULACION] Email enviado a ${postulacionActualizada.email} con estado ${estado}`);
        } catch (emailError) {
            console.error('[POSTULACION] Error al enviar email:', emailError);
        }
    }

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

    // NOTIFICACIÓN AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: '¡Nueva Venta Online Registrada! #' + nuevoNumero,
          text: `Se ha registrado una nueva venta online por un valor de S/ ${monto}.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #22c55e; border-radius: 8px;">
              <h2 style="color: #22c55e; margin-top: 0;">Nueva Venta Lograda</h2>
              <p>Se ha confirmado una compra desde la tienda online:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Venta:</strong> #${nuevoNumero}</li>
                <li><strong>Cliente:</strong> ${clienteNombre}</li>
                <li><strong>Monto Total:</strong> S/ ${monto}</li>
                <li><strong>Método:</strong> ${metodoPago}</li>
              </ul>
              <p>Verifica el pedido en la sección de Ventas & Boletas.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre venta web:', err);
    }

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
