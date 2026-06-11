import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';

// Helper to format currency
const formatMoney = (val: any): string => {
    if (val === '' || val === null || val === undefined) return '0.00';
    const num = Number(val);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Helper to find the logo path
const getLogoPath = (): string | null => {
    const possiblePaths = [
        path.join(process.cwd(), 'src/assets/images/logo-jp.png'),
        path.join(process.cwd(), 'dist/assets/images/logo-jp.png'),
        path.join(__dirname, '../assets/images/logo-jp.png'),
        path.join(process.cwd(), 'src/assets/images/logo-jp1.png')
    ];
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
};

// 1. Generate A4 Cotización PDF
export function generarCotizacionPdfKit(data: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 30 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err) => reject(err));

            const logo = getLogoPath();
            
            // --- HEADER ---
            // Logo on the left
            if (logo) {
                doc.image(logo, 30, 30, { width: 100 });
            }

            // Company Title and Details next to logo
            doc.fillColor('#0b2e59');
            doc.font('Helvetica-Bold').fontSize(12);
            doc.text('FRENOS EMBRAGUES "JUAN PABLO" E.I.R.L.', 140, 30);
            
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#0b2e59');
            doc.text('ESPECIALIDAD EN ENSAMBLAJE AIRE E HIDRÁULICO', 140, 45);
            doc.font('Helvetica').fontSize(6.5).fillColor('#333');
            doc.text('Reparación de Frenos y Embragues en General: Compresoras, Pedal de Freno, Bombas, Válvulas de Aire e Hidráulico', 140, 55);
            doc.text('SISTEMA ABS - VENTA DE REPUESTOS Y ACCESORIOS ORIGINALES', 140, 65);
            doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#0b2e59');
            doc.text('Av. Los Ciruelos N° 327 - Urb. San Carlos - S.J.L.  |  E-mail: frenosjuanpablo_24@hotmail.com', 140, 75);
            doc.text('Telf.: 946 020 871 / 987 417 892 / 990 221 676 / 950 123 482 / 927 125 694 / 960 405 881', 140, 85);

            // RUC Box on the top right
            doc.strokeColor('#0b2e59').lineWidth(1.5);
            doc.rect(430, 30, 135, 65).stroke();
            
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(9);
            doc.text(`R.U.C. ${data.empresaRuc || '20554702270'}`, 430, 38, { width: 135, align: 'center' });
            
            // Red title banner in RUC Box
            doc.rect(431, 48, 133, 16).fill('#da3a3a');
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
            doc.text('COTIZACION', 430, 52, { width: 135, align: 'center' });
            
            // Quotation number
            doc.fillColor('#da3a3a').font('Helvetica-Bold').fontSize(10);
            doc.text(`Nº ${data.cotizacionNumero || 'W-00000'}`, 430, 70, { width: 135, align: 'center' });

            // Horizontal line separating header
            doc.moveTo(30, 105).lineTo(565, 105).strokeColor('#0b2e59').lineWidth(1).stroke();

            // --- CLIENT & SELLER METADATA ---
            let metaY = 115;
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5);
            
            // Left Column (Client)
            const drawMetaRow = (label: string, value: string, xLabel: number, xVal: number, y: number) => {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').text(label, xLabel, y);
                doc.text(':', xLabel + 70, y);
                doc.fillColor('#333').font('Helvetica').text(String(value || '-').toUpperCase(), xVal, y, { width: 230 });
            };

            drawMetaRow('Señor(es)', data.clienteNombre, 30, 110, metaY);
            drawMetaRow('R.U.C./D.N.I.', data.clienteDocumento, 30, 110, metaY + 12);
            drawMetaRow('Atención', data.clienteAtencion, 30, 110, metaY + 24);
            drawMetaRow('Dirección', data.clienteDireccion, 30, 110, metaY + 36);
            drawMetaRow('Email', data.clienteEmail, 30, 110, metaY + 48);
            drawMetaRow('Teléfono', data.clienteTelefono, 30, 110, metaY + 60);

            // Right Column (Seller / Date)
            const drawMetaRowRight = (label: string, value: string, xLabel: number, xVal: number, y: number) => {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').text(label, xLabel, y);
                doc.text(':', xLabel + 45, y);
                doc.fillColor('#333').font('Helvetica').text(String(value || '-').toUpperCase(), xVal, y);
            };

            drawMetaRowRight('Fecha', data.fecha || new Date().toLocaleDateString('es-PE'), 380, 435, metaY);
            drawMetaRowRight('Vendedor', data.vendedorNombre || 'Atención Web', 380, 435, metaY + 12);
            drawMetaRowRight('Celular', data.clienteCelular || data.clienteTelefono || '-', 380, 435, metaY + 24);
            drawMetaRowRight('Moneda', data.moneda || 'SOLES', 380, 435, metaY + 36);
            drawMetaRowRight('Placa', data.clientePlaca || data.placa || '-', 380, 435, metaY + 48);

            // Intro text
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5);
            doc.text('Por medio de la presente, tenemos a bien hacerles llegar la cotización de precios, por lo siguiente:', 30, 190);

            // --- PRODUCTS TABLE ---
            let tableY = 205;
            const colWidths = { codigo: 65, cant: 35, desc: 250, unit: 90, imp: 95 };
            const colPositions = {
                codigo: 30,
                cant: 30 + colWidths.codigo,
                desc: 30 + colWidths.codigo + colWidths.cant,
                unit: 30 + colWidths.codigo + colWidths.cant + colWidths.desc,
                imp: 30 + colWidths.codigo + colWidths.cant + colWidths.desc + colWidths.unit
            };

            const mostrarPrecios = data.mostrarPreciosUnitarios !== false;
            let descWidth = colWidths.desc;
            if (!mostrarPrecios) {
                descWidth = colWidths.desc + colWidths.unit + colWidths.imp;
            }

            // Draw Table Header Background
            doc.rect(30, tableY, 535, 18).fill('#0b2e59');
            
            // Table Headers Text
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
            doc.text('CODIGO', colPositions.codigo + 5, tableY + 5);
            doc.text('CANT', colPositions.cant, tableY + 5, { width: colWidths.cant, align: 'center' });
            doc.text('DESCRIPCION DEL ARTICULO', colPositions.desc + 5, tableY + 5);
            
            if (mostrarPrecios) {
                doc.text('P. UNIT.', colPositions.unit, tableY + 5, { width: colWidths.unit - 5, align: 'right' });
                doc.text('IMPORTE', colPositions.imp, tableY + 5, { width: colWidths.imp - 5, align: 'right' });
            }

            // Draw Rows
            let currentY = tableY + 18;
            const productos = Array.isArray(data.productos) ? data.productos : [];
            doc.fillColor('#333').font('Helvetica').fontSize(7.5);

            // Set line style for outer grid
            doc.strokeColor('#0b2e59').lineWidth(1);

            productos.forEach((prod: any) => {
                const descText = String(prod.descripcion || '').toUpperCase();
                const descHeight = doc.heightOfString(descText, { width: descWidth - 10 }) + 8;
                const rowHeight = Math.max(descHeight, 18);

                // Draw vertical boundaries
                doc.moveTo(30, currentY).lineTo(30, currentY + rowHeight).stroke();
                doc.moveTo(colPositions.cant, currentY).lineTo(colPositions.cant, currentY + rowHeight).stroke();
                doc.moveTo(colPositions.desc, currentY).lineTo(colPositions.desc, currentY + rowHeight).stroke();
                
                if (mostrarPrecios) {
                    doc.moveTo(colPositions.unit, currentY).lineTo(colPositions.unit, currentY + rowHeight).stroke();
                    doc.moveTo(colPositions.imp, currentY).lineTo(colPositions.imp, currentY + rowHeight).stroke();
                }
                doc.moveTo(565, currentY).lineTo(565, currentY + rowHeight).stroke();

                // Draw values
                doc.text(String(prod.codigo || '-').toUpperCase(), colPositions.codigo + 5, currentY + 5);
                doc.text(String(prod.cantidad ?? 0), colPositions.cant, currentY + 5, { width: colWidths.cant, align: 'center' });
                doc.text(descText, colPositions.desc + 5, currentY + 5, { width: descWidth - 10 });
                
                if (mostrarPrecios) {
                    doc.text(formatMoney(prod.precioUnitario), colPositions.unit, currentY + 5, { width: colWidths.unit - 5, align: 'right' });
                    doc.text(formatMoney(prod.importe), colPositions.imp, currentY + 5, { width: colWidths.imp - 5, align: 'right' });
                }

                currentY += rowHeight;
            });

            // Draw empty line or bottom border of table
            doc.moveTo(30, currentY).lineTo(565, currentY).stroke();

            // Table Footer (Conditions & Totals)
            const footerHeight = 65;
            doc.rect(30, currentY, 535, footerHeight).stroke();
            doc.moveTo(380, currentY).lineTo(380, currentY + footerHeight).stroke(); // divide conditions and total

            // Draw Conditions on the left
            let condY = currentY + 8;
            const drawCondRow = (label: string, value: string, y: number) => {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5).text(label, 40, y);
                doc.fillColor('#333').font('Helvetica').text(String(value || '-').toUpperCase(), 140, y);
            };

            drawCondRow('Forma de Pago', data.formaPago || 'CONTADO', condY);
            drawCondRow('Plazo de Entrega', data.plazoEntrega || 'INMEDIATO', condY + 15);
            drawCondRow('Validez de Cotización', data.validezCotizacion || '7 DÍAS', condY + 30);

            // Draw Total on the right
            if (mostrarPrecios && data.mostrarTotal !== false) {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(9).text('TOTAL', 390, currentY + 15);
                doc.fontSize(12).fillColor('#0b2e59').text(`S/ ${formatMoney(data.totalImporte || 0)}`, 390, currentY + 30, { width: 165, align: 'right' });
            }

            currentY += footerHeight + 15;

            // --- COMMENT / OBSERVATION BOX ---
            const obsTitle = 'Comentario';
            const obsContent = String(data.observacion || 'EL IMPORTE SEÑALADO INCLUYE EXCLUSIVAMENTE LOS TRABAJOS PREVIAMENTE DESCRITOS. CUALQUIER DESPERFECTO ADICIONAL QUE PRESENTE LA UNIDAD SERÁ MATERIA DE EVALUACIÓN Y COTIZACIÓN INDEPENDIENTE').toUpperCase();
            
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(8.5).text(obsTitle, 30, currentY);
            currentY += 12;

            const obsHeight = doc.heightOfString(obsContent, { width: 515 }) + 14;
            
            // Draw yellow filled background box
            doc.rect(30, currentY, 535, obsHeight).fill('#fef08a');
            doc.rect(30, currentY, 535, obsHeight).strokeColor('#0b2e59').stroke();
            
            doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(7.5).text(obsContent, 40, currentY + 7, { width: 515, lineGap: 2 });
            currentY += obsHeight + 15;

            // --- BANK ACCOUNTS BOX ---
            const bankTitle = 'Cuentas corrientes';
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(8.5).text(bankTitle, 30, currentY);
            currentY += 12;

            const bankBoxHeight = 45;
            doc.rect(30, currentY, 535, bankBoxHeight).strokeColor('#0b2e59').stroke();
            
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5);
            doc.text('CUENTA CORRIENTE EN SOLES - FRENOS EMBRAGUES JUAN PABLO E.I.R.L.', 40, currentY + 8);
            
            doc.font('Helvetica').fillColor('#333');
            doc.text('BBVA: Nº: 00110320100027799        CCI: 00110322540100027799', 40, currentY + 20);
            doc.text('BCP: Nº: 1912170110002              CCI: 00219100217011000252', 40, currentY + 30);

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// 2. Generate A4 Guía PDF
export function generarGuiaPdfKit(data: any): Promise<Buffer> {
    // Custom replacements for Guia format
    const modData = {
        ...data,
        validezCotizacion: 'DOCUMENTO DE COBRO - GUÍA',
        observacion: data.observacion || 'Servicio realizado en el taller. Garantía por defecto de fábrica.'
    };
    
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', margin: 30 });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err) => reject(err));

            const logo = getLogoPath();
            
            // --- HEADER ---
            if (logo) {
                doc.image(logo, 30, 30, { width: 100 });
            }

            doc.fillColor('#0b2e59');
            doc.font('Helvetica-Bold').fontSize(12);
            doc.text('FRENOS EMBRAGUES "JUAN PABLO" E.I.R.L.', 140, 30);
            
            doc.font('Helvetica-Bold').fontSize(7).fillColor('#0b2e59');
            doc.text('ESPECIALIDAD EN ENSAMBLAJE AIRE E HIDRÁULICO', 140, 45);
            doc.font('Helvetica').fontSize(6.5).fillColor('#333');
            doc.text('Reparación de Frenos y Embragues en General: Compresoras, Pedal de Freno, Bombas, Válvulas de Aire e Hidráulico', 140, 55);
            doc.text('SISTEMA ABS - VENTA DE REPUESTOS Y ACCESORIOS ORIGINALES', 140, 65);
            doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#0b2e59');
            doc.text('Av. Los Ciruelos N° 327 - Urb. San Carlos - S.J.L.  |  E-mail: frenosjuanpablo_24@hotmail.com', 140, 75);
            doc.text('Telf.: 946 020 871 / 987 417 892 / 990 221 676 / 950 123 482 / 927 125 694 / 960 405 881', 140, 85);

            // RUC Box on the top right
            doc.strokeColor('#0b2e59').lineWidth(1.5);
            doc.rect(430, 30, 135, 65).stroke();
            
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(9);
            doc.text(`R.U.C. ${modData.empresaRuc || '20554702270'}`, 430, 38, { width: 135, align: 'center' });
            
            // Red title banner in RUC Box
            doc.rect(431, 48, 133, 16).fill('#da3a3a');
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8.5);
            doc.text('PROFORMA / SERVICIO', 430, 52, { width: 135, align: 'center' });
            
            // Quotation number
            doc.fillColor('#da3a3a').font('Helvetica-Bold').fontSize(10);
            doc.text(`Nº ${modData.cotizacionNumero || 'NG-000'}`, 430, 70, { width: 135, align: 'center' });

            doc.moveTo(30, 105).lineTo(565, 105).strokeColor('#0b2e59').lineWidth(1).stroke();

            // --- METADATA ---
            let metaY = 115;
            const drawMetaRow = (label: string, value: string, xLabel: number, xVal: number, y: number) => {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').text(label, xLabel, y);
                doc.text(':', xLabel + 70, y);
                doc.fillColor('#333').font('Helvetica').text(String(value || '-').toUpperCase(), xVal, y, { width: 230 });
            };

            drawMetaRow('Señor(es)', modData.clienteNombre, 30, 110, metaY);
            drawMetaRow('R.U.C./D.N.I.', modData.clienteDocumento, 30, 110, metaY + 12);
            drawMetaRow('Atención', modData.clienteAtencion, 30, 110, metaY + 24);
            drawMetaRow('Dirección', modData.clienteDireccion, 30, 110, metaY + 36);
            drawMetaRow('Email', modData.clienteEmail, 30, 110, metaY + 48);
            drawMetaRow('Teléfono', modData.clienteTelefono, 30, 110, metaY + 60);

            const drawMetaRowRight = (label: string, value: string, xLabel: number, xVal: number, y: number) => {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').text(label, xLabel, y);
                doc.text(':', xLabel + 45, y);
                doc.fillColor('#333').font('Helvetica').text(String(value || '-').toUpperCase(), xVal, y);
            };

            drawMetaRowRight('Fecha', modData.fecha || new Date().toLocaleDateString('es-PE'), 380, 435, metaY);
            drawMetaRowRight('Vendedor', modData.vendedorNombre || 'Frenos y Embragues Juan Pablo', 380, 435, metaY + 12);
            drawMetaRowRight('Celular', modData.clienteCelular || modData.clienteTelefono || '-', 380, 435, metaY + 24);
            drawMetaRowRight('Moneda', modData.moneda || 'SOLES', 380, 435, metaY + 36);
            drawMetaRowRight('Placa', modData.clientePlaca || modData.placa || '-', 380, 435, metaY + 48);

            // Diagnostic / Work completed Intro
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5);
            doc.text(`Trabajo realizado / diagnóstico: ${String(modData.diagnostico || '').toUpperCase()}`, 30, 190, { width: 535 });

            // --- PRODUCTS TABLE ---
            let tableY = 215;
            const colWidths = { codigo: 65, cant: 35, desc: 250, unit: 90, imp: 95 };
            const colPositions = {
                codigo: 30,
                cant: 30 + colWidths.codigo,
                desc: 30 + colWidths.codigo + colWidths.cant,
                unit: 30 + colWidths.codigo + colWidths.cant + colWidths.desc,
                imp: 30 + colWidths.codigo + colWidths.cant + colWidths.desc + colWidths.unit
            };

            // Draw Table Header Background
            doc.rect(30, tableY, 535, 18).fill('#0b2e59');
            
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7.5);
            doc.text('CODIGO', colPositions.codigo + 5, tableY + 5);
            doc.text('CANT', colPositions.cant, tableY + 5, { width: colWidths.cant, align: 'center' });
            doc.text('DESCRIPCION DEL ARTICULO', colPositions.desc + 5, tableY + 5);
            doc.text('P. UNIT.', colPositions.unit, tableY + 5, { width: colWidths.unit - 5, align: 'right' });
            doc.text('IMPORTE', colPositions.imp, tableY + 5, { width: colWidths.imp - 5, align: 'right' });

            // Draw Rows
            let currentY = tableY + 18;
            const productos = Array.isArray(modData.productos) ? modData.productos : [];
            doc.fillColor('#333').font('Helvetica').fontSize(7.5);
            doc.strokeColor('#0b2e59').lineWidth(1);

            productos.forEach((prod: any) => {
                const descText = String(prod.descripcion || '').toUpperCase();
                const descHeight = doc.heightOfString(descText, { width: colWidths.desc - 10 }) + 8;
                const rowHeight = Math.max(descHeight, 18);

                doc.moveTo(30, currentY).lineTo(30, currentY + rowHeight).stroke();
                doc.moveTo(colPositions.cant, currentY).lineTo(colPositions.cant, currentY + rowHeight).stroke();
                doc.moveTo(colPositions.desc, currentY).lineTo(colPositions.desc, currentY + rowHeight).stroke();
                doc.moveTo(colPositions.unit, currentY).lineTo(colPositions.unit, currentY + rowHeight).stroke();
                doc.moveTo(colPositions.imp, currentY).lineTo(colPositions.imp, currentY + rowHeight).stroke();
                doc.moveTo(565, currentY).lineTo(565, currentY + rowHeight).stroke();

                doc.text(String(prod.codigo || '-').toUpperCase(), colPositions.codigo + 5, currentY + 5);
                doc.text(String(prod.cantidad ?? 0), colPositions.cant, currentY + 5, { width: colWidths.cant, align: 'center' });
                doc.text(descText, colPositions.desc + 5, currentY + 5, { width: colWidths.desc - 10 });
                doc.text(formatMoney(prod.precioUnitario), colPositions.unit, currentY + 5, { width: colWidths.unit - 5, align: 'right' });
                doc.text(formatMoney(prod.importe), colPositions.imp, currentY + 5, { width: colWidths.imp - 5, align: 'right' });

                currentY += rowHeight;
            });

            // Draw bottom border of table
            doc.moveTo(30, currentY).lineTo(565, currentY).stroke();

            // Table Footer (Conditions & Totals)
            const footerHeight = 65;
            doc.rect(30, currentY, 535, footerHeight).stroke();
            doc.moveTo(380, currentY).lineTo(380, currentY + footerHeight).stroke();

            let condY = currentY + 8;
            const drawCondRow = (label: string, value: string, y: number) => {
                doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5).text(label, 40, y);
                doc.fillColor('#333').font('Helvetica').text(String(value || '-').toUpperCase(), 140, y);
            };

            drawCondRow('Forma de Pago', modData.formaPago || '-', condY);
            drawCondRow('Plazo de Entrega', modData.plazoEntrega || '-', condY + 15);
            drawCondRow('Validez de Cotización', modData.validezCotizacion, condY + 30);

            // Total
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(9).text('TOTAL', 390, currentY + 15);
            doc.fontSize(12).fillColor('#0b2e59').text(`S/ ${formatMoney(modData.totalImporte || 0)}`, 390, currentY + 30, { width: 165, align: 'right' });

            currentY += footerHeight + 15;

            // --- COMMENT / OBSERVATION BOX ---
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(8.5).text('Comentario', 30, currentY);
            currentY += 12;

            const obsContent = String(modData.observacion).toUpperCase();
            const obsHeight = doc.heightOfString(obsContent, { width: 515 }) + 14;
            
            doc.rect(30, currentY, 535, obsHeight).fill('#fef08a');
            doc.rect(30, currentY, 535, obsHeight).strokeColor('#0b2e59').stroke();
            doc.fillColor('#b45309').font('Helvetica-Bold').fontSize(7.5).text(obsContent, 40, currentY + 7, { width: 515, lineGap: 2 });
            currentY += obsHeight + 15;

            // --- BANK ACCOUNTS BOX ---
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(8.5).text('Cuentas corrientes', 30, currentY);
            currentY += 12;

            const bankBoxHeight = 45;
            doc.rect(30, currentY, 535, bankBoxHeight).strokeColor('#0b2e59').stroke();
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5);
            doc.text('CUENTA CORRIENTE EN SOLES - FRENOS EMBRAGUES JUAN PABLO E.I.R.L.', 40, currentY + 8);
            doc.font('Helvetica').fillColor('#333');
            doc.text('BBVA: Nº: 00110320100027799        CCI: 00110322540100027799', 40, currentY + 20);
            doc.text('BCP: Nº: 1912170110002              CCI: 00219100217011000252', 40, currentY + 30);

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// 3. Generate 80mm Narrow Boleta Ticket PDF
export function generarBoletaPdfKit(data: any): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        try {
            // width: 80mm = ~226.77 points. Margins: 10 points
            // We use dynamic page height by default, but let's pre-calculate height based on items.
            const items = Array.isArray(data.items) ? data.items : [];
            const headerHeight = 160;
            const itemsHeight = items.length * 20;
            const footerHeight = 120;
            const totalHeight = Math.max(300, headerHeight + itemsHeight + footerHeight);

            const doc = new PDFDocument({
                size: [226.77, totalHeight],
                margin: 10
            });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', (err) => reject(err));

            const logo = getLogoPath();
            
            // Logo centered at top
            if (logo) {
                doc.image(logo, 83.38, 10, { width: 60 });
            }

            // Company Title and Details
            doc.fillColor('#0b2e59').font('Helvetica-Bold').fontSize(7.5);
            doc.text('FRENOS EMBRAGUES "JUAN PABLO"', 10, 50, { width: 206.77, align: 'center' });
            
            doc.font('Helvetica').fontSize(5.5).fillColor('#333');
            doc.text('ESPECIALIDAD EN ENSAMBLAJE AIRE E HIDRÁULICO', 10, 60, { width: 206.77, align: 'center' });
            doc.text('Av. Los Ciruelos N° 327 - S.J.L.', 10, 68, { width: 206.77, align: 'center' });
            doc.text(`R.U.C. ${data.empresaRuc || '20554702270'}`, 10, 76, { width: 206.77, align: 'center' });
            
            // Document Type Banner
            doc.rect(10, 85, 206.77, 12).fill('#da3a3a');
            doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);
            doc.text(String(data.docTitle || 'BOLETA DE VENTA').toUpperCase(), 10, 88, { width: 206.77, align: 'center' });

            // Document details
            doc.fillColor('#da3a3a').font('Helvetica-Bold').fontSize(7.5);
            doc.text(`Nº ${data.txnNumero}`, 10, 100, { width: 206.77, align: 'center' });

            // Metadata info
            doc.fillColor('#333').font('Helvetica').fontSize(6);
            let metaY = 112;
            const drawLine = (label: string, val: string, y: number) => {
                doc.font('Helvetica-Bold').text(label, 10, y);
                doc.font('Helvetica').text(String(val || '-').toUpperCase(), 60, y, { width: 156.77 });
            };

            drawLine('Fecha/Hora', `${data.fecha} ${data.hora}`, metaY);
            drawLine('Cliente', data.clienteNombre, metaY + 8);
            if (data.clienteDoc) {
                drawLine('Doc. Ident.', data.clienteDoc, metaY + 16);
                metaY += 8;
            }
            drawLine('Med. Pago', data.metodoPago, metaY + 16);

            // Divider line
            doc.moveTo(10, metaY + 26).lineTo(216.77, metaY + 26).strokeColor('#ccc').lineWidth(0.5).stroke();

            // Table headers
            let tableY = metaY + 30;
            doc.font('Helvetica-Bold').fontSize(6).fillColor('#0b2e59');
            doc.text('CANT', 10, tableY);
            doc.text('DESCRIPCION', 35, tableY);
            doc.text('TOTAL', 185, tableY, { width: 31, align: 'right' });

            // Divider line
            doc.moveTo(10, tableY + 8).lineTo(216.77, tableY + 8).strokeColor('#ccc').stroke();

            let currentY = tableY + 11;
            doc.font('Helvetica').fontSize(5.5).fillColor('#333');
            
            items.forEach((item: any) => {
                const descText = String(item.descripcion || item.nombre).toUpperCase();
                const descHeight = doc.heightOfString(descText, { width: 145 });
                const rowHeight = Math.max(descHeight, 10);

                doc.text(String(item.cantidad), 10, currentY);
                doc.text(descText, 35, currentY, { width: 145 });
                doc.text(formatMoney(item.totalPrice), 180, currentY, { width: 36, align: 'right' });

                currentY += rowHeight + 3;
            });

            // Divider line
            doc.moveTo(10, currentY + 2).lineTo(216.77, currentY + 2).strokeColor('#ccc').stroke();

            // Totals
            let totalY = currentY + 6;
            const drawTotalRow = (label: string, val: string, y: number, bold = false) => {
                doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6).fillColor('#333');
                doc.text(label, 110, y);
                doc.text(val, 170, y, { width: 46, align: 'right' });
            };

            drawTotalRow('Subtotal S/', formatMoney(data.subtotal), totalY);
            drawTotalRow('I.G.V. (18%) S/', formatMoney(data.igv), totalY + 8);
            drawTotalRow('TOTAL S/', formatMoney(data.totalMonto), totalY + 16, true);

            // Amount in letters
            doc.font('Helvetica-Bold').fontSize(5.5).fillColor('#0b2e59');
            doc.text(String(data.totalLetras).toUpperCase(), 10, totalY + 28, { width: 206.77 });

            doc.font('Helvetica').fontSize(5.5).fillColor('#666');
            doc.text('¡Gracias por su preferencia!', 10, totalY + 45, { width: 206.77, align: 'center' });

            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}
