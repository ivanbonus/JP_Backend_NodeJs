"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.actualizarEstadoCitaWeb = exports.obtenerCitasWeb = exports.crearCitaWeb = void 0;
const prisma_1 = require("../prisma");
const mailer_1 = require("../utils/mailer");
const crearCitaWeb = async (req, res) => {
    try {
        const { nombre, email, telefono, vehiculo, mensaje, fechaCita } = req.body;
        if (!nombre || !telefono || !fechaCita) {
            res.status(400).json({ error: 'Nombre, teléfono y fecha de cita son obligatorios.' });
            return;
        }
        const nuevaCita = await prisma_1.prisma.citaWeb.create({
            data: {
                nombre,
                email: email || '',
                telefono,
                vehiculo,
                mensaje: mensaje || '',
                fechaCita: new Date(fechaCita),
                estado: 'PENDIENTE'
            }
        });
        // NOTIFICACIÓN AL ADMIN
        try {
            const config = await prisma_1.prisma.configuracion.findFirst();
            if (config && config.email) {
                const fechaHora = new Date(fechaCita).toLocaleString('es-PE', {
                    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                });
                await (0, mailer_1.sendEmail)({
                    to: config.email,
                    subject: 'Nueva Solicitud de Cita Web - Frenos y Embragues Juan Pablo',
                    text: `Se ha solicitado una nueva cita para el ${fechaHora}.`,
                    html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #fae800; border-radius: 8px;">
              <h2 style="color: #000; margin-top: 0;">Nueva Cita Agendada</h2>
              <p>Un cliente ha solicitado una cita desde la web:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Cliente:</strong> ${nombre}</li>
                <li><strong>Vehículo:</strong> ${vehiculo}</li>
                <li><strong>Fecha/Hora:</strong> ${fechaHora}</li>
                <li><strong>Teléfono:</strong> ${telefono}</li>
                <li><strong>Mensaje:</strong> ${mensaje || 'Sin mensaje'}</li>
              </ul>
              <p>Por favor, confirme o cancele la solicitud desde el panel de citas web.</p>
            </div>
          `
                });
            }
        }
        catch (err) {
            console.error('[ADMIN-NOTIFICACION] Error al avisar sobre nueva cita:', err);
        }
        res.status(201).json(nuevaCita);
    }
    catch (error) {
        console.error('Error al crear cita web:', error);
        res.status(500).json({ error: 'Error del servidor al agendar la cita.' });
    }
};
exports.crearCitaWeb = crearCitaWeb;
const obtenerCitasWeb = async (req, res) => {
    try {
        const citas = await prisma_1.prisma.citaWeb.findMany({
            orderBy: { fechaSolicitud: 'desc' }
        });
        res.json(citas);
    }
    catch (error) {
        console.error('Error al obtener citas web:', error);
        res.status(500).json({ error: 'Error al cargar las citas.' });
    }
};
exports.obtenerCitasWeb = obtenerCitasWeb;
const actualizarEstadoCitaWeb = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, mensajePersonalizado } = req.body;
        const idNum = parseInt(id);
        // Obtener datos antes de actualizar para tener el email
        const citaPrev = await prisma_1.prisma.citaWeb.findUnique({ where: { id: idNum } });
        const citaActualizada = await prisma_1.prisma.citaWeb.update({
            where: { id: idNum },
            data: { estado }
        });
        // Enviar correo si tiene email registrado
        if (citaPrev && citaPrev.email) {
            try {
                const fechaHora = new Date(citaPrev.fechaCita).toLocaleString('es-PE', {
                    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                });
                const extraMsgHtml = mensajePersonalizado ? `
                <div style="background: #fff8e1; border-left: 4px solid #ffb300; padding: 15px; margin: 15px 0; border-radius: 4px;">
                    <p style="margin: 0; font-weight: bold; color: #856404;">Nota del taller:</p>
                    <p style="margin: 5px 0; color: #555; white-space: pre-wrap;">${mensajePersonalizado}</p>
                </div>
            ` : '';
                if (estado === 'CONFIRMADA') {
                    await (0, mailer_1.sendEmail)({
                        to: citaPrev.email,
                        subject: 'Cita de Servicios / Productos - Frenos y Embragues Juan Pablo',
                        text: `Hola ${citaPrev.nombre}, tu cita para el vehículo ${citaPrev.vehiculo} ha sido CONFIRMADA para el día ${fechaHora}. ${mensajePersonalizado ? '\n\nNota: ' + mensajePersonalizado : ''}\n\nTe esperamos en Av. Juan Pablo II.`,
                        html: `
                        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 8px;">
                            <h2 style="color: #000; margin-top: 0;">Hola, ${citaPrev.nombre}.</h2>
                            <p>Gracias por contactarte con <strong>Frenos y Embragues Juan Pablo</strong>.</p>
                            
                            <p style="font-size: 1.1rem;">Tu cita ha sido <strong style="color: #22c55e;">CONFIRMADA</strong>:</p>

                            ${extraMsgHtml}

                            <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #fae800;">
                                <p style="margin: 5px 0;"><strong>Vehículo:</strong> ${citaPrev.vehiculo}</p>
                                <p style="margin: 5px 0;"><strong>Fecha y Hora:</strong> ${fechaHora}</p>
                                <p style="margin: 5px 0;"><strong>Lugar:</strong> Av. Juan Pablo II</p>
                            </div>
                            
                            <p>Te esperamos puntualmente para brindarte la mejor atención.</p>
                            <br>
                            <p>Atentamente,<br><strong>Equipo de Servicios - JP</strong></p>
                            <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;" />
                            <p style="font-size: 0.8rem; color: #777;">Frenos y Embragues Juan Pablo — Especialistas en Frenos y Embragues.</p>
                        </div>
                    `
                    });
                }
                else if (estado === 'CANCELADA') {
                    await (0, mailer_1.sendEmail)({
                        to: citaPrev.email,
                        subject: 'Cita de Servicios / Productos - Frenos y Embragues Juan Pablo',
                        text: `Hola ${citaPrev.nombre}, lamentamos informarte que no hemos podido confirmar tu cita para el ${fechaHora}. ${mensajePersonalizado ? '\n\nMotivo: ' + mensajePersonalizado : ''}\n\nPor favor, contáctanos por WhatsApp para reprogramar.`,
                        html: `
                        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; border: 1px solid #eee; padding: 20px; border-radius: 8px;">
                            <h2 style="color: #000; margin-top: 0;">Hola, ${citaPrev.nombre}.</h2>
                            <p>Gracias por contactarte con <strong>Frenos y Embragues Juan Pablo</strong>.</p>
                            
                            <p style="font-size: 1.1rem; color: #dc2626;"><strong>Información sobre tu solicitud:</strong></p>
                            <p>Lamentamos informarte que no contamos con disponibilidad para la fecha solicitada.</p>

                            ${extraMsgHtml}

                            <div style="background: #fff5f5; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                                <p style="margin: 5px 0;"><strong>Vehículo:</strong> ${citaPrev.vehiculo}</p>
                                <p style="margin: 5px 0;"><strong>Fecha solicitada:</strong> ${fechaHora}</p>
                                <p style="margin: 5px 0;"><strong>Estado:</strong> <span style="color: #dc2626; font-weight: bold;">CANCELADA / RECHAZADA</span></p>
                            </div>

                            <p>Por favor, contáctanos directamente para agendar una nueva fecha.</p>
                            <p style="text-align: center; margin: 30px 0;">
                                <a href="https://wa.me/51946020871" style="background: #25d366; color: white; padding: 12px 25px; border-radius: 30px; text-decoration: none; font-weight: bold; display: inline-block;">
                                    REPROGRAMAR POR WHATSAPP
                                </a>
                            </p>
                            <br>
                            <p>Atentamente,<br><strong>Equipo de Atención - JP</strong></p>
                            <hr style="border: 0; border-top: 1px solid #eee; margin-top: 20px;" />
                            <p style="font-size: 0.8rem; color: #777;">Frenos y Embragues Juan Pablo — Especialistas en Frenos y Embragues.</p>
                        </div>
                    `
                    });
                }
            }
            catch (mailErr) {
                console.error('[CONTROLLER] Error enviando correo informativo:', mailErr);
            }
        }
        res.json(citaActualizada);
    }
    catch (error) {
        console.error('Error al actualizar estado de cita web:', error);
        res.status(500).json({ error: 'Error al actualizar la cita.' });
    }
};
exports.actualizarEstadoCitaWeb = actualizarEstadoCitaWeb;
