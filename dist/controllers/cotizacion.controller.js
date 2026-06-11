"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.responderYGenerarPdfWhatsapp = exports.responderCotizacion = exports.generarCotizacionPdf = exports.updateCotizacionStatus = exports.getCotizaciones = exports.createCotizacion = void 0;
const prisma_1 = require("../prisma");
const pdfKitGenerator_1 = require("../utils/pdfKitGenerator");
const email_1 = require("../utils/email");
const mailer_1 = require("../utils/mailer");
const formatMoney = (val) => {
    if (val === '' || val === null || val === undefined)
        return '0.00';
    const num = Number(val);
    if (isNaN(num))
        return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
async function generarPdfBuffer(data) {
    console.log(`[PDF-GENERATOR] Iniciando generación con PDFKit para #${data.cotizacionNumero}`);
    return (0, pdfKitGenerator_1.generarCotizacionPdfKit)(data);
}
const createCotizacion = async (req, res) => {
    try {
        const { nombre, email, telefono, vehiculo, servicio, mensaje, placa, documento, atencion, direccion } = req.body;
        if (!nombre || !telefono) {
            res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
            return;
        }
        const nuevaCotizacion = await prisma_1.prisma.cotizacion.create({
            data: {
                nombre, email: email || '', telefono,
                vehiculo: vehiculo || '', placa: placa || '',
                documento: documento || '', atencion: atencion || '',
                direccion: direccion || '', servicio: servicio || '', mensaje: mensaje || '',
            }
        });
        try {
            const config = await prisma_1.prisma.configuracion.findFirst();
            if (config && config.email) {
                await (0, mailer_1.sendEmail)({
                    to: config.email,
                    subject: 'Nueva Solicitud de Cotización Web - Taller JP',
                    text: `Se ha recibido una nueva solicitud de cotización de ${nombre}.`,
                    html: `<div style="font-family: sans-serif; padding: 20px;"><h2>Nueva Cotización Recibida</h2><p>Cliente: ${nombre} / Tel: ${telefono}</p></div>`
                });
            }
        }
        catch (err) {
            console.error('[ADMIN-NOTIFICACION] Error:', err);
        }
        res.status(201).json(nuevaCotizacion);
    }
    catch (error) {
        console.error('Error al crear cotización:', error);
        res.status(500).json({ error: 'Error del servidor al enviar cotización.' });
    }
};
exports.createCotizacion = createCotizacion;
const getCotizaciones = async (req, res) => {
    try {
        const cotizaciones = await prisma_1.prisma.cotizacion.findMany({ orderBy: { fecha: 'desc' } });
        res.json(cotizaciones);
    }
    catch (error) {
        res.status(500).json({ error: 'Error al cargar las cotizaciones.' });
    }
};
exports.getCotizaciones = getCotizaciones;
const updateCotizacionStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado } = req.body;
        if (!estado) {
            res.status(400).json({ error: 'Falta el estado.' });
            return;
        }
        const updated = await prisma_1.prisma.cotizacion.update({ where: { id: parseInt(id) }, data: { estado } });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'No se pudo actualizar la cotización.' });
    }
};
exports.updateCotizacionStatus = updateCotizacionStatus;
const generarCotizacionPdf = async (req, res) => {
    try {
        console.log('[PDF-REQUEST] Generando PDF Manual / Descarga (Original Design)');
        const data = {
            ...req.body,
            cotizacionNumero: req.body.cotizacionNumero || 'MANUAL',
            fecha: new Date().toLocaleDateString('es-PE'),
            placa: req.body.clientePlaca || req.body.placa || ''
        };
        const pdfBuffer = await generarPdfBuffer(data);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="cotizacion_${data.cotizacionNumero}.pdf"`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error('[PDF-ERROR] generarCotizacionPdf:', error);
        res.status(500).json({ error: 'No se pudo generar el PDF con el diseño original.' });
    }
};
exports.generarCotizacionPdf = generarCotizacionPdf;
const responderCotizacion = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[PDF-REQUEST] Respondiendo cotización ID: ${id} vía Email (Original Design)`);
        const cotizacionDB = await prisma_1.prisma.cotizacion.findUnique({ where: { id: parseInt(id) } });
        if (!cotizacionDB) {
            res.status(404).json({ error: 'Cotización no encontrada.' });
            return;
        }
        const cotNum = `W-${String(cotizacionDB.id).padStart(5, '0')}`;
        const pdfBuffer = await generarPdfBuffer({
            ...req.body,
            cotizacionNumero: cotNum,
            clienteNombre: req.body.clienteNombre || cotizacionDB.nombre,
            clienteEmail: req.body.clienteEmail || cotizacionDB.email,
            clienteTelefono: req.body.clienteTelefono || cotizacionDB.telefono,
            clienteCelular: req.body.clienteTelefono || cotizacionDB.telefono,
            clienteDocumento: req.body.clienteDocumento || cotizacionDB.documento,
            clienteAtencion: req.body.clienteAtencion || cotizacionDB.atencion,
            clienteDireccion: req.body.clienteDireccion || cotizacionDB.direccion,
            placa: req.body.clientePlaca || req.body.placa || cotizacionDB.placa || '',
            fecha: new Date().toLocaleDateString('es-PE')
        });
        try {
            await (0, email_1.enviarCotizacionEmail)(cotizacionDB.email, `Cotización de Servicios / Productos - Frenos JP`, `<div style="font-family: Arial, sans-serif;"><h2>Hola, ${cotizacionDB.nombre}.</h2><p>Adjuntamos la cotización formal.</p></div>`, Buffer.from(pdfBuffer), `Cotizacion_${cotNum}.pdf`);
        }
        catch (e) {
            console.warn("[MAIL-ERROR]", e);
            res.status(500).json({ error: 'PDF generado pero falló el envío por correo.' });
            return;
        }
        const updated = await prisma_1.prisma.cotizacion.update({
            where: { id: parseInt(id) },
            data: {
                estado: 'ATENDIDO', datosCotizacion: req.body,
                nombre: req.body.clienteNombre || cotizacionDB.nombre,
                email: req.body.clienteEmail || cotizacionDB.email,
                telefono: req.body.clienteTelefono || cotizacionDB.telefono,
                vehiculo: req.body.clienteVehiculo || cotizacionDB.vehiculo,
                placa: req.body.clientePlaca || req.body.placa || cotizacionDB.placa,
                documento: req.body.clienteDocumento || cotizacionDB.documento,
                atencion: req.body.clienteAtencion || cotizacionDB.atencion,
                direccion: req.body.clienteDireccion || cotizacionDB.direccion,
                servicio: req.body.clienteServicio || cotizacionDB.servicio,
                mensaje: req.body.clienteMensaje || cotizacionDB.mensaje,
            }
        });
        res.json({ message: 'Cotización generada y enviada correctamente.', cotizacion: updated });
    }
    catch (error) {
        console.error('[PDF-ERROR] responderCotizacion:', error);
        res.status(500).json({ error: 'No se pudo generar ni enviar la cotización.' });
    }
};
exports.responderCotizacion = responderCotizacion;
const responderYGenerarPdfWhatsapp = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[PDF-REQUEST] Generando PDF para WhatsApp/Descarga ID: ${id} (Original Design)`);
        const cotizacionDB = await prisma_1.prisma.cotizacion.findUnique({ where: { id: parseInt(id) } });
        if (!cotizacionDB) {
            res.status(404).json({ error: 'Cotización no encontrada.' });
            return;
        }
        const cotNum = `W-${String(cotizacionDB.id).padStart(5, '0')}`;
        const pdfBuffer = await generarPdfBuffer({
            ...req.body,
            cotizacionNumero: cotNum,
            clienteNombre: req.body.clienteNombre || cotizacionDB.nombre,
            clienteEmail: req.body.clienteEmail || cotizacionDB.email,
            clienteTelefono: req.body.clienteTelefono || cotizacionDB.telefono,
            clienteCelular: req.body.clienteTelefono || cotizacionDB.telefono,
            clienteDocumento: req.body.clienteDocumento || cotizacionDB.documento,
            clienteAtencion: req.body.clienteAtencion || cotizacionDB.atencion,
            clienteDireccion: req.body.clienteDireccion || cotizacionDB.direccion,
            placa: req.body.clientePlaca || req.body.placa || cotizacionDB.placa || '',
            fecha: new Date().toLocaleDateString('es-PE')
        });
        await prisma_1.prisma.cotizacion.update({
            where: { id: parseInt(id) },
            data: {
                estado: 'ATENDIDO', datosCotizacion: req.body,
                nombre: req.body.clienteNombre || cotizacionDB.nombre,
                email: req.body.clienteEmail || cotizacionDB.email,
                telefono: req.body.clienteTelefono || cotizacionDB.telefono,
                vehiculo: req.body.clienteVehiculo || cotizacionDB.vehiculo,
                placa: req.body.clientePlaca || req.body.placa || cotizacionDB.placa,
                documento: req.body.clienteDocumento || cotizacionDB.documento,
                atencion: req.body.clienteAtencion || cotizacionDB.atencion,
                direccion: req.body.clienteDireccion || cotizacionDB.direccion,
                servicio: req.body.clienteServicio || cotizacionDB.servicio,
                mensaje: req.body.clienteMensaje || cotizacionDB.mensaje,
            }
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Cotizacion_${cotNum}.pdf"`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error('[PDF-ERROR] responderYGenerarPdfWhatsapp:', error);
        res.status(500).json({ error: 'No se pudo generar el PDF con el diseño original.' });
    }
};
exports.responderYGenerarPdfWhatsapp = responderYGenerarPdfWhatsapp;
