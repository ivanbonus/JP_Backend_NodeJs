// Fase 5 — Recepción de mercadería.
//
// Registrar una factura de compra no mueve el inventario. El stock sube solo cuando se confirma
// la recepción (total o parcial) de sus líneas; cada recepción deja un movimiento de inventario
// con la factura de origen, el costo y quién la registró. Las recepciones no se borran: se revierten
// con un movimiento opuesto, y nunca se recibe más de lo facturado (ni dos veces la misma cantidad).
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { quien } from '../auth/auditoria';
import { costoUnitarioPen, alzasDeCosto } from '../utils/costos';
import { documentoCompleto } from './compras.controller';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export class ErrorRecepcion extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const responderError = (res: Response, error: unknown, contexto: string) => {
    if (error instanceof ErrorRecepcion) return void res.status(error.status).json({ error: error.message });
    console.error(`Error en ${contexto}:`, error);
    res.status(500).json({ error: 'Error del servidor.' });
};

const decimalPositivo = (v: unknown, campo: string): Dec => {
    const t = String(v ?? '').trim().replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,4})?$/.test(t) || new D(t).lte(0)) throw new ErrorRecepcion(`${campo} no es válida (número mayor que cero, hasta 4 decimales).`);
    return new D(t);
};
const texto = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

/**
 * Estado de recepción del comprobante. Cuenta toda línea salvo las marcadas como "no es mercadería"
 * (flete, servicio…): una línea sin producto enlazado sigue pendiente, así nunca se da por recibido
 * un repuesto que no llegó.
 */
export const recalcularRecepcion = async (tx: Tx, documentoId: number) => {
    const doc = await tx.documentoCompra.findUniqueOrThrow({ where: { id: documentoId }, include: { detalles: true } });
    if (doc.estadoRecepcion === 'NO_APLICA') return doc.estadoRecepcion;
    const mercaderia = doc.detalles.filter(d => !d.noInventariable);
    const algo = doc.detalles.some(d => d.cantidadRecibida.gt(0) || d.noInventariable);
    const completo = mercaderia.length > 0
        ? mercaderia.every(d => d.cantidadRecibida.gte(d.cantidad))
        : doc.detalles.length > 0; // todo era flete/servicio: no queda nada por recibir
    const estado = completo ? 'RECIBIDO' : algo ? 'PARCIAL' : 'PENDIENTE';
    if (estado !== doc.estadoRecepcion) await tx.documentoCompra.update({ where: { id: documentoId }, data: { estadoRecepcion: estado } });
    return estado;
};

/** Unidades de inventario aún por recibir de un producto (facturas vigentes) */
export const pendientesDeRecibir = async (productoId: number) => {
    const lineas = await prisma.detalleCompra.findMany({
        where: { productoId, noInventariable: false, documento: { estado: 'ACTIVO', estadoRecepcion: { in: ['PENDIENTE', 'PARCIAL'] } } },
        select: { cantidad: true, cantidadRecibida: true, unidadesPorCantidad: true, documento: { select: { id: true, codigo: true, serie: true, numero: true } } },
    });
    const conPendiente = lineas
        .map(l => ({ documento: l.documento, unidades: l.cantidad.sub(l.cantidadRecibida).mul(l.unidadesPorCantidad) }))
        .filter(l => l.unidades.gt(0));
    return {
        unidades: conPendiente.reduce((s, l) => s.add(l.unidades), new D(0)).toString(),
        documentos: conPendiente.map(l => ({ ...l.documento, unidades: l.unidades.toString() })),
    };
};

