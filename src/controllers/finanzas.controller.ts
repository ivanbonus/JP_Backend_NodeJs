import { Request, Response } from 'express';
import { prisma } from '../prisma';
import path from 'path';
import fs from 'fs';
import { generarBoletaPdfKit } from '../utils/pdfKitGenerator';
import { hoyLima, horaLima, normalizarFecha, variantesFecha } from '../utils/fechas';
import { esSaldoInicial, normalizarMetodoPago, prefijoNumero, siguienteCorrelativo } from '../utils/caja';
import { ErrorCobro, devolverStockPedidoWeb, registrarEnBanco, responderErrorCobro, totalPagado } from './cobros.controller';

// Obtener todas las transacciones (historial)
export const getTransacciones = async (req: Request, res: Response) => {
  try {
    const transacciones = await prisma.transaccion.findMany({
      orderBy: { id: 'desc' },
      include: {
        cliente: true,
        numeroGuia: true,
        // Para mostrar si el cobro ya figura en Control Bancario
        movimientosBancarios: { where: { estado: { not: 'ANULADO' } }, select: { id: true, codigo: true, estado: true } },
      }
    });
    res.json(transacciones);
  } catch (error) {
    console.error('Error al obtener transacciones:', error);
    res.status(500).json({ error: 'Error del servidor al obtener transacciones' });
  }
};

// ¿Error de Prisma por valor único repetido (numero @unique)?
const esColisionUnica = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';

/**
 * Registra el saldo/fondo inicial del día. Hay uno por día (numero SALDO-DDMMYYYY):
 * si ya existe, se actualiza en lugar de fallar por numero @unique.
 */
const guardarSaldoInicial = async (datos: { monto: number; fecha?: string; hora?: string; nota?: string; clienteNombre?: string; categoria?: string }) => {
  const fecha = normalizarFecha(datos.fecha) || hoyLima();
  const numero = `SALDO-${fecha.replace(/\//g, '')}`;
  const cambios = {
    monto: datos.monto,
    hora: datos.hora || horaLima(),
    estado: 'COMPLETADO',
    metodoPago: 'Efectivo',
    ...(datos.nota !== undefined ? { nota: datos.nota } : {}),
  };

  for (let intento = 0; intento < 3; intento++) {
    const existente = await prisma.transaccion.findUnique({ where: { numero } });
    if (existente) {
      return { creado: false, registro: await prisma.transaccion.update({ where: { numero }, data: cambios }) };
    }
    try {
      const registro = await prisma.transaccion.create({
        data: {
          ...cambios,
          numero,
          tipo: 'INGRESO', // se mantiene por compatibilidad con registros antiguos; los cálculos lo excluyen por su numero
          concepto: 'Saldo Inicial de Apertura',
          categoria: datos.categoria || 'Saldo Inicial',
          fecha,
          clienteNombre: datos.clienteNombre || 'Apertura de Caja',
        },
      });
      return { creado: true, registro };
    } catch (error) {
      if (!esColisionUnica(error)) throw error; // otro proceso lo creó a la vez: se actualiza en el siguiente intento
    }
  }
  throw new Error('No se pudo registrar el saldo inicial');
};

