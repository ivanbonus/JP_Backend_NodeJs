"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generarPdfGuia = exports.deleteGuia = exports.deleteCita = exports.createCita = exports.getCitas = exports.createVehiculo = exports.updateGuia = exports.createGuia = exports.deleteVehiculo = exports.getGuias = void 0;
const prisma_1 = require("../prisma"); // Importar Prisma instanciado en el entrypoint
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const getGuias = async (req, res) => {
    try {
        const guias = await prisma_1.prisma.numeroGuia.findMany({
            include: {
                cliente: true,
                vehiculo: true,
                tecnicos: true,
                detalles: true
            },
            orderBy: { fechaRecepcion: 'desc' }
        });
        res.json(guias);
    }
    catch (error) {
        console.error('Error al obtener guías:', error);
        res.status(500).json({ error: 'Error del servidor al obtener las guías.' });
    }
};
exports.getGuias = getGuias;
const deleteVehiculo = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.vehiculo.delete({ where: { id: Number(id) } });
        res.json({ message: 'Vehículo eliminado correctamente.' });
    }
    catch (error) {
        console.error('Error al borrar vehículo:', error);
        res.status(500).json({ error: 'No se pudo eliminar el vehículo. Es posible que tenga órdenes de trabajo asociadas.' });
    }
};
exports.deleteVehiculo = deleteVehiculo;
const createGuia = async (req, res) => {
    try {
        const { clienteId, vehiculoId, diagnostico, observaciones, tecnicosIds, detalles } = req.body;
        // Validar Requeridos Básicos
        if (!clienteId || !vehiculoId) {
            res.status(400).json({ error: 'clienteId y vehiculoId son requeridos.' });
            return;
        }
        const nuevaGuia = await prisma_1.prisma.numeroGuia.create({
            data: {
                clienteId,
                vehiculoId,
                diagnostico,
                observaciones,
                tecnicos: tecnicosIds && tecnicosIds.length > 0 ? {
                    connect: tecnicosIds.map((id) => ({ id }))
                } : undefined,
                detalles: detalles && detalles.length > 0 ? {
                    create: detalles.map((d) => ({
                        descripcion: d.descripcion,
                        cantidad: Number(d.cantidad) || 1,
                        precioUnit: Number(d.precioUnit) || 0
                    }))
                } : undefined
            },
            include: { cliente: true, vehiculo: true, tecnicos: true, detalles: true }
        });
        res.status(201).json(nuevaGuia);
    }
    catch (error) {
        console.error('Error al crear guía:', error);
        res.status(500).json({ error: 'Error del servidor al crear la guía.' });
    }
};
exports.createGuia = createGuia;
const updateGuia = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, diagnostico, observaciones, tecnicosIds, detalles } = req.body;
        // Actualizamos la guía
        const guiaActualizada = await prisma_1.prisma.numeroGuia.update({
            where: { id: Number(id) },
            data: {
                estado,
                diagnostico,
                observaciones,
                tecnicos: tecnicosIds ? {
                    set: [], // Reseteamos la asignación actual
                    connect: tecnicosIds.map((tid) => ({ id: tid })) // Conectamos los nuevos técnicos
                } : undefined,
                detalles: detalles ? {
                    deleteMany: {}, // Borramos actuales
                    create: detalles.map((d) => ({
                        descripcion: d.descripcion,
                        cantidad: Number(d.cantidad) || 1,
                        precioUnit: Number(d.precioUnit) || 0
                    }))
                } : undefined
            },
            include: { cliente: true, vehiculo: true, tecnicos: true, detalles: true }
        });
        res.json(guiaActualizada);
    }
    catch (error) {
        console.error('Error al actualizar guía:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar la guía.' });
    }
};
exports.updateGuia = updateGuia;
const createVehiculo = async (req, res) => {
    try {
        const { placa, marca, modelo, anio, color, clienteId } = req.body;
        if (!placa || !marca || !modelo || !clienteId) {
            res.status(400).json({ error: 'placa, marca, modelo y clienteId son requeridos.' });
            return;
        }
        const nuevoVehiculo = await prisma_1.prisma.vehiculo.create({
            data: { placa, marca, modelo, anio: Number(anio) || null, color, clienteId: Number(clienteId) },
            include: { cliente: true }
        });
        res.status(201).json(nuevoVehiculo);
    }
    catch (error) {
        console.error('Error al registrar vehículo:', error);
        res.status(500).json({ error: 'Error del servidor al registrar el vehículo. Puede que la placa ya exista.' });
    }
};
exports.createVehiculo = createVehiculo;
const getCitas = async (req, res) => {
    try {
        const citas = await prisma_1.prisma.cita.findMany({
            include: {
                cliente: true,
                vehiculo: true
            },
            orderBy: { fechaHora: 'asc' }
        });
        res.json(citas);
    }
    catch (error) {
        console.error('Error al obtener citas:', error);
        res.status(500).json({ error: 'Error del servidor al obtener las citas.' });
    }
};
exports.getCitas = getCitas;
const createCita = async (req, res) => {
    try {
        const { fechaHora, motivo, clienteId, vehiculoId } = req.body;
        if (!fechaHora || !motivo || !clienteId || !vehiculoId) {
            res.status(400).json({ error: 'Faltan campos obligatorios para agendar la cita.' });
            return;
        }
        const nuevaCita = await prisma_1.prisma.cita.create({
            data: {
                fechaHora: new Date(fechaHora),
                motivo,
                clienteId: Number(clienteId),
                vehiculoId: Number(vehiculoId)
            },
            include: { cliente: true, vehiculo: true }
        });
        res.status(201).json(nuevaCita);
    }
    catch (error) {
        console.error('Error al agendar cita:', error);
        res.status(500).json({ error: 'Error del servidor al crear cita.' });
    }
};
exports.createCita = createCita;
const deleteCita = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.cita.delete({ where: { id: Number(id) } });
        res.json({ message: 'Cita cancelada y eliminada correctamente.' });
    }
    catch (error) {
        console.error('Error al borrar cita:', error);
        res.status(500).json({ error: 'Error del servidor al cancelar la cita.' });
    }
};
exports.deleteCita = deleteCita;
const deleteGuia = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.numeroGuia.delete({ where: { id: Number(id) } });
        res.json({ message: 'Guía eliminada correctamente del historial.' });
    }
    catch (error) {
        console.error('Error al borrar guía:', error);
        res.status(500).json({ error: 'Error del servidor al eliminar la guía.' });
    }
};
exports.deleteGuia = deleteGuia;
const generarPdfGuia = async (req, res) => {
    try {
        const { id } = req.params;
        const guia = await prisma_1.prisma.numeroGuia.findUnique({
            where: { id: Number(id) },
            include: {
                cliente: true,
                vehiculo: true,
                detalles: true
            }
        });
        if (!guia) {
            res.status(404).json({ error: 'Guía no encontrada.' });
            return;
        }
        // 1. Leer la plantilla HTML
        const templatePath = path_1.default.join(__dirname, '../templates/cotizacionTemplate.html');
        let htmlContent = fs_1.default.readFileSync(templatePath, 'utf8');
        // Mantenemos el mismo diseño de logo
        const logoPath = path_1.default.join(__dirname, '../assets/images/logo-jp.png');
        let logoBase64 = '';
        if (fs_1.default.existsSync(logoPath)) {
            const bitmap = fs_1.default.readFileSync(logoPath);
            logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
        }
        // 3. Generar las filas de detalles en HTML
        let filasProductos = '';
        let totalImporte = 0;
        if (guia.detalles && guia.detalles.length > 0) {
            guia.detalles.forEach((det, index) => {
                const importe = (det.cantidad || 1) * (det.precioUnit || 0);
                totalImporte += importe;
                const isLastRow = index === guia.detalles.length - 1;
                const rowClass = isLastRow ? 'item-row last-item-row' : 'item-row';
                filasProductos += `
          <tr class="${rowClass}">
              <td> - </td>
              <td class="center">${det.cantidad}</td>
              <td>${det.descripcion}</td>
              <td class="right">${Number(det.precioUnit).toFixed(2)}</td>
              <td class="right">${Number(importe).toFixed(2)}</td>
          </tr>
        `;
            });
        }
        if (!filasProductos) {
            filasProductos = `
          <tr class="item-row last-item-row">
              <td colspan="5" class="center">Sin servicios ingresados</td>
          </tr>
        `;
        }
        const nroGuiaC = `NG-${String(guia.id).padStart(3, '0')}`;
        const vehiculoFullName = guia.vehiculo ? `${guia.vehiculo.marca} ${guia.vehiculo.modelo} (${guia.vehiculo.placa})` : '';
        const replacements = {
            '{{logoBase64}}': logoBase64,
            '{{empresaRuc}}': '20554702270',
            '{{cotizacionNumero}}': nroGuiaC,
            '{{clienteNombre}}': guia.cliente && guia.cliente.nombre ? (guia.cliente.nombre + ' ' + (guia.cliente.apellidos || '')).trim() : 'Cliente mostrador',
            '{{clienteDocumento}}': guia.cliente?.documento || '',
            '{{clienteAtencion}}': vehiculoFullName,
            '{{clienteDireccion}}': guia.cliente?.direccion || '',
            '{{clienteEmail}}': guia.cliente?.email || '',
            '{{clienteTelefono}}': guia.cliente?.telefono || '',
            '{{clienteCelular}}': guia.cliente?.telefono || '',
            '{{fecha}}': new Date().toLocaleDateString('es-PE'),
            '{{vendedorNombre}}': 'Frenos y Embragues Juan Pablo',
            '{{moneda}}': 'Soles',
            '{{filasProductos}}': filasProductos,
            '{{formaPago}}': '-',
            '{{plazoEntrega}}': '-',
            '{{validezCotizacion}}': 'DOCUMENTO DE COBRO - GUÍA',
            '{{observacion}}': guia.observaciones || 'Servicio realizado en el taller. Garantía por defecto de fábrica.',
            '{{totalImporte}}': Number(totalImporte).toFixed(2),
        };
        // Replace strings (simple multiple replace)
        const replaceEscaped = htmlContent.replace(/{{([a-zA-Z0-9_]+)}}/g, (match, p1) => {
            const val = replacements[match];
            return val !== undefined ? val : match;
        });
        // Modify text specific to Cotizacion -> Guia (since we are reusing the web template)
        let finalHtml = replaceEscaped.replace(/>COTIZACIÓN N°/g, '>PROFORMA / SERVICIO N°');
        finalHtml = finalHtml.replace(/Cotizamos lo siguiente:/g, 'Trabajo realizado / diagnóstico: ' + (guia.diagnostico || ''));
        // 5. Generar PDF con Puppeteer
        const browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(finalHtml, { waitUntil: 'networkidle0' });
        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
        });
        await browser.close();
        // 6. Enviar PDF al cliente
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Guia_${nroGuiaC}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
    }
    catch (error) {
        console.error('Error al generar PDF Guia:', error);
        res.status(500).json({ error: 'No se pudo generar el PDF de la Guía.' });
    }
};
exports.generarPdfGuia = generarPdfGuia;
