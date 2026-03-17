import { Request, Response } from 'express';
import { prisma } from '../index';

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