export const createTransaccion = async (req: Request, res: Response) => {
  try {
    const { numero, tipo, monto, metodoPago, concepto, categoria, fecha, hora, estado, nota, clienteNombre, numeroGuiaId, banco } = req.body;

    // Validación básica (el número ya no es obligatorio: lo asigna el servidor)
    if (!tipo || !monto || !concepto || !metodoPago) {
      res.status(400).json({ error: 'Faltan campos obligatorios para registrar la transacción' });
      return;
    }
    const montoNum = Number(monto);
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      res.status(400).json({ error: 'El monto debe ser un número mayor a 0' });
      return;
    }

    // PARCIAL y POR_VERIFICAR solo los asignan los cobros y la tienda web
    const estadoInicial = estado === 'PENDIENTE' || estado === 'ANULADO' ? estado : 'COMPLETADO';
    const conBanco = !!banco?.cuentaId;
    if (conBanco && estadoInicial !== 'COMPLETADO') {
      res.status(400).json({ error: 'Solo una operación ya cobrada o pagada se registra en el banco.' });
      return;
    }

    // Saldo inicial: uno por día, se actualiza si ya existe
    if (esSaldoInicial({ numero, categoria })) {
      const { creado, registro } = await guardarSaldoInicial({ monto: montoNum, fecha, hora, nota, clienteNombre, categoria });
      res.status(creado ? 201 : 200).json(registro);
      return;
    }

    // Número: se respeta el sugerido si está libre; si falta o ya existe, se asigna el siguiente del mismo prefijo
    const prefijo = prefijoNumero(numero, tipo);
    const siguiente = async () => {
      const existentes = await prisma.transaccion.findMany({
        where: { numero: { startsWith: `${prefijo}-` } },
        select: { numero: true },
      });
      return siguienteCorrelativo(prefijo, existentes.map(e => e.numero));
    };
    let candidato = typeof numero === 'string' && numero.trim() ? numero.trim() : await siguiente();

    for (let intento = 0; intento < 8; intento++) {
      try {
        const nuevaTxn = await prisma.$transaction(async tx => {
          const creada = await tx.transaccion.create({
            data: {
              numero: candidato,
              tipo,
              monto: montoNum,
              metodoPago,
              concepto,
              categoria: categoria || 'Otros',
              fecha: normalizarFecha(fecha) || hoyLima(),
              hora: hora || horaLima(),
              estado: estadoInicial,
              nota,
              clienteNombre,
              numeroGuiaId: numeroGuiaId ? Number(numeroGuiaId) : null
            }
          });
          // Cobro o pago por transferencia/Yape/tarjeta: también queda en Control Bancario, enlazado
          const movimientoBancario = conBanco
            ? await registrarEnBanco(tx, req, {
                transaccion: creada, monto: montoNum, metodo: normalizarMetodoPago(metodoPago),
                concepto: `${concepto} (${creada.numero})`.slice(0, 200),
              }, banco)
            : null;
          return { ...creada, movimientoBancario };
        });
        res.status(201).json(nuevaTxn);
        return;
      } catch (error) {
        // Solo un número de transacción repetido se reintenta; lo demás (validación del banco, n.º de operación repetido) se responde
        const colisionNumero = esColisionUnica(error) && String((error as any)?.meta?.target ?? '').includes('numero');
        if (!colisionNumero) return void responderErrorCobro(res, error, 'crear transacción');
        candidato = await siguiente(); // otro registro tomó ese número: se recalcula y se reintenta
      }
    }
    res.status(409).json({ error: 'No se pudo asignar un número de transacción, intente nuevamente' });
  } catch (error) {
    console.error('Error al crear transacción:', error);
    res.status(500).json({ error: 'Error del servidor al registrar transacción' });
  }
};

// Anular una transacción (con las reglas de pagos en partes y pedidos web)
const anularInterno = async (id: number, motivo: string | null) => {
  return prisma.$transaction(async tx => {
    const txn = await tx.transaccion.findUnique({ where: { id } });
    if (!txn) throw new ErrorCobro('Transacción no encontrada', 404);
    if (txn.estado === 'ANULADO') return { transaccion: txn, avisos: [] as string[] };

    const pagosActivos = await tx.transaccion.count({ where: { ventaId: id, estado: 'COMPLETADO' } });
    if (pagosActivos) throw new ErrorCobro(`La venta tiene ${pagosActivos} pago(s) registrados: anúlalos primero.`, 409);

    const avisos: string[] = [];
    // Un pedido web anulado antes de confirmarse devuelve el stock reservado
    if (txn.estado === 'POR_VERIFICAR') await devolverStockPedidoWeb(tx, txn.numero);

    const anulada = await tx.transaccion.update({
      where: { id },
      data: { estado: 'ANULADO', ...(motivo ? { motivoAnulacion: motivo } : {}) },
    });

    // Si era un pago de una venta, se recalcula el estado de la venta
    if (txn.ventaId) {
      const venta = await tx.transaccion.findUnique({ where: { id: txn.ventaId } });
      if (venta && venta.estado !== 'ANULADO') {
        const pagado = await totalPagado(tx, venta.id);
        await tx.transaccion.update({
          where: { id: venta.id },
          data: pagado <= 0.005
            ? { estado: 'PENDIENTE', pagoEnPartes: false }
            : { estado: pagado >= venta.monto - 0.005 ? 'COMPLETADO' : 'PARCIAL' },
        });
      }
    }

    const movs = await tx.movimientoBancario.findMany({ where: { transaccionId: id, estado: { not: 'ANULADO' } }, select: { codigo: true } });
    if (movs.length) {
      avisos.push(`Sigue registrado en Control Bancario (${movs.map(m => m.codigo).join(', ')}). Si el dinero no llegó, anúlalo también allí.`);
    }
    return { transaccion: anulada, avisos };
  });
};