// ==========================================
// Recibir mercadería
// ==========================================
export const recibirMercaderia = async (req: Request, res: Response) => {
    try {
        const documentoId = Number(req.params.id);
        const doc = await prisma.documentoCompra.findUnique({ where: { id: documentoId }, include: { detalles: true } });
        if (!doc) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
        if (doc.estado === 'ANULADO') throw new ErrorRecepcion('El comprobante está anulado.');
        if (doc.estadoRecepcion === 'NO_APLICA') throw new ErrorRecepcion('Este comprobante está marcado como servicio: no ingresa mercadería.');

        const entrada = req.body?.lineas;
        if (!Array.isArray(entrada) || !entrada.length || entrada.length > 300) throw new ErrorRecepcion('Indica qué líneas se recibieron.');
        const observacion = texto(req.body?.observacion);

        // Validar todo antes de mover nada
        const vistos = new Set<number>();
        const todas = entrada.map((l: any) => {
            const detalle = doc.detalles.find(d => d.id === Number(l?.detalleId));
            if (!detalle) throw new ErrorRecepcion('Una de las líneas no pertenece a este comprobante.');
            if (vistos.has(detalle.id)) throw new ErrorRecepcion(`La línea ${detalle.orden} está repetida.`);
            vistos.add(detalle.id);
            const fila = `Línea ${detalle.orden} (${detalle.descripcion})`;

            if (l?.noInventariable !== undefined) {
                if (detalle.cantidadRecibida.gt(0)) throw new ErrorRecepcion(`${fila}: ya tiene ingresos al inventario; revierte el ingreso antes de marcarla como no mercadería.`);
                return { detalle, marcar: Boolean(l.noInventariable) } as const;
            }
            if (detalle.noInventariable) throw new ErrorRecepcion(`${fila}: está marcada como "no es mercadería".`);

            const productoId = l?.productoId ? Number(l.productoId) : detalle.productoId;
            if (!productoId) throw new ErrorRecepcion(`${fila}: elige el producto del inventario al que ingresa.`);
            const factor = l?.unidadesPorCantidad !== undefined && l?.unidadesPorCantidad !== ''
                ? decimalPositivo(l.unidadesPorCantidad, `${fila}: las unidades por ${detalle.unidad}`)
                : detalle.unidadesPorCantidad;
            const yaRecibido = detalle.cantidadRecibida.gt(0);
            if (yaRecibido && productoId !== detalle.productoId) throw new ErrorRecepcion(`${fila}: ya tiene ingresos a otro producto; no se puede cambiar.`);
            if (yaRecibido && !factor.eq(detalle.unidadesPorCantidad)) throw new ErrorRecepcion(`${fila}: ya tiene ingresos; no se pueden cambiar las unidades por ${detalle.unidad}.`);

            const cantidad = decimalPositivo(l?.cantidad, `${fila}: la cantidad recibida`);
            const pendiente = detalle.cantidad.sub(detalle.cantidadRecibida);
            if (cantidad.gt(pendiente)) throw new ErrorRecepcion(`${fila}: solo faltan recibir ${pendiente.toString()} ${detalle.unidad}.`);
            const unidades = cantidad.mul(factor);
            if (!unidades.isInteger()) {
                throw new ErrorRecepcion(`${fila}: ${cantidad.toString()} ${detalle.unidad} equivalen a ${unidades.toString()} unidades de inventario; deben ser unidades enteras.`);
            }
            return { detalle, productoId, factor, cantidad, unidades: unidades.toNumber(), cambiaEnlace: !yaRecibido && (productoId !== detalle.productoId || !factor.eq(detalle.unidadesPorCantidad)) };
        });
        const marcas = todas.filter((l): l is { detalle: typeof doc.detalles[number]; marcar: boolean } => 'marcar' in l);
        const lineas = todas.filter((l): l is Exclude<typeof todas[number], { marcar: boolean }> => !('marcar' in l));
        const productos = await prisma.producto.findMany({ where: { id: { in: lineas.map(l => l.productoId) } }, select: { id: true } });
        if (productos.length !== new Set(lineas.map(l => l.productoId)).size) throw new ErrorRecepcion('Uno de los productos del inventario no existe.');

        const responsable = quien(req);
        await prisma.$transaction(async tx => {
            for (const m of marcas) {
                const r = await tx.detalleCompra.updateMany({ where: { id: m.detalle.id, cantidadRecibida: 0 }, data: { noInventariable: m.marcar } });
                if (!r.count) throw new ErrorRecepcion(`Línea ${m.detalle.orden}: otra persona registró un ingreso al mismo tiempo. Vuelve a abrir el comprobante.`, 409);
            }
            for (const l of lineas) {
                if (l.cambiaEnlace) {
                    // Solo mientras la línea no tenga ingresos (lo vuelve a comprobar la base)
                    const r = await tx.detalleCompra.updateMany({
                        where: { id: l.detalle.id, cantidadRecibida: 0 },
                        data: { productoId: l.productoId, unidadesPorCantidad: l.factor },
                    });
                    if (!r.count) throw new ErrorRecepcion(`Línea ${l.detalle.orden}: otra persona registró un ingreso al mismo tiempo. Vuelve a abrir el comprobante.`, 409);
                }
                // Nunca más de lo facturado, aunque dos personas reciban a la vez
                const ok = await tx.$executeRaw`
                    UPDATE "DetalleCompra" SET "cantidadRecibida" = "cantidadRecibida" + ${l.cantidad}
                    WHERE id = ${l.detalle.id} AND "cantidadRecibida" + ${l.cantidad} <= cantidad`;
                if (!ok) throw new ErrorRecepcion(`Línea ${l.detalle.orden}: la cantidad supera lo que falta recibir (¿se registró al mismo tiempo?).`, 409);

                const producto = await tx.producto.update({ where: { id: l.productoId }, data: { stockActual: { increment: l.unidades } }, select: { stockActual: true } });
                const costo = costoUnitarioPen({ ...l.detalle, unidadesPorCantidad: l.factor, documento: doc });
                await tx.movimientoInventario.create({
                    data: {
                        productoId: l.productoId, tipo: 'ENTRADA', cantidad: l.unidades, motivo: 'RECEPCION_COMPRA',
                        responsable, stockResultante: producto.stockActual, costoUnitario: costo.toDecimalPlaces(4),
                        detalleCompraId: l.detalle.id,
                        observacion: [`${doc.codigo} · ${doc.serie}-${doc.numero}`, observacion].filter(Boolean).join(' · '),
                    },
                });
            }
            await recalcularRecepcion(tx, documentoId);
        });

        const { alzas, umbralAlzaPct } = await alzasDeCosto({ productoIds: lineas.map(l => l.productoId) });
        res.status(201).json({
            documento: await documentoCompleto(documentoId),
            avisos: alzas
                .filter(a => a.documento.id === documentoId)
                .map(a => `El costo de ${a.producto.nombre} subió ${a.variacionPct}% frente a la compra anterior (S/ ${new D(a.anteriorPen).toFixed(2)} → S/ ${new D(a.ultimoPen).toFixed(2)} por unidad, sin IGV). El aviso se activa sobre ${umbralAlzaPct}%.`),
        });
    } catch (e) { responderError(res, e, 'recibir mercadería'); }
};

