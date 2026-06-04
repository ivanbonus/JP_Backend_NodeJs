"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.responderYGenerarPdfWhatsapp = exports.responderCotizacion = exports.generarCotizacionPdf = exports.updateCotizacionStatus = exports.getCotizaciones = exports.createCotizacion = void 0;
const prisma_1 = require("../prisma");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const puppeteer_1 = __importDefault(require("puppeteer"));
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
 * Helper centralizado para generar el PDF de una cotización usando Puppeteer y la plantilla HTML.
 * Esto garantiza que el diseño sea idéntico al original.
 */
async function generarPdfBuffer(data) {
    console.log(`[PDF-GENERATOR] Iniciando generación con Puppeteer para #${data.cotizacionNumero}`);
    // EXTREMADAMENTE IMPORTANTE: Usamos un manejo robusto del logo en Base64
    let logoBase64 = '';
    try {
        // Intentar varias rutas comunes para encontrar el logo
        const possiblePaths = [
            path_1.default.join(process.cwd(), 'src/assets/images/logo-jp.png'),
            path_1.default.join(process.cwd(), 'dist/assets/images/logo-jp.png'),
            path_1.default.join(__dirname, '../assets/images/logo-jp.png'),
            path_1.default.join(process.cwd(), 'src/assets/images/logo-jp1.png')
        ];
        let foundPath = '';
        for (const p of possiblePaths) {
            if (fs_1.default.existsSync(p)) {
                foundPath = p;
                break;
            }
        }
        if (foundPath) {
            const logoData = fs_1.default.readFileSync(foundPath);
            logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`;
            console.log(`[PDF-LOGO] Logo cargado con éxito. Tamaño Base64: ${logoBase64.length} caracteres.`);
        }
        else {
            console.warn("[PDF-WARN] No se encontró el logo en ninguna de las rutas intentadas.");
        }
    }
    catch (err) {
        console.warn("[PDF-WARN] Error cargando el logo:", err);
    }
    // Cargar plantilla HTML
    const templatePath = path_1.default.join(__dirname, '../templates/cotizacionTemplate.html');
    if (!fs_1.default.existsSync(templatePath)) {
        throw new Error("No se encontró la plantilla HTML de cotización.");
    }
    let html = fs_1.default.readFileSync(templatePath, 'utf8');
    // Reemplazos de placeholders usando RegExp para mayor seguridad
    const safeReplace = (content, key, value) => {
        return content.split(`{{${key}}}`).join(value);
    };
    html = safeReplace(html, 'logoBase64', logoBase64);
    html = safeReplace(html, 'empresaRuc', data.empresaRuc || '20554702270');
    html = safeReplace(html, 'cotizacionNumero', data.cotizacionNumero || 'W-00000');
    html = safeReplace(html, 'clienteNombre', (data.clienteNombre || '').toUpperCase());
    html = safeReplace(html, 'clienteDocumento', data.clienteDocumento || '-');
    html = safeReplace(html, 'clienteAtencion', data.clienteAtencion || '-');
    html = safeReplace(html, 'clienteDireccion', data.clienteDireccion || '-');
    html = safeReplace(html, 'clienteEmail', data.clienteEmail || '-');
    html = safeReplace(html, 'clienteTelefono', data.clienteTelefono || '-');
    html = safeReplace(html, 'fecha', data.fecha || new Date().toLocaleDateString('es-PE'));
    html = safeReplace(html, 'vendedorNombre', (data.vendedorNombre || 'Atención Web').toUpperCase());
    html = safeReplace(html, 'clienteCelular', data.clienteCelular || data.clienteTelefono || '-');
    html = safeReplace(html, 'moneda', (data.moneda || 'SOLES').toUpperCase());
    html = safeReplace(html, 'formaPago', (data.formaPago || 'CONTADO').toUpperCase());
    html = safeReplace(html, 'plazoEntrega', (data.plazoEntrega || 'INMEDIATO').toUpperCase());
    html = safeReplace(html, 'validezCotizacion', (data.validezCotizacion || '7 DÍAS').toUpperCase());
    html = safeReplace(html, 'observacion', data.observacion || 'EL IMPORTE SEÑALADO INCLUYE EXCLUSIVAMENTE LOS TRABAJOS PREVIAMENTE DESCRITOS. CUALQUIER DESPERFECTO ADICIONAL QUE PRESENTE LA UNIDAD SERÁ MATERIA DE EVALUACIÓN Y COTIZACIÓN INDEPENDIENTE');
    // Reemplazo de productos (Tabla)
    const mostrarPrecios = data.mostrarPreciosUnitarios !== false;
    const headersHtml = `
        <tr>
            <th style="width: 15%;">CODIGO</th>
            <th class="center" style="width: 10%;">CANT</th>
            <th style="width: ${mostrarPrecios ? '45%' : '75%'}; text-align: left;">DESCRIPCION DEL ARTICULO</th>
            ${mostrarPrecios ? '<th class="right" style="width: 15%;">P. UNIT.</th>' : ''}
            ${mostrarPrecios ? '<th class="right" style="width: 15%;">IMPORTE</th>' : ''}
        </tr>
    `;
    html = html.replace('{{headersProductos}}', headersHtml);
    const productos = Array.isArray(data.productos) ? data.productos : [];
    let filasHtml = '';
    productos.forEach((prod, idx) => {
        const isLast = idx === productos.length - 1;
        filasHtml += `
            <tr class="item-row ${isLast ? 'last-item-row' : ''}">
                <td>${prod.codigo || '-'}</td>
                <td class="center">${prod.cantidad ?? 0}</td>
                <td>${prod.descripcion || ''}</td>
                ${mostrarPrecios ? `<td class="right">${formatMoney(prod.precioUnitario)}</td>` : ''}
                ${mostrarPrecios ? `<td class="right">${formatMoney(prod.importe)}</td>` : ''}
            </tr>
        `;
    });
    if (filasHtml === '') {
        filasHtml = '<tr><td colspan="5" class="center">Sin artículos registrados</td></tr>';
    }
    html = html.replace('{{filasProductos}}', filasHtml);
    // Sección Total
    let totalHtml = '';
    if (mostrarPrecios && data.mostrarTotal !== false) {
        totalHtml = `
            <div class="totals">
                <div class="total-label">TOTAL</div>
                <div class="total-value" style="font-size: 16px; font-weight: bold; color: #0b2e59;">S/ ${formatMoney(data.totalImporte || 0)}</div>
            </div>
        `;
    }
    html = html.replace('{{totalSeccion}}', totalHtml);
    // Generar PDF con Puppeteer
    let browser;
    try {
        browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
        });
        await browser.close();
        return Buffer.from(pdf);
    }
    catch (err) {
        if (browser)
            await browser.close();
        throw err;
    }
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
        const data = { ...req.body, cotizacionNumero: req.body.cotizacionNumero || 'MANUAL', fecha: new Date().toLocaleDateString('es-PE') };
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
        res.status(500).json({ error: 'No se pudo generar el PDF con el diseño original.' });
    }
};
exports.responderYGenerarPdfWhatsapp = responderYGenerarPdfWhatsapp;