export const anularTransaccion = async (req: Request, res: Response) => {
  try {
    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 300) || null : null;
    const { transaccion, avisos } = await anularInterno(Number(req.params.id), motivo);
    res.json({ ...transaccion, avisos });
  } catch (error) {
    responderErrorCobro(res, error, 'anular transacción');
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

    const cambia = (nuevo: unknown, actual: unknown) => nuevo !== undefined && String(nuevo) !== String(actual);

    // Anular tiene sus propias reglas (solo administrador, pagos, stock de pedidos web)
    if (estado === 'ANULADO' && txn.estado !== 'ANULADO') {
      if (req.usuario?.rol !== 'ADMIN') {
        res.status(403).json({ error: 'Solo el administrador puede anular operaciones.' });
        return;
      }
      const { transaccion, avisos } = await anularInterno(txn.id, null);
      res.json({ ...transaccion, avisos });
      return;
    }
    // Un pago (adelanto/abono) no se edita: se anula y se registra de nuevo
    if (txn.ventaId && (cambia(monto, txn.monto) || cambia(estado, txn.estado) || cambia(metodoPago, txn.metodoPago))) {
      res.status(409).json({ error: 'Los pagos registrados no se modifican. Anula el pago y regístralo de nuevo.' });
      return;
    }
    if (txn.estado === 'POR_VERIFICAR' && cambia(estado, txn.estado)) {
      res.status(409).json({ error: 'Es un pedido web: usa «Verificar pago» para confirmarlo o rechazarlo.' });
      return;
    }
    if ((estado === 'PARCIAL' || estado === 'POR_VERIFICAR') && estado !== txn.estado) {
      res.status(400).json({ error: 'Ese estado lo asignan los cobros y la tienda web.' });
      return;
    }

    // Actualizar campos si son proporcionados
    const dataToUpdate: any = {};
    if (estado !== undefined) dataToUpdate.estado = estado;
    if (metodoPago !== undefined) dataToUpdate.metodoPago = metodoPago;
    if (monto !== undefined) dataToUpdate.monto = Number(monto);
    if (nota !== undefined) dataToUpdate.nota = nota;

    // Venta con pagos en partes: el estado lo deciden los pagos; el total no puede quedar por debajo de lo cobrado
    if (txn.pagoEnPartes) {
      if (cambia(estado, txn.estado)) {
        res.status(409).json({ error: 'La venta tiene pagos en partes: registra el cobro del saldo con «Registrar pago».' });
        return;
      }
      delete dataToUpdate.estado;
      delete dataToUpdate.metodoPago;
      if (dataToUpdate.monto !== undefined) {
        const pagado = await totalPagado(prisma, txn.id);
        if (!Number.isFinite(dataToUpdate.monto) || dataToUpdate.monto < pagado - 0.005) {
          res.status(409).json({ error: `El total no puede ser menor a lo ya cobrado (S/ ${pagado.toFixed(2)}).` });
          return;
        }
        dataToUpdate.estado = dataToUpdate.monto <= pagado + 0.005 ? 'COMPLETADO' : 'PARCIAL';
      }
    }

    // Si pasa a COMPLETADO hoy y no tiene fecha actual, se le asigna la fecha de cobro actual opcionalmente.
    // De momento mantendremos la fecha original, o actualizamos si es negocio.
    // Es mejor actualizar la fecha de cobro a la fecha actual para que suba a caja de hoy.
    if (estado === 'COMPLETADO' && txn.estado === 'PENDIENTE') {
      // Fecha y hora de cobro en Lima (no la del servidor, que corre en UTC)
      dataToUpdate.fecha = hoyLima(); // DD/MM/YYYY
      dataToUpdate.hora = horaLima();
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
    const { turno, montoInicial, efectivoCaja, totalEfectivo, totalTarjeta, totalTransferencia, totalYape, totalGeneral, diferencia, cerradoPor, observaciones, efectivoEsperado, totalElectronico } = req.body;

    // Día de caja según la hora de Lima (el servidor corre en UTC)
    const hoy = hoyLima();

    const resultado = await prisma.$transaction(async (tx) => {
      const nuevoCierre = await tx.cierreCaja.create({
        data: {
          montoInicial: Number(montoInicial) || 0,
          montoFinal: Number(efectivoCaja) || 0,
          estado: 'CERRADA',
          fechaCierre: new Date(),
          observaciones: JSON.stringify({
            turno,
            fechaCaja: hoy,
            diferencia: Number(diferencia),
            cerradoPor,
            totalEfectivo: Number(totalEfectivo),
            totalTarjeta: Number(totalTarjeta),
            totalTransferencia: Number(totalTransferencia),
            totalYape: Number(totalYape),
            totalGeneral: Number(totalGeneral),
            ...(efectivoEsperado !== undefined ? { efectivoEsperado: Number(efectivoEsperado) } : {}),
            ...(totalElectronico !== undefined ? { totalElectronico: Number(totalElectronico) } : {}),
            nota: observaciones
          })
        }
      });

      // Vincular SOLO las transacciones cobradas del día (Lima) que aún no pertenecen a otro cierre.
      // Se buscan también las fechas antiguas escritas sin ceros ("1/3/2026").
      const vinculadas = await tx.transaccion.updateMany({
        where: {
          fecha: { in: variantesFecha(hoy) },
          estado: 'COMPLETADO',
          cierreCajaId: null
        },
        data: { cierreCajaId: nuevoCierre.id }
      });
      return { nuevoCierre, vinculadas: vinculadas.count };
    });

    res.status(201).json({ ...resultado.nuevoCierre, transaccionesVinculadas: resultado.vinculadas });
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
