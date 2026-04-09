"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generarBoletaPdf = exports.createCierreCaja = exports.getCierresCaja = exports.updateTransaccion = exports.anularTransaccion = exports.createTransaccion = exports.getTransacciones = void 0;
const prisma_1 = require("../prisma");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const puppeteer_1 = __importDefault(require("puppeteer"));
// Obtener todas las transacciones (historial)
const getTransacciones = async (req, res) => {
    try {
        const transacciones = await prisma_1.prisma.transaccion.findMany({
            orderBy: { id: 'desc' },
            include: { cliente: true, numeroGuia: true }
        });
        res.json(transacciones);
    }
    catch (error) {
        console.error('Error al obtener transacciones:', error);
        res.status(500).json({ error: 'Error del servidor al obtener transacciones' });
    }
};
exports.getTransacciones = getTransacciones;
const createTransaccion = async (req, res) => {
    try {
        const { numero, tipo, monto, metodoPago, concepto, categoria, fecha, hora, estado, nota, clienteNombre, numeroGuiaId } = req.body;
        // Validación básica
        if (!numero || !tipo || !monto || !concepto || !metodoPago) {
            res.status(400).json({ error: 'Faltan campos obligatorios para registrar la transacción' });
            return;
        }
        const nuevaTxn = await prisma_1.prisma.transaccion.create({
            data: {
                numero,
                tipo,
                monto: Number(monto),
                metodoPago,
                concepto,
                categoria: categoria || 'Otros',
                fecha,
                hora,
                estado: estado || 'COMPLETADO',
                nota,
                clienteNombre,
                numeroGuiaId: numeroGuiaId ? Number(numeroGuiaId) : null
            }
        });
        res.status(201).json(nuevaTxn);
    }
    catch (error) {
        console.error('Error al crear transacción:', error);
        res.status(500).json({ error: 'Error del servidor al registrar transacción' });
    }
};
exports.createTransaccion = createTransaccion;
// Anular una transacción
const anularTransaccion = async (req, res) => {
    try {
        const { id } = req.params;
        // Verificar si existe antes de actualizar
        const txn = await prisma_1.prisma.transaccion.findUnique({ where: { id: Number(id) } });
        if (!txn) {
            res.status(404).json({ error: 'Transacción no encontrada' });
            return;
        }
        const updatedTxn = await prisma_1.prisma.transaccion.update({
            where: { id: Number(id) },
            data: { estado: 'ANULADO' }
        });
        res.json(updatedTxn);
    }
    catch (error) {
        console.error('Error al anular transacción:', error);
        res.status(500).json({ error: 'Error del servidor al anular transacción' });
    }
};
exports.anularTransaccion = anularTransaccion;
// Actualizar una transacción (ej: pasar de PENDIENTE a COMPLETADO, cambiar metodo o monto final)
const updateTransaccion = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, metodoPago, monto, nota } = req.body;
        // Verificar si existe
        const txn = await prisma_1.prisma.transaccion.findUnique({ where: { id: Number(id) } });
        if (!txn) {
            res.status(404).json({ error: 'Transacción no encontrada' });
            return;
        }
        // Actualizar campos si son proporcionados
        const dataToUpdate = {};
        if (estado !== undefined)
            dataToUpdate.estado = estado;
        if (metodoPago !== undefined)
            dataToUpdate.metodoPago = metodoPago;
        if (monto !== undefined)
            dataToUpdate.monto = Number(monto);
        if (nota !== undefined)
            dataToUpdate.nota = nota;
        // Si pasa a COMPLETADO hoy y no tiene fecha actual, se le asigna la fecha de cobro actual opcionalmente.
        // De momento mantendremos la fecha original, o actualizamos si es negocio.
        // Es mejor actualizar la fecha de cobro a la fecha actual para que suba a caja de hoy.
        if (estado === 'COMPLETADO' && txn.estado === 'PENDIENTE') {
            const ahora = new Date();
            dataToUpdate.fecha = ahora.toLocaleDateString('en-GB'); // DD/MM/YYYY
            dataToUpdate.hora = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
        }
        const updatedTxn = await prisma_1.prisma.transaccion.update({
            where: { id: Number(id) },
            data: dataToUpdate
        });
        res.json(updatedTxn);
    }
    catch (error) {
        console.error('Error al actualizar transacción:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar transacción' });
    }
};
exports.updateTransaccion = updateTransaccion;
// ========================
// CIERRE DE CAJA
// ========================
const getCierresCaja = async (req, res) => {
    try {
        const cierres = await prisma_1.prisma.cierreCaja.findMany({
            orderBy: { id: 'desc' },
            include: { transacciones: true }
        });
        res.json(cierres);
    }
    catch (error) {
        console.error('Error al obtener cierres de caja:', error);
        res.status(500).json({ error: 'Error del servidor al obtener cierres de caja' });
    }
};
exports.getCierresCaja = getCierresCaja;
const createCierreCaja = async (req, res) => {
    try {
        const { turno, montoInicial, efectivoCaja, totalEfectivo, totalTarjeta, totalTransferencia, totalYape, totalGeneral, diferencia, cerradoPor, observaciones } = req.body;
        const nuevoCierre = await prisma_1.prisma.cierreCaja.create({
            data: {
                montoInicial: Number(montoInicial) || 0,
                montoFinal: Number(efectivoCaja) || 0,
                estado: 'CERRADA',
                fechaCierre: new Date(),
                observaciones: JSON.stringify({
                    turno,
                    diferencia: Number(diferencia),
                    cerradoPor,
                    totalEfectivo: Number(totalEfectivo),
                    totalTarjeta: Number(totalTarjeta),
                    totalTransferencia: Number(totalTransferencia),
                    totalYape: Number(totalYape),
                    totalGeneral: Number(totalGeneral),
                    nota: observaciones
                })
            }
        });
        // Marcar transacciones de hoy cobradas como vinculadas a este cierre
        const hoy = new Date().toLocaleDateString('en-GB'); // DD/MM/YYYY
        await prisma_1.prisma.transaccion.updateMany({
            where: {
                fecha: hoy,
                estado: 'COMPLETADO',
                cierreCajaId: null
            },
            data: { cierreCajaId: nuevoCierre.id }
        });
        res.status(201).json(nuevoCierre);
    }
    catch (error) {
        console.error('Error al crear cierre de caja:', error);
        res.status(500).json({ error: 'Error del servidor al registrar cierre de caja' });
    }
};
exports.createCierreCaja = createCierreCaja;
// ========================
// GENERACIÓN DE BOLETA PDF
// ========================
const generarBoletaPdf = async (req, res) => {
    try {
        const { id } = req.params;
        // 1. Obtener la transacción de la BD
        const txn = await prisma_1.prisma.transaccion.findUnique({
            where: { id: parseInt(id) },
            include: {
                cliente: true,
                numeroGuia: {
                    include: {
                        detalles: true
                    }
                }
            }
        });
        if (!txn) {
            res.status(404).json({ error: 'Transacción no encontrada' });
            return;
        }
        // 2. Leer la plantilla HTML
        const templatePath = path_1.default.join(__dirname, '../templates/boletaTemplate.html');
        let htmlContent = fs_1.default.readFileSync(templatePath, 'utf8');
        // 3. Cargar el logo como Base64
        const logoPath = path_1.default.join(__dirname, '../assets/images/logo-jp.png');
        let logoBase64 = '';
        if (fs_1.default.existsSync(logoPath)) {
            const bitmap = fs_1.default.readFileSync(logoPath);
            logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
        }
        // 4. Generar las filas de productos
        let filasProductos = '';
        if (txn.numeroGuia && txn.numeroGuia.detalles.length > 0) {
            // Si tiene una guía asociada con detalles, los usamos
            txn.numeroGuia.detalles.forEach((det) => {
                filasProductos += `
          <tr>
            <td style="width: 8mm;">${det.cantidad}</td>
            <td>${det.descripcion}</td>
            <td class="text-right" style="width: 15mm;">${(det.cantidad * det.precioUnit).toFixed(2)}</td>
          </tr>
        `;
            });
        }
        else if (txn.nota && txn.nota.includes('DETALLES:[')) {
            // Si es una Venta Web, sacamos los detalles de la nota
            try {
                const jsonPart = txn.nota.split('DETALLES:')[1];
                const items = JSON.parse(jsonPart);
                items.forEach((p) => {
                    filasProductos += `
            <tr>
              <td style="width: 8mm;">${p.cantidad}</td>
              <td>${p.nombre}</td>
              <td class="text-right" style="width: 15mm;">${(p.cantidad * p.precio).toFixed(2)}</td>
            </tr>
          `;
                });
            }
            catch (e) {
                filasProductos = `<tr><td style="width: 8mm;">1</td><td>${txn.concepto}</td><td class="text-right">${txn.monto.toFixed(2)}</td></tr>`;
            }
        }
        else {
            // Si no, usamos el concepto como un único item
            filasProductos = `
        <tr>
          <td style="width: 8mm;">1</td>
          <td>${txn.concepto}</td>
          <td class="text-right" style="width: 15mm;">${txn.monto.toFixed(2)}</td>
        </tr>
      `;
        }
        // 5. Reemplazar variables
        const replacements = {
            '{{logoBase64}}': logoBase64,
            '{{empresaRuc}}': '20554702270', // RUC por defecto del taller
            '{{docTitle}}': txn.categoria === 'Venta Online' ? 'COMPROBANTE DE PEDIDO / PROFORMA' : 'BOLETA DE VENTA',
            '{{txnNumero}}': txn.numero,
            '{{fecha}}': txn.fecha,
            '{{hora}}': txn.hora,
            '{{clienteNombre}}': txn.clienteNombre || (txn.cliente ? `${txn.cliente.nombre} ${txn.cliente.apellidos || ''}` : 'CLIENTE MOSTRADOR'),
            '{{clienteDoc}}': txn.cliente?.documento || '',
            '{{metodoPago}}': txn.metodoPago,
            '{{filasProductos}}': filasProductos,
            '{{subtotal}}': (txn.monto / 1.18).toFixed(2),
            '{{igv}}': (txn.monto - (txn.monto / 1.18)).toFixed(2),
            '{{totalMonto}}': txn.monto.toFixed(2),
            '{{totalLetras}}': montoALetras(txn.monto)
        };
        for (const [key, value] of Object.entries(replacements)) {
            htmlContent = htmlContent.split(key).join(value);
        }
        // 6. Generar PDF con Puppeteer (formato narrow 80mm)
        const browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        // Configuración del PDF (ancho 80mm, alto dinámico auto)
        const pdfBuffer = await page.pdf({
            width: '80mm',
            printBackground: true,
            margin: { top: '0px', bottom: '0px', left: '0px', right: '0px' }
        });
        await browser.close();
        // 7. Enviar PDF al cliente
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="boleta_${txn.numero}.pdf"`);
        res.send(Buffer.from(pdfBuffer));
    }
    catch (error) {
        console.error('Error al generar boleta PDF:', error);
        res.status(500).json({ error: 'No se pudo generar el PDF de la boleta.' });
    }
};
exports.generarBoletaPdf = generarBoletaPdf;
// ========================
// HELPERS
// ========================
function montoALetras(monto) {
    const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
    const decenas = ['DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
    const especiales = ['ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
    const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];
    const convertir = (n) => {
        if (n === 0)
            return 'CERO';
        if (n === 100)
            return 'CIEN';
        let res = '';
        // Centenas
        if (n >= 100) {
            res += centenas[Math.floor(n / 100)] + ' ';
            n %= 100;
        }
        // Decenas
        if (n >= 10 && n <= 19) {
            if (n === 10)
                res += 'DIEZ';
            else
                res += especiales[n - 11];
            n = 0;
        }
        else if (n >= 20) {
            const d = Math.floor(n / 10);
            res += decenas[d - 1];
            n %= 10;
            if (n > 0) {
                if (d === 2) { // Venti...
                    res = 'VEINTI' + unidades[n];
                    n = 0;
                }
                else {
                    res += ' Y ';
                }
            }
        }
        // Unidades
        if (n > 0) {
            res += unidades[n];
        }
        return res.trim();
    };
    const parteEntera = Math.floor(monto);
    const parteDecimal = Math.round((monto - parteEntera) * 100);
    let resultado = '';
    if (parteEntera >= 1000000) {
        const millones = Math.floor(parteEntera / 1000000);
        const restoMillon = parteEntera % 1000000;
        resultado += (millones === 1 ? 'UN MILLON' : convertir(millones) + ' MILLONES') + ' ';
        if (restoMillon > 0) {
            if (restoMillon >= 1000) {
                const miles = Math.floor(restoMillon / 1000);
                const resto = restoMillon % 1000;
                resultado += (miles === 1 ? 'MIL' : convertir(miles) + ' MIL') + ' ';
                resultado += resto > 0 ? convertir(resto) : '';
            }
            else {
                resultado += convertir(restoMillon);
            }
        }
    }
    else if (parteEntera >= 1000) {
        const miles = Math.floor(parteEntera / 1000);
        const resto = parteEntera % 1000;
        resultado += (miles === 1 ? 'MIL' : convertir(miles) + ' MIL') + ' ';
        resultado += resto > 0 ? convertir(resto) : '';
    }
    else {
        resultado = convertir(parteEntera);
    }
    const centavos = parteDecimal.toString().padStart(2, '0');
    return `SON: ${resultado.trim()} CON ${centavos}/100 SOLES`;
}
