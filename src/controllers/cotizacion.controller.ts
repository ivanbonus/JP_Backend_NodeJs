import { Request, Response } from 'express';
import { prisma } from '../prisma';
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { enviarCotizacionEmail } from '../utils/email';
import { sendEmail } from '../utils/mailer';

export const createCotizacion = async (req: Request, res: Response) => {
  try {
    const { nombre, email, telefono, vehiculo, servicio, mensaje, placa, documento, atencion, direccion } = req.body;

    if (!nombre || !telefono) {
        console.log(`[Cotizacion] Peticion fallida, faltan datos minimos`);
        res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
        return;
    }

    const nuevaCotizacion = await prisma.cotizacion.create({
      data: {
        nombre,
        email: email || '',
        telefono,
        vehiculo: vehiculo || '',
        placa: placa || '',
        documento: documento || '',
        atencion: atencion || '',
        direccion: direccion || '',
        servicio: servicio || '',
        mensaje: mensaje || '',
      }
    });

    // NOTIFICACIÓN AL ADMIN
    try {
      const config = await prisma.configuracion.findFirst();
      if (config && config.email) {
        await sendEmail({
          to: config.email,
          subject: 'Nueva Solicitud de Cotización Web - Taller JP',
          text: `Se ha recibido una nueva solicitud de cotización de ${nombre}.`,
          html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #4ade80; border-radius: 8px;">
              <h2 style="color: #000; margin-top: 0;">Nueva Cotización Recibida</h2>
              <p>Un cliente ha solicitado una cotización desde la web:</p>
              <ul style="list-style: none; padding: 0;">
                <li><strong>Cliente:</strong> ${nombre}</li>
                <li><strong>Vehículo:</strong> ${vehiculo || 'No especificado'}</li>
                <li><strong>Servicio:</strong> ${servicio || 'No especificado'}</li>
                <li><strong>Teléfono:</strong> ${telefono}</li>
                <li><strong>Email:</strong> ${email || 'No proporcionado'}</li>
                <li><strong>Mensaje:</strong> ${mensaje || 'Sin mensaje'}</li>
              </ul>
              <p>Puedes revisarla y responderla desde el panel de cotizaciones.</p>
            </div>
          `
        });
      }
    } catch (err) {
      console.error('[ADMIN-NOTIFICACION] Error al avisar sobre nueva cotización:', err);
    }

    res.status(201).json(nuevaCotizacion);
  } catch (error) {
    console.error('Error al crear cotización:', error);
    res.status(500).json({ error: 'Error del servidor al enviar cotización.' });
  }
};

export const getCotizaciones = async (req: Request, res: Response) => {
  try {
    const cotizaciones = await prisma.cotizacion.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(cotizaciones);
  } catch (error) {
    console.error('Error al obtener cotizaciones:', error);
    res.status(500).json({ error: 'Error al cargar las cotizaciones.' });
  }
};

export const updateCotizacionStatus = async (req: Request, res: Response) => {
  try {
      const { id } = req.params;
      const { estado } = req.body;

      if (!estado) {
          res.status(400).json({ error: 'Falta proveer el nuevo estado.' });
          return;
      }

      const updated = await prisma.cotizacion.update({
          where: { id: parseInt(id as string) },
          data: { estado }
      });

      res.json(updated);
  } catch (error) {
      console.error('Error al actualizar estado:', error);
      res.status(500).json({ error: 'No se pudo actualizar la cotización.' });
  }
};

export const generarCotizacionPdf = async (req: Request, res: Response) => {
  try {
    const data = req.body; // Recibe los datos del frontend para llenar la cotización

    // 1. Leer la plantilla HTML
    const templatePath = path.join(__dirname, '../templates/cotizacionTemplate.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    // 2. Cargar el logo como Base64 para que el PDF lo renderice correctamente
    const logoPath = path.join(__dirname, '../assets/images/logo-jp.png');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
      const bitmap = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
    }

    // 3. Generar las filas de productos en HTML
    let filasProductos = '';
    if (data.productos && Array.isArray(data.productos)) {
      data.productos.forEach((prod: any, index: number) => {
        const isLastRow = index === data.productos.length - 1;
        const rowClass = isLastRow ? 'item-row last-item-row' : 'item-row';
        filasProductos += `
          <tr class="${rowClass}">
              <td>${prod.codigo || ''}</td>
              <td class="center">${prod.cantidad || '1'}</td>
              <td>${prod.descripcion || ''}</td>
              <td class="right">${Number(prod.precioUnitario || 0).toFixed(2)}</td>
              <td class="right">${Number(prod.importe || 0).toFixed(2)}</td>
          </tr>
        `;
      });
    }

    // Si no hay productos, poner una fila vacía
    if (!filasProductos) {
        filasProductos = `
          <tr class="item-row last-item-row">
              <td colspan="5" class="center">Sin artículos registrados</td>
          </tr>
        `;
    }

    // 4. Reemplazar variables en el HTML
    const replacements: Record<string, string> = {
      '{{logoBase64}}': logoBase64,
      '{{empresaRuc}}': data.empresaRuc || '20554702270', // Ejemplo default
      '{{cotizacionNumero}}': data.cotizacionNumero || '000000-202X',
      '{{clienteNombre}}': data.clienteNombre || '',
      '{{clienteDocumento}}': data.clienteDocumento || '',
      '{{clienteAtencion}}': data.clienteAtencion || '',
      '{{clienteDireccion}}': data.clienteDireccion || '',
      '{{clienteEmail}}': data.clienteEmail || '',
      '{{clienteTelefono}}': data.clienteTelefono || '',
      '{{clienteCelular}}': data.clienteCelular || '',
      '{{fecha}}': data.fecha || new Date().toLocaleDateString('es-PE'),
      '{{vendedorNombre}}': data.vendedorNombre || '',
      '{{moneda}}': data.moneda || 'Soles',
      '{{filasProductos}}': filasProductos,
      '{{formaPago}}': data.formaPago || '',
      '{{plazoEntrega}}': data.plazoEntrega || '',
      '{{validezCotizacion}}': data.validezCotizacion || '',
      '{{observacion}}': data.observacion || '',
      '{{totalImporte}}': Number(data.totalImporte || 0).toFixed(2),
    };

    for (const [key, value] of Object.entries(replacements)) {
      // Reemplaza todas las ocurrencias. Podría usar RegExp para estar absolutamente seguro de que reemplace todas, pero como solo ocurre una vez cada campo sirve así (o usando split/join).
      htmlContent = htmlContent.split(key).join(value);
    }

    // 5. Generar PDF con Puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Importante para servidores
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    // Configuración del PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true, // Para que pinte los colores de fondo
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px'
      }
    });

    await browser.close();


    // 6. Enviar PDF al cliente
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="cotizacion_${data.cotizacionNumero || 'doc'}.pdf"`);
    res.send(Buffer.from(pdfBuffer));

  } catch (error) {
    console.error('Error al generar PDF:', error);
    res.status(500).json({ error: 'No se pudo generar el PDF de la cotización.' });
  }
};
const formatMoney = (val: any) => {
    if (val === '' || val === null || val === undefined) return '';
    const num = Number(val);
    if (isNaN(num)) return '';
    return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const responderCotizacion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { productos, formaPago, plazoEntrega, validezCotizacion, observacion, totalImporte, mostrarPreciosUnitarios = true, mostrarTotal = true } = req.body;

    // 1. Obtener la cotización original de la Base de Datos
    const cotizacionDB = await prisma.cotizacion.findUnique({
      where: { id: parseInt(id as string) }
    });

    if (!cotizacionDB) {
      res.status(404).json({ error: 'Cotización no encontrada.' });
      return;
    }

    const dataParaPdf = {
      ...req.body,
      cotizacionNumero: `W-${String(cotizacionDB.id).padStart(5, '0')}`,
      clienteNombre: req.body.clienteNombre || cotizacionDB.nombre,
      clienteEmail: req.body.clienteEmail || cotizacionDB.email,
      clienteTelefono: req.body.clienteTelefono || cotizacionDB.telefono,
      clienteCelular: req.body.clienteTelefono || cotizacionDB.telefono, 
      clienteDocumento: req.body.clienteDocumento || cotizacionDB.documento,
      clienteAtencion: req.body.clienteAtencion || cotizacionDB.atencion,
      clienteDireccion: req.body.clienteDireccion || cotizacionDB.direccion,
      fecha: new Date().toLocaleDateString('es-PE'),
      moneda: 'Soles'
    };

    // 2. Lógica idéntica de Generación de PDF
    const templatePath = path.join(__dirname, '../templates/cotizacionTemplate.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    const logoPath = path.join(__dirname, '../assets/images/logo-jp.png');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
      const bitmap = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
    }

    let filasProductos = '';
    if (productos && Array.isArray(productos)) {
      productos.forEach((prod: any, index: number) => {
        const isLastRow = index === productos.length - 1;
        const rowClass = isLastRow ? 'item-row last-item-row' : 'item-row';
        const pUnit = formatMoney(prod.precioUnitario);
        const pImporte = formatMoney(prod.importe);
        filasProductos += `
          <tr class="${rowClass}">
              <td>${prod.codigo || ''}</td>
              <td class="center">${prod.cantidad || '1'}</td>
              <td>${prod.descripcion || ''}</td>
              ${mostrarPreciosUnitarios ? `<td class="right">${pUnit}</td><td class="right">${pImporte}</td>` : ''}
          </tr>
        `;
      });
    }

    if (!filasProductos) {
        filasProductos = `
          <tr class="item-row last-item-row">
              <td colspan="${mostrarPreciosUnitarios ? 5 : 3}" class="center">Sin artículos registrados</td>
          </tr>
        `;
    }

    const headersProductos = mostrarPreciosUnitarios 
        ? `<tr>
            <th>CODIGO</th>
            <th class="center" style="width: 60px;">CANT</th>
            <th>DESCRIPCION DEL ARTICULO</th>
            <th class="right" style="width: 80px;">P. UNIT.</th>
            <th class="right" style="width: 80px;">IMPORTE</th>
           </tr>`
        : `<tr>
            <th style="width: 25%;">CODIGO</th>
            <th class="center" style="width: 15%;">CANT</th>
            <th>DESCRIPCION DEL ARTICULO</th>
           </tr>`;

    const totalSeccion = mostrarTotal
        ? `<div class="totals">
            <div class="total-label">TOTAL</div>
            <div class="total-value" style="font-weight: bold;">S/ ${formatMoney(totalImporte || 0)}</div>
           </div>`
        : '';

    const replacements: Record<string, string> = {
      '{{logoBase64}}': logoBase64,
      '{{empresaRuc}}': dataParaPdf.empresaRuc || '20554702270',
      '{{cotizacionNumero}}': dataParaPdf.cotizacionNumero,
      '{{clienteNombre}}': dataParaPdf.clienteNombre,
      '{{clienteDocumento}}': dataParaPdf.clienteDocumento || '',
      '{{clienteAtencion}}': dataParaPdf.clienteAtencion || '',
      '{{clienteDireccion}}': dataParaPdf.clienteDireccion || '',
      '{{clienteEmail}}': dataParaPdf.clienteEmail,
      '{{clienteTelefono}}': dataParaPdf.clienteTelefono,
      '{{clienteCelular}}': dataParaPdf.clienteCelular,
      '{{fecha}}': dataParaPdf.fecha,
      '{{vendedorNombre}}': dataParaPdf.vendedorNombre || 'Atención Web',
      '{{moneda}}': dataParaPdf.moneda,
      '{{filasProductos}}': filasProductos,
      '{{formaPago}}': formaPago || 'Contado',
      '{{plazoEntrega}}': plazoEntrega || 'Inmediato',
      '{{validezCotizacion}}': validezCotizacion || '',
      '{{observacion}}': observacion || '',
      '{{totalImporte}}': formatMoney(totalImporte || 0),
    };

    for (const [key, value] of Object.entries(replacements)) {
      htmlContent = htmlContent.split(key).join(value);
    }

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    await browser.close();

    // 3. Enviar Correo con Adjunto
    const bodyHtml = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <h2>Hola, ${cotizacionDB.nombre}.</h2>
        <p>Gracias por contactarte con <strong>Frenos y Embragues Juan Pablo</strong>.</p>
        <p>Adjuntamos a este correo la cotización formal respondiendo a tu solicitud.</p>
        <br>
        <p>Quedamos a la espera de sus comentarios.</p>
        <p>Atentamente,<br><strong>Equipo de Ventas</strong></p>
      </div>
    `;

    try {
        await enviarCotizacionEmail(
            cotizacionDB.email,
            `Cotización de Servicios / Productos - Frenos JP`,
            bodyHtml,
            Buffer.from(pdfBuffer),
            `Cotizacion_${dataParaPdf.cotizacionNumero}.pdf`
        );
    } catch (e) {
        console.warn("Fallo el envío de correo. Posiblemente no existan credenciales en el .env. Detalle:", e);
        // Podríamos retornar un error, o dejar que la cotización se cree pero avisando que el correo no salió
        // Dejaremos que arroje el error para que el frontend lo detecte.
        res.status(500).json({ error: 'PDF generado pero falló el envío por correo. Verifica credenciales EMAIL_USER.' });
        return;
    }

    // 4. Actualizar Estado en Base de Datos
    const updated = await prisma.cotizacion.update({
        where: { id: parseInt(id as string) },
        data: { 
            estado: 'ATENDIDO',
            datosCotizacion: req.body,
            nombre: req.body.clienteNombre || cotizacionDB.nombre,
            email: req.body.clienteEmail || cotizacionDB.email,
            vehiculo: req.body.clienteVehiculo || cotizacionDB.vehiculo,
            servicio: req.body.clienteServicio || cotizacionDB.servicio,
            mensaje: req.body.clienteMensaje || cotizacionDB.mensaje,
        }
    });

    res.json({ message: 'Cotización generada y enviada correctamente.', cotizacion: updated });
  } catch (error) {
    console.error('Error al responder cotización:', error);
    res.status(500).json({ error: 'No se pudo generar ni enviar la cotización.' });
  }
};

export const responderYGenerarPdfWhatsapp = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { productos, formaPago, plazoEntrega, validezCotizacion, observacion, totalImporte, mostrarPreciosUnitarios = true, mostrarTotal = true } = req.body;

    const cotizacionDB = await prisma.cotizacion.findUnique({
      where: { id: parseInt(id as string) }
    });

    if (!cotizacionDB) {
      res.status(404).json({ error: 'Cotización no encontrada.' });
      return;
    }

    const dataParaPdf = {
      ...req.body,
      cotizacionNumero: `W-${String(cotizacionDB.id).padStart(5, '0')}`,
      clienteNombre: req.body.clienteNombre || cotizacionDB.nombre,
      clienteEmail: req.body.clienteEmail || cotizacionDB.email,
      clienteTelefono: req.body.clienteTelefono || cotizacionDB.telefono,
      clienteCelular: req.body.clienteTelefono || cotizacionDB.telefono, 
      clienteDocumento: req.body.clienteDocumento || cotizacionDB.documento,
      clienteAtencion: req.body.clienteAtencion || cotizacionDB.atencion,
      clienteDireccion: req.body.clienteDireccion || cotizacionDB.direccion,
      fecha: new Date().toLocaleDateString('es-PE'),
      moneda: 'Soles'
    };

    const templatePath = path.join(__dirname, '../templates/cotizacionTemplate.html');
    let htmlContent = fs.readFileSync(templatePath, 'utf8');

    const logoPath = path.join(__dirname, '../assets/images/logo-jp.png');
    let logoBase64 = '';
    if (fs.existsSync(logoPath)) {
      const bitmap = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${bitmap.toString('base64')}`;
    }

    let filasProductos = '';
    if (productos && Array.isArray(productos)) {
      productos.forEach((prod: any, index: number) => {
        const isLastRow = index === productos.length - 1;
        const rowClass = isLastRow ? 'item-row last-item-row' : 'item-row';
        const pUnit = formatMoney(prod.precioUnitario);
        const pImporte = formatMoney(prod.importe);
        filasProductos += `
          <tr class="${rowClass}">
              <td>${prod.codigo || ''}</td>
              <td class="center">${prod.cantidad || '1'}</td>
              <td>${prod.descripcion || ''}</td>
              ${mostrarPreciosUnitarios ? `<td class="right">${pUnit}</td><td class="right">${pImporte}</td>` : ''}
          </tr>
        `;
      });
    }

    if (!filasProductos) {
        filasProductos = `
          <tr class="item-row last-item-row">
              <td colspan="${mostrarPreciosUnitarios ? 5 : 3}" class="center">Sin artículos registrados</td>
          </tr>
        `;
    }

    const headersProductos = mostrarPreciosUnitarios 
        ? `<tr>
            <th>CODIGO</th>
            <th class="center" style="width: 60px;">CANT</th>
            <th>DESCRIPCION DEL ARTICULO</th>
            <th class="right" style="width: 80px;">P. UNIT.</th>
            <th class="right" style="width: 80px;">IMPORTE</th>
           </tr>`
        : `<tr>
            <th style="width: 25%;">CODIGO</th>
            <th class="center" style="width: 15%;">CANT</th>
            <th>DESCRIPCION DEL ARTICULO</th>
           </tr>`;

    const totalSeccion = mostrarTotal
        ? `<div class="totals">
            <div class="total-label">TOTAL</div>
            <div class="total-value" style="font-weight: bold;">S/ ${formatMoney(totalImporte || 0)}</div>
           </div>`
        : '';

    const replacements: Record<string, string> = {
      '{{logoBase64}}': logoBase64,
      '{{empresaRuc}}': dataParaPdf.empresaRuc || '20554702270',
      '{{cotizacionNumero}}': dataParaPdf.cotizacionNumero,
      '{{clienteNombre}}': dataParaPdf.clienteNombre,
      '{{clienteDocumento}}': dataParaPdf.clienteDocumento || '',
      '{{clienteAtencion}}': dataParaPdf.clienteAtencion || '',
      '{{clienteDireccion}}': dataParaPdf.clienteDireccion || '',
      '{{clienteEmail}}': dataParaPdf.clienteEmail,
      '{{clienteTelefono}}': dataParaPdf.clienteTelefono,
      '{{clienteCelular}}': dataParaPdf.clienteCelular,
      '{{fecha}}': dataParaPdf.fecha,
      '{{vendedorNombre}}': dataParaPdf.vendedorNombre || 'Atención Web',
      '{{moneda}}': dataParaPdf.moneda,
      '{{headersProductos}}': headersProductos,
      '{{filasProductos}}': filasProductos,
      '{{formaPago}}': formaPago || 'Contado',
      '{{plazoEntrega}}': plazoEntrega || 'Inmediato',
      '{{validezCotizacion}}': validezCotizacion || '',
      '{{observacion}}': observacion || '',
      '{{totalSeccion}}': totalSeccion,
    };

    for (const [key, value] of Object.entries(replacements)) {
      htmlContent = htmlContent.split(key).join(value);
    }

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });

    await browser.close();

    // Actualizar Estado en BD a ATENDIDO
    await prisma.cotizacion.update({
        where: { id: parseInt(id as string) },
        data: { 
            estado: 'ATENDIDO',
            datosCotizacion: req.body,
            nombre: req.body.clienteNombre || cotizacionDB.nombre,
            email: req.body.clienteEmail || cotizacionDB.email,
            vehiculo: req.body.clienteVehiculo || cotizacionDB.vehiculo,
            servicio: req.body.clienteServicio || cotizacionDB.servicio,
            mensaje: req.body.clienteMensaje || cotizacionDB.mensaje,
        }
    });

    // Enviar PDF directamente
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Cotizacion_${dataParaPdf.cotizacionNumero}.pdf"`);
    res.send(Buffer.from(pdfBuffer));

  } catch (error) {
    console.error('Error al generar PDF para Whatsapp:', error);
    res.status(500).json({ error: 'No se pudo generar el PDF de la cotización.' });
  }
};