// ==========================================
// Revertir una recepción (solo administrador)
// ==========================================
export const revertirRecepcion = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.movimientoId);
        const motivo = texto(req.body?.motivo);
        if (!motivo || motivo.length < 5) throw new ErrorRecepcion('Escribe el motivo (mínimo 5 caracteres).');
        const mov = await prisma.movimientoInventario.findUnique({ where: { id }, include: { revertidoPor: true, detalleCompra: true } });
        if (!mov || mov.motivo !== 'RECEPCION_COMPRA' || !mov.detalleCompra) throw new ErrorRecepcion('Ese ingreso no es una recepción de compra.', 404);
        if (mov.revertidoPor) throw new ErrorRecepcion('Ese ingreso ya fue revertido.', 409);
        const detalle = mov.detalleCompra;
        const cantidadFactura = new D(mov.cantidad).div(detalle.unidadesPorCantidad);

        await prisma.$transaction(async tx => {
            // El stock no puede quedar negativo: si ya se usó, corresponde un ajuste, no una reversión
            const r = await tx.producto.updateMany({ where: { id: mov.productoId, stockActual: { gte: mov.cantidad } }, data: { stockActual: { decrement: mov.cantidad } } });
            if (!r.count) throw new ErrorRecepcion('El stock actual es menor que lo recibido (ya se usó parte): registra una salida de ajuste en Inventario.', 409);
            const ok = await tx.$executeRaw`
                UPDATE "DetalleCompra" SET "cantidadRecibida" = "cantidadRecibida" - ${cantidadFactura}
                WHERE id = ${detalle.id} AND "cantidadRecibida" >= ${cantidadFactura}`;
            if (!ok) throw new ErrorRecepcion('La cantidad recibida de la línea cambió; vuelve a abrir el comprobante.', 409);
            const producto = await tx.producto.findUniqueOrThrow({ where: { id: mov.productoId }, select: { stockActual: true } });
            await tx.movimientoInventario.create({
                data: {
                    productoId: mov.productoId, tipo: 'SALIDA', cantidad: mov.cantidad, motivo: 'REVERSION_RECEPCION',
                    responsable: quien(req), stockResultante: producto.stockActual, detalleCompraId: detalle.id,
                    revierteId: mov.id, costoUnitario: mov.costoUnitario, observacion: motivo,
                },
            });
            await recalcularRecepcion(tx, detalle.documentoId);
        });
        res.json({ documento: await documentoCompleto(detalle.documentoId) });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return void res.status(409).json({ error: 'Ese ingreso ya fue revertido.' });
        responderError(res, e, 'revertir recepción');
    }
};
