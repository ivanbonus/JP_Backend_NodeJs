import { Request, Response } from 'express';
import { prisma } from '../prisma';
import path from 'path';
import fs from 'fs';
import { generarBoletaPdfKit } from '../utils/pdfKitGenerator';

// Obtener todas las transacciones (historial)
export const getTransacciones = async (req: Request, res: Response) => {
  try {
    const transacciones = await prisma.transaccion.findMany({
      orderBy: { id: 'desc' },
      include: { cliente: true, numeroGuia: true }
    });
    res.json(transacciones);
  } catch (error) {
    console.error('Error al obtener transacciones:', error);
    res.status(500).json({ error: 'Error del servidor al obtener transacciones' });
  }
};

export const createTransaccion = async (req: Request, res: Response) => {
  try {
    const { numero, tipo, monto, metodoPago, concepto, categoria, fecha, hora, estado, nota, clienteNombre, numeroGuiaId } = req.body;

    // Validación básica
    if (!numero || !tipo || !monto || !concepto || !metodoPago) {
      res.status(400).json({ error: 'Faltan campos obligatorios para registrar la transacción' });
      return;
    }

    const nuevaTxn = await prisma.transaccion.create({
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
  } catch (error) {
    console.error('Error al crear transacción:', error);
    res.status(500).json({ error: 'Error del servidor al registrar transacción' });
  }
};

// Anular una transacción
export const anularTransaccion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verificar si existe antes de actualizar
    const txn = await prisma.transaccion.findUnique({ where: { id: Number(id) } });
    if (!txn) {
      res.status(404).json({ error: 'Transacción no encontrada' });
      return;
    }

    const updatedTxn = await prisma.transaccion.update({
      where: { id: Number(id) },
      data: { estado: 'ANULADO' }
    });

    res.json(updatedTxn);
  } catch (error) {
    console.error('Error al anular transacción:', error);
    res.status(500).json({ error: 'Error del servidor al anular transacción' });
  }
};

// Actualizar una transacción (ej: pasar de PENDIENTE a COMPLETADO, cambiar metodo o monto final)
export const updateTransaccion = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado, metodoPago, monto, nota } = req.body;

    // Verificar si existe
    const txn = await prisma.transaccion.findUnique({ where: { id: Number(id) } });
    if (!txn) {
      res.status(404).json({ error: 'Transacción no encontrada' });
      return;
    }

    // Actualizar campos si son proporcionados
    const dataToUpdate: any = {};
    if (estado !== undefined) dataToUpdate.estado = estado;
    if (metodoPago !== undefined) dataToUpdate.metodoPago = metodoPago;
    if (monto !== undefined) dataToUpdate.monto = Number(monto);
    if (nota !== undefined) dataToUpdate.nota = nota;

    // Si pasa a COMPLETADO hoy y no tiene fecha actual, se le asigna la fecha de cobro actual opcionalmente.
    // De momento mantendremos la fecha original, o actualizamos si es negocio.
    // Es mejor actualizar la fecha de cobro a la fecha actual para que suba a caja de hoy.
    if (estado === 'COMPLETADO' && txn.estado === 'PENDIENTE') {
      const ahora = new Date();
      dataToUpdate.fecha = ahora.toLocaleDateString('en-GB'); // DD/MM/YYYY
      dataToUpdate.hora = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    }

    const updatedTxn = await prisma.transaccion.update({
      where: { id: Number(id) },
      data: dataToUpdate
    });

    res.json(updatedTxn);
  } catch (error) {
    console.error('Error al actualizar transacción:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar transacción' });
  }
};

// ========================
// CIERRE DE CAJA
// ========================

export const getCierresCaja = async (req: Request, res: Response) => {
  try {
    const cierres = await prisma.cierreCaja.findMany({
      orderBy: { id: 'desc' },
      include: { transacciones: true }
    });
    res.json(cierres);
  } catch (error) {
    console.error('Error al obtener cierres de caja:', error);
    res.status(500).json({ error: 'Error del servidor al obtener cierres de caja' });
  }
};

