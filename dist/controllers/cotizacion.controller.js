"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.responderYGenerarPdfWhatsapp = exports.responderCotizacion = exports.generarCotizacionPdf = exports.updateCotizacionStatus = exports.getCotizaciones = exports.createCotizacion = void 0;
const prisma_1 = require("../prisma");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const pdfkit_1 = __importDefault(require("pdfkit"));
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
/**
 * Helper centralizado para generar el PDF de una cotización usando PDFKit (nativo JS, sin Chrome).
 */
async function generarPdfBuffer(data) {
    return new Promise((resolve, reject) => {
        try {
            console.log(`[PDF-GENERATOR] Iniciando generación para #${data.cotizacionNumero}`);
            const doc = new pdfkit_1.default({ size: 'A4', margin: 40 });
            const chunks = [];
            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);
            // ─── Colores corporativos ───────────────────────────────────────────────
            const NAVY = '#0b2e59';
            const RED = '#da3a3a';
            const WHITE = '#ffffff';
            const GRAY = '#f0f2f5';
            const DARK = '#1a1a2e';
            // ─── LOGO ───────────────────────────────────────────────────────────────
            const logoPath = path_1.default.join(__dirname, '../assets/images/logo-jp.png');
            if (fs_1.default.existsSync(logoPath)) {
                doc.image(logoPath, 40, 30, { height: 70, fit: [120, 70] });
            }
            // ─── INFO EMPRESA (al lado del logo) ────────────────────────────────────
            doc.fillColor(NAVY).fontSize(12.5).font('Helvetica-Bold')
                .text('FRENOS EMBRAGUES "JUAN PABLO" E.I.R.L.', 175, 32, { align: 'center', width: 250 });
            doc.fillColor(DARK).fontSize(7.5).font('Helvetica')
                .text('Especialidad en ensamblaje AIRE e HIDRÁULICO', 175, 50, { align: 'center', width: 250 })
                .text('Reparación de Frenos y Embragues en General: Compresoras', 175, 60, { align: 'center', width: 250 })
                .text('Sistema ABS · Venta de Repuestos y Accesorios Originales', 175, 70, { align: 'center', width: 250 });
            doc.fillColor(NAVY).fontSize(7).font('Helvetica')
                .text('Av. Los Ciruelos N° 327 - Urb. San Carlos - S.J.L.  |  Telf.: 946 020 871 / 987 417 892 / 990 221 676', 175, 82, { align: 'center', width: 250 });
            // ─── CAJA DOCUMENTO (derecha) ────────────────────────────────────────────
            const boxX = 436, boxY = 28, boxW = 118, boxH = 68;
            doc.rect(boxX, boxY, boxW, boxH).strokeColor(NAVY).lineWidth(1.5).stroke();
            // RUC line
            doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold')
                .text(`R.U.C. ${data.empresaRuc || '20554702270'}`, boxX, boxY + 7, { align: 'center', width: boxW });
            // COTIZACION red band
            doc.rect(boxX, boxY + 20, boxW, 20).fillColor(RED).fill();
            doc.fillColor(WHITE).fontSize(11).font('Helvetica-Bold')
                .text('COTIZACION', boxX, boxY + 25, { align: 'center', width: boxW });
            // Number
            doc.fillColor(RED).fontSize(10).font('Helvetica-Bold')
                .text(`N° ${data.cotizacionNumero || 'W-00000'}`, boxX, boxY + 47, { align: 'center', width: boxW });
            // ─── LÍNEA SEPARADORA ───────────────────────────────────────────────────
            const y1 = 106;
            doc.moveTo(40, y1).lineTo(555, y1).strokeColor(NAVY).lineWidth(1).stroke();
            // ─── DATOS CLIENTE y VENDEDOR ────────────────────────────────────────────
            let yc = y1 + 10;
            const labelW = 90;
            const clienteX = 40;
            const vendedorX = 370;
            const drawRow = (label, value, x, y, maxWidth = 200) => {
                doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text(label + ':', x, y, { width: labelW, continued: false });
                doc.fillColor(DARK).fontSize(8).font('Helvetica').text(value || '-', x + labelW, y, { width: maxWidth });
            };
            drawRow('Señor(es)', (data.clienteNombre || '').toUpperCase(), clienteX, yc);
            yc += 14;
            drawRow('R.U.C./D.N.I.', data.clienteDocumento || '', clienteX, yc - 14 + 0, 200);
            // vendedor right side
            doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text('Fecha:', vendedorX, y1 + 10, { width: 60 });
            doc.fillColor(DARK).fontSize(8).font('Helvetica').text(data.fecha || new Date().toLocaleDateString('es-PE'), vendedorX + 60, y1 + 10, { width: 130 });
            // reset y
            yc = y1 + 24;
            drawRow('R.U.C./D.N.I.', data.clienteDocumento || '', clienteX, yc);
            doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text('Vendedor:', vendedorX, yc, { width: 60 });
            doc.fillColor(DARK).fontSize(8).font('Helvetica').text(data.vendedorNombre || 'Atención Web', vendedorX + 60, yc, { width: 130 });
            yc += 14;
            drawRow('Atención', data.clienteAtencion || '', clienteX, yc);
            doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text('Celular:', vendedorX, yc, { width: 60 });
            doc.fillColor(DARK).fontSize(8).font('Helvetica').text(data.clienteCelular || data.clienteTelefono || '', vendedorX + 60, yc, { width: 130 });
            yc += 14;
            drawRow('Dirección', data.clienteDireccion || '', clienteX, yc);
            doc.fillColor(NAVY).fontSize(8).font('Helvetica-Bold').text('Moneda:', vendedorX, yc, { width: 60 });
            doc.fillColor(DARK).fontSize(8).font('Helvetica').text('SOLES', vendedorX + 60, yc, { width: 130 });
            yc += 14;
            drawRow('Email', data.clienteEmail || '', clienteX, yc);
            yc += 14;
            drawRow('Teléfono', data.clienteTelefono || '', clienteX, yc);
            // ─── TEXTO INTRO ─────────────────────────────────────────────────────────
            yc += 18;
            doc.fillColor(NAVY).fontSize(8).font('Helvetica')
                .text('Por medio de la presente, tenemos a bien hacerles llegar la cotización de precios, por lo siguiente:', 40, yc);
            yc += 14;
            // ─── TABLA PRODUCTOS ─────────────────────────────────────────────────────
            const mostrarPrecios = data.mostrarPreciosUnitarios !== false;
            const productos = (data.productos && Array.isArray(data.productos)) ? data.productos : [];
            const COL_X = 40;
            const TABLE_W = 515;
            const ROW_H = 18;
            // Headers
            const colWidths = mostrarPrecios ? [80, 45, 235, 75, 80] : [100, 55, TABLE_W - 155];
            const colHeaders = mostrarPrecios
                ? ['CODIGO', 'CANT', 'DESCRIPCION DEL ARTICULO', 'P. UNIT.', 'IMPORTE']
                : ['CODIGO', 'CANT', 'DESCRIPCION DEL ARTICULO'];
            // Header row background
            doc.rect(COL_X, yc, TABLE_W, ROW_H).fillColor(NAVY).fill();
            let xCursor = COL_X;
            colHeaders.forEach((h, i) => {
                const align = i >= 3 ? 'right' : (i === 1 ? 'center' : 'left');
                doc.fillColor(WHITE).fontSize(7.5).font('Helvetica-Bold')
                    .text(h, xCursor + 3, yc + 5, { width: colWidths[i] - 6, align });
                xCursor += colWidths[i];
            });
            yc += ROW_H;
            // Item rows
            if (productos.length === 0) {
                doc.rect(COL_X, yc, TABLE_W, ROW_H).strokeColor(NAVY).lineWidth(0.5).stroke();
                doc.fillColor(DARK).fontSize(8).font('Helvetica')
                    .text('Sin artículos registrados', COL_X, yc + 5, { width: TABLE_W, align: 'center' });
                yc += ROW_H;
            }
            else {
                productos.forEach((prod, idx) => {
                    const rowBg = idx % 2 === 0 ? WHITE : GRAY;
                    doc.rect(COL_X, yc, TABLE_W, ROW_H).fillColor(rowBg).fill();
                    doc.rect(COL_X, yc, TABLE_W, ROW_H).strokeColor(NAVY).lineWidth(0.3).stroke();
                    xCursor = COL_X;
                    const rowData = mostrarPrecios
                        ? [
                            { text: prod.codigo || '', align: 'left' },
                            { text: String(prod.cantidad ?? ''), align: 'center' },
                            { text: prod.descripcion || '', align: 'left' },
                            { text: formatMoney(prod.precioUnitario), align: 'right' },
                            { text: formatMoney(prod.importe), align: 'right' },
                        ]
                        : [
                            { text: prod.codigo || '', align: 'left' },
                            { text: String(prod.cantidad ?? ''), align: 'center' },
                            { text: prod.descripcion || '', align: 'left' },
                        ];
                    rowData.forEach((cell, i) => {
                        doc.fillColor(DARK).fontSize(8).font('Helvetica')
                            .text(cell.text, xCursor + 3, yc + 5, { width: colWidths[i] - 6, align: cell.align });
                        xCursor += colWidths[i];
                    });
                    yc += ROW_H;
                });
            }
            // ─── TABLA FOOTER: Condiciones + Total ──────────────────────────────────
            const footerH = 65;
            const condW = mostrarPrecios ? Math.floor(TABLE_W * 0.72) : TABLE_W;
            const totalW = TABLE_W - condW;
            doc.rect(COL_X, yc, condW, footerH).strokeColor(NAVY).lineWidth(0.5).stroke();
            let yf = yc + 8;
            const drawCond = (label, val) => {
                doc.fillColor(NAVY).fontSize(7.5).font('Helvetica-Bold').text(label + ':', COL_X + 6, yf, { width: 100 });
                doc.fillColor(DARK).fontSize(7.5).font('Helvetica').text(val || '', COL_X + 108, yf, { width: condW - 115 });
                yf += 14;
            };
            drawCond('Forma de Pago', data.formaPago || 'CONTADO');
            drawCond('Plazo de Entrega', data.plazoEntrega || 'INMEDIATO');
            drawCond('Validez de Cotización', data.validezCotizacion || '7 DÍAS');
            if (mostrarPrecios && data.mostrarTotal !== false) {
                doc.rect(COL_X + condW, yc, totalW, footerH).strokeColor(NAVY).lineWidth(0.5).stroke();
                doc.fillColor(NAVY).fontSize(9).font('Helvetica-Bold')
                    .text('TOTAL', COL_X + condW + 5, yc + 15, { width: totalW - 10, align: 'left' });
                doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
                    .text(`S/ ${formatMoney(data.totalImporte || 0)}`, COL_X + condW + 5, yc + 32, { width: totalW - 10, align: 'center' });
            }
            yc += footerH + 12;
            // ─── OBSERVACIÓN ─────────────────────────────────────────────────────────
            if (data.observacion) {
                doc.rect(40, yc, TABLE_W, 30).fillColor('#fef9c3').fill();
                doc.rect(40, yc, TABLE_W, 30).strokeColor(NAVY).lineWidth(0.5).stroke();
                doc.fillColor(NAVY).fontSize(7.5).font('Helvetica-Bold').text('Comentario:', 46, yc + 5);
                doc.fillColor('#92400e').fontSize(8).font('Helvetica').text(data.observacion, 46, yc + 15, { width: TABLE_W - 12 });
                yc += 38;
            }
            // ─── CUENTAS BANCARIAS ────────────────────────────────────────────────────
            doc.rect(40, yc, TABLE_W, 38).strokeColor(NAVY).lineWidth(0.5).stroke();
            doc.fillColor(NAVY).fontSize(7.5).font('Helvetica-Bold').text('Cuentas corrientes', 46, yc + 5);
            doc.fillColor(NAVY).fontSize(7).font('Helvetica-Bold')
                .text('CUENTA CORRIENTE EN SOLES - FRENOS EMBRAGUES JUAN PABLO E.I.R.L.', 46, yc + 15, { width: TABLE_W - 12 });
            doc.fillColor(DARK).fontSize(7).font('Helvetica')
                .text('BBVA: N°: 00110320100027799    CCI: 00110322540100027799', 46, yc + 24, { width: TABLE_W - 12 })
                .text('BCP: N°: 1912170110002            CCI: 00219100217011000252', 200, yc + 24, { width: TABLE_W - 12 });
            doc.end();
        }
        catch (err) {
            reject(err);
        }
    });
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
        const data = { ...req.body, cotizacionNumero: req.body.cotizacionNumero || 'MANUAL', fecha: new Date().toLocaleDateString('es-PE') };
        const pdfBuffer = await generarPdfBuffer(data);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="cotizacion_${data.cotizacionNumero}.pdf"`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error('[PDF-ERROR] generarCotizacionPdf:', error);
        res.status(500).json({ error: 'No se pudo generar el PDF.' });
    }
};
exports.generarCotizacionPdf = generarCotizacionPdf;
const responderCotizacion = async (req, res) => {
    try {
        const { id } = req.params;
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
                vehiculo: req.body.clienteVehiculo || cotizacionDB.vehiculo,
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
            fecha: new Date().toLocaleDateString('es-PE')
        });
        await prisma_1.prisma.cotizacion.update({
            where: { id: parseInt(id) },
            data: {
                estado: 'ATENDIDO', datosCotizacion: req.body,
                nombre: req.body.clienteNombre || cotizacionDB.nombre,
                email: req.body.clienteEmail || cotizacionDB.email,
                vehiculo: req.body.clienteVehiculo || cotizacionDB.vehiculo,
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
        res.status(500).json({ error: 'No se pudo generar el PDF.' });
    }
};
exports.responderYGenerarPdfWhatsapp = responderYGenerarPdfWhatsapp;