export const createCierreCaja = async (req: Request, res: Response) => {
  try {
    const { turno, montoInicial, efectivoCaja, totalEfectivo, totalTarjeta, totalTransferencia, totalYape, totalGeneral, diferencia, cerradoPor, observaciones } = req.body;

    const nuevoCierre = await prisma.cierreCaja.create({
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
    await prisma.transaccion.updateMany({
      where: {
        fecha: hoy,
        estado: 'COMPLETADO',
        cierreCajaId: null
      },
      data: { cierreCajaId: nuevoCierre.id }
    });

    res.status(201).json(nuevoCierre);
  } catch (error) {
    console.error('Error al crear cierre de caja:', error);
    res.status(500).json({ error: 'Error del servidor al registrar cierre de caja' });
  }
};

// ========================
// GENERACIÓN DE BOLETA PDF
// ========================

export const generarBoletaPdf = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 1. Obtener la transacción de la BD
    const txn = await prisma.transaccion.findUnique({
      where: { id: parseInt(id as string) },
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

    // 2. Obtener la lista de items
    let items: Array<{ cantidad: number, descripcion: string, totalPrice: number }> = [];
    if (txn.numeroGuia && txn.numeroGuia.detalles.length > 0) {
      items = txn.numeroGuia.detalles.map((det: any) => ({
        cantidad: det.cantidad,
        descripcion: det.descripcion,
        totalPrice: det.cantidad * det.precioUnit
      }));
    } else if (txn.nota && txn.nota.includes('DETALLES:[')) {
      try {
        const jsonPart = txn.nota.split('DETALLES:')[1];
        const parsedItems = JSON.parse(jsonPart);
        items = parsedItems.map((p: any) => ({
          cantidad: p.cantidad,
          descripcion: p.nombre,
          totalPrice: p.cantidad * p.precio
        }));
      } catch (e) {
        items = [{ cantidad: 1, descripcion: txn.concepto, totalPrice: txn.monto }];
      }
    } else {
      items = [{ cantidad: 1, descripcion: txn.concepto, totalPrice: txn.monto }];
    }

    // 3. Variables de cálculo
    const subtotal = txn.monto / 1.18;
    const igv = txn.monto - subtotal;
    const totalLetras = montoALetras(txn.monto);
    const docTitle = txn.categoria === 'Venta Online' ? 'COMPROBANTE DE PEDIDO / PROFORMA' : 'BOLETA DE VENTA';
    const clienteNombre = txn.clienteNombre || (txn.cliente ? `${txn.cliente.nombre} ${txn.cliente.apellidos || ''}` : 'CLIENTE MOSTRADOR');

    // 4. Generar el PDF mediante PDFKit
    const pdfBuffer = await generarBoletaPdfKit({
      items,
      empresaRuc: '20554702270',
      docTitle,
      txnNumero: txn.numero,
      fecha: txn.fecha,
      hora: txn.hora,
      clienteNombre,
      clienteDoc: txn.cliente?.documento || '',
      metodoPago: txn.metodoPago,
      subtotal,
      igv,
      totalMonto: txn.monto,
      totalLetras
    });

    // 5. Enviar el PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="boleta_${txn.numero}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error al generar boleta PDF:', error);
    res.status(500).json({ error: 'No se pudo generar el PDF de la boleta.' });
  }
};

// ========================
// HELPERS
// ========================

function montoALetras(monto: number): string {
  const unidades = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE'];
  const decenas = ['DIEZ', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
  const especiales = ['ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE'];
  const centenas = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

  const convertir = (n: number): string => {
    if (n === 0) return 'CERO';
    if (n === 100) return 'CIEN';
    
    let res = '';
    
    // Centenas
    if (n >= 100) {
      res += centenas[Math.floor(n / 100)] + ' ';
      n %= 100;
    }
    
    // Decenas
    if (n >= 10 && n <= 19) {
      if (n === 10) res += 'DIEZ';
      else res += especiales[n - 11];
      n = 0;
    } else if (n >= 20) {
      const d = Math.floor(n / 10);
      res += decenas[d - 1];
      n %= 10;
      if (n > 0) {
        if (d === 2) { // Venti...
           res = 'VEINTI' + unidades[n];
           n = 0;
        } else {
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
        } else {
            resultado += convertir(restoMillon);
        }
     }
  } else if (parteEntera >= 1000) {
    const miles = Math.floor(parteEntera / 1000);
    const resto = parteEntera % 1000;
    resultado += (miles === 1 ? 'MIL' : convertir(miles) + ' MIL') + ' ';
    resultado += resto > 0 ? convertir(resto) : '';
  } else {
    resultado = convertir(parteEntera);
  }
  
  const centavos = parteDecimal.toString().padStart(2, '0');
  return `SON: ${resultado.trim()} CON ${centavos}/100 SOLES`;
}
