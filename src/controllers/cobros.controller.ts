// Cobros de ventas (Fase 2C): pagos en partes, verificación de pedidos web y su registro en Control Bancario.
//
// Regla de caja: lo que entra a caja es una transacción INGRESO en estado COMPLETADO, en su fecha y con su método.
// - Venta pagada de una vez: la propia venta pasa a COMPLETADO el día del cobro.
// - Venta pagada en partes: cada pago (adelanto o abono) es una transacción COMPLETADO con ventaId; la venta
//   queda con pagoEnPartes = true y estado PARCIAL o COMPLETADO, y NO se suma como ingreso.
// - Pedido web: queda POR_VERIFICAR (no es ingreso) hasta que el administrador confirma el pago.
// Un cobro por transferencia o Yape puede registrarse a la vez en Control Bancario, enlazado a la transacción:
// el banco lo muestra (y luego se concilia con el extracto) sin volver a sumarlo como ingreso del negocio.
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { quien } from '../auth/auditoria';
import { hoyLima, horaLima } from '../utils/fechas';
import { ETIQUETA_METODO, esSaldoInicial, normalizarMetodoPago, siguienteCorrelativo } from '../utils/caja';
import { registrarMovimiento, ErrorValidacion } from './bancos.controller';

type Tx = Prisma.TransactionClient;

export class ErrorCobro extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const redondear = (n: number) => Math.round((n || 0) * 100) / 100;
const CENTIMO = 0.005;

/** Métodos que pasan por el banco y su equivalente en Control Bancario */
const METODO_BANCO: Record<string, string> = { TRANSFERENCIA: 'TRANSFERENCIA', YAPE_PLIN: 'YAPE', TARJETA: 'TARJETA' };

export const responderErrorCobro = (res: Response, error: unknown, contexto: string) => {
    if (error instanceof ErrorCobro || error instanceof ErrorValidacion) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'Ese n.º de operación ya está registrado en la cuenta bancaria, o el número se repitió. Revisa e intenta de nuevo.' });
        return;
    }
    console.error(`Error en ${contexto}:`, error);
    res.status(500).json({ error: 'Error del servidor.' });
};

const montoValido = (valor: unknown): number => {
    const n = Number(String(valor ?? '').replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) throw new ErrorCobro('El monto debe ser mayor que cero.');
    if (Math.abs(redondear(n) - n) > 1e-9) throw new ErrorCobro('El monto admite hasta 2 decimales.');
    return redondear(n);
};

const metodoValido = (valor: unknown) => {
    const m = normalizarMetodoPago(String(valor || ''));
    if (m === 'OTRO') throw new ErrorCobro('Elige el método de pago: Efectivo, Transferencia, Yape/Plin o Tarjeta.');
    return m;
};

/** Total cobrado mediante pagos en partes (sin anulados) */
export const totalPagado = async (db: Tx | typeof prisma, ventaId: number) => {
    const r = await db.transaccion.aggregate({ where: { ventaId, estado: 'COMPLETADO' }, _sum: { monto: true } });
    return redondear(r._sum.monto ?? 0);
};

const siguienteNumero = async (db: Tx, prefijo: string) => {
    const existentes = await db.transaccion.findMany({ where: { numero: { startsWith: `${prefijo}-` } }, select: { numero: true } });
    return siguienteCorrelativo(prefijo, existentes.map(e => e.numero));
};

/** Reintenta una operación si dos registros tomaron el mismo número a la vez */
const conReintento = async <T>(fn: () => Promise<T>): Promise<T> => {
    for (let intento = 0; ; intento++) {
        try { return await fn(); } catch (e) {
            const colisionNumero = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
                && String((e.meta as any)?.target ?? '').includes('numero');
            if (!colisionNumero || intento >= 4) throw e;
        }
    }
};

/** Categoría en Control Bancario para un egreso del negocio */
const categoriaEgresoBanco = (categoria: string | null | undefined) => {
    const c = (categoria || '').toLowerCase();
    if (c.includes('repuesto')) return 'Compra de repuestos';
    if (c.includes('personal') || c.includes('planilla')) return 'Planilla / personal';
    if (c.includes('servicio')) return 'Servicios (luz, agua, internet)';
    if (c.includes('proveedor')) return 'Pago a proveedor';
    return 'Otros egresos';
};

/**
 * Registra en Control Bancario el cobro (o pago) de una transacción, enlazado a ella.
 * `banco` = { cuentaId, numeroOperacion?, tipoCambio?, monto? (en la moneda de la cuenta), fecha? }
 */
export const registrarEnBanco = async (
    tx: Tx, req: Request,
    datos: { transaccion: { id: number; numero: string; tipo: string; categoria: string; clienteId: number | null; clienteNombre: string | null; numeroGuiaId: number | null }; monto: number; metodo: string; concepto: string; esAdelanto?: boolean },
    banco: any,
) => {
    const metodoBanco = METODO_BANCO[datos.metodo];
    if (!metodoBanco) throw new ErrorCobro('Solo los cobros por transferencia, Yape/Plin o tarjeta se registran en el banco.');
    if (!banco?.cuentaId) throw new ErrorCobro('Elige la cuenta bancaria donde llegó el dinero.');
    const t = datos.transaccion;
    const { creado } = await registrarMovimiento(tx, {
        tipo: t.tipo === 'EGRESO' ? 'EGRESO' : 'INGRESO',
        cuentaId: banco.cuentaId,
        metodo: metodoBanco,
        monto: banco.monto ?? datos.monto.toFixed(2),
        tipoCambio: banco.tipoCambio,
        fecha: banco.fecha,
        numeroOperacion: banco.numeroOperacion,
        concepto: datos.concepto,
        categoria: t.tipo === 'EGRESO' ? categoriaEgresoBanco(t.categoria) : datos.esAdelanto ? 'Adelanto de cliente' : 'Venta / servicio',
        contraparteNombre: t.clienteNombre || undefined,
        clienteId: t.clienteId || undefined,
        numeroGuiaId: t.numeroGuiaId || undefined,
        transaccionId: t.id,
        observaciones: banco.observaciones,
    }, quien(req));
    return creado;
};

const resumenVenta = async (db: Tx | typeof prisma, id: number) => {
    const venta = await db.transaccion.findUnique({
        where: { id },
        include: {
            pagos: { orderBy: { id: 'asc' } },
            movimientosBancarios: { where: { estado: { not: 'ANULADO' } }, select: { id: true, codigo: true, estado: true, monto: true, moneda: true } },
        },
    });
    if (!venta) return null;
    const pagado = venta.pagoEnPartes ? await totalPagado(db, id) : venta.estado === 'COMPLETADO' ? venta.monto : 0;
    return { ...venta, pagado, saldo: redondear(Math.max(0, venta.monto - pagado)) };
};

// ==========================================
// GET /finanzas/transacciones/:id/pagos — la venta con sus pagos y saldo
// ==========================================
export const obtenerPagos = async (req: Request, res: Response) => {
    try {
        const r = await resumenVenta(prisma, Number(req.params.id));
        if (!r) return void res.status(404).json({ error: 'Venta no encontrada.' });
        // Movimientos bancarios de cada pago
        const movs = r.pagos.length
            ? await prisma.movimientoBancario.findMany({
                where: { transaccionId: { in: r.pagos.map(p => p.id) }, estado: { not: 'ANULADO' } },
                select: { id: true, codigo: true, estado: true, transaccionId: true },
            })
            : [];
        res.json({ ...r, pagos: r.pagos.map(p => ({ ...p, movimientosBancarios: movs.filter(m => m.transaccionId === p.id) })) });
    } catch (e) { responderErrorCobro(res, e, 'obtener pagos'); }
};

// ==========================================
// POST /finanzas/transacciones/:id/pagos — registrar un cobro (total, adelanto o abono)
// body: { monto, metodoPago, nota?, banco?: { cuentaId, numeroOperacion?, tipoCambio?, monto?, fecha? } }
// ==========================================
export const registrarPago = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const monto = montoValido(req.body?.monto);
        const metodo = metodoValido(req.body?.metodoPago);
        const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim().slice(0, 500) || null : null;
        const banco = req.body?.banco && req.body.banco.cuentaId ? req.body.banco : null;

        const resultado = await conReintento(() => prisma.$transaction(async tx => {
            const venta = await tx.transaccion.findUnique({ where: { id } });
            if (!venta) throw new ErrorCobro('Venta no encontrada.', 404);
            if (venta.tipo !== 'INGRESO' || esSaldoInicial(venta)) throw new ErrorCobro('Solo se registran cobros de ventas o servicios.');
            if (venta.ventaId) throw new ErrorCobro('Esta transacción ya es un pago de otra venta.');
            if (venta.estado === 'POR_VERIFICAR') throw new ErrorCobro('Es un pedido web: usa «Verificar pago».', 409);
            if (!['PENDIENTE', 'PARCIAL'].includes(venta.estado)) {
                throw new ErrorCobro(venta.estado === 'COMPLETADO' ? 'La venta ya está cobrada por completo.' : 'La venta está anulada.', 409);
            }

            const pagado = await totalPagado(tx, id);
            const saldo = redondear(venta.monto - pagado);
            if (monto > saldo + CENTIMO) throw new ErrorCobro(`El pago (S/ ${monto.toFixed(2)}) supera el saldo pendiente (S/ ${saldo.toFixed(2)}).`);

            const fecha = hoyLima();
            const hora = horaLima();
            const etiqueta = ETIQUETA_METODO[metodo];
            let pago;
            let esAdelanto = false;

            if (!venta.pagoEnPartes && pagado === 0 && Math.abs(monto - venta.monto) < CENTIMO) {
                // Pago completo de una sola vez: la venta entra a caja hoy
                pago = await tx.transaccion.update({
                    where: { id },
                    data: { estado: 'COMPLETADO', metodoPago: etiqueta, fecha, hora, ...(nota ? { nota: venta.nota ? `${venta.nota}\n${nota}` : nota } : {}) },
                });
            } else {
                esAdelanto = pagado === 0;
                pago = await tx.transaccion.create({
                    data: {
                        numero: await siguienteNumero(tx, 'PAG'),
                        tipo: 'INGRESO',
                        monto,
                        metodoPago: etiqueta,
                        concepto: `${esAdelanto ? 'Adelanto' : 'Pago a cuenta'} de ${venta.numero}`.slice(0, 200),
                        categoria: venta.categoria,
                        fecha,
                        hora,
                        estado: 'COMPLETADO',
                        nota,
                        clienteId: venta.clienteId,
                        clienteNombre: venta.clienteNombre,
                        numeroGuiaId: venta.numeroGuiaId,
                        ventaId: venta.id,
                    },
                });
                const nuevoSaldo = redondear(saldo - monto);
                await tx.transaccion.update({
                    where: { id },
                    data: { pagoEnPartes: true, estado: nuevoSaldo <= CENTIMO ? 'COMPLETADO' : 'PARCIAL' },
                });
            }

            const movimientoBancario = banco
                ? await registrarEnBanco(tx, req, {
                    transaccion: pago, monto, metodo, esAdelanto,
                    concepto: pago.id === venta.id ? `Cobro de ${venta.numero}` : `${pago.concepto} (${pago.numero})`,
                }, banco)
                : null;

            return { pago, movimientoBancario };
        }));

        res.status(201).json({ ...resultado, venta: await resumenVenta(prisma, id) });
    } catch (e) { responderErrorCobro(res, e, 'registrar pago'); }
};

// ==========================================
// Pedidos web: devolver el stock reservado
// ==========================================
export const devolverStockPedidoWeb = async (tx: Tx, numero: string) => {
    const salidas = await tx.movimientoInventario.findMany({ where: { tipo: 'SALIDA', motivo: `VENTA_WEB #${numero}` } });
    const yaDevuelto = await tx.movimientoInventario.count({ where: { tipo: 'ENTRADA', motivo: `DEVOLUCION_WEB #${numero}` } });
    if (yaDevuelto) return 0;
    for (const s of salidas) {
        await tx.producto.update({ where: { id: s.productoId }, data: { stockActual: { increment: s.cantidad } } });
        await tx.movimientoInventario.create({
            data: { productoId: s.productoId, tipo: 'ENTRADA', cantidad: s.cantidad, motivo: `DEVOLUCION_WEB #${numero}` },
        });
    }
    return salidas.length;
};

// ==========================================
// POST /finanzas/transacciones/:id/verificar — confirmar o rechazar el pago de un pedido web
// confirmar: { accion: 'confirmar', metodoPago?, banco?: {...} | movimientoId? }
// rechazar:  { accion: 'rechazar', motivo }
// ==========================================
export const verificarPedidoWeb = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const accion = req.body?.accion;
        if (accion !== 'confirmar' && accion !== 'rechazar') throw new ErrorCobro('Indica si confirmas o rechazas el pago.');

        const resultado = await prisma.$transaction(async tx => {
            const venta = await tx.transaccion.findUnique({ where: { id } });
            if (!venta) throw new ErrorCobro('Pedido no encontrado.', 404);
            if (venta.estado !== 'POR_VERIFICAR') throw new ErrorCobro('Este pedido ya no está por verificar.', 409);
            const marca = { verificadoPor: quien(req), verificadoEn: new Date() };

            if (accion === 'rechazar') {
                const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 300) : '';
                if (motivo.length < 5) throw new ErrorCobro('Escribe el motivo del rechazo (mínimo 5 caracteres).');
                const devueltos = await devolverStockPedidoWeb(tx, venta.numero);
                const pedido = await tx.transaccion.update({ where: { id }, data: { estado: 'ANULADO', motivoAnulacion: motivo, ...marca } });
                return { pedido, movimientoBancario: null, productosDevueltos: devueltos };
            }

            const metodo = metodoValido(req.body?.metodoPago || venta.metodoPago);
            let movimientoBancario = null;
            if (METODO_BANCO[metodo]) {
                const movimientoId = Number(req.body?.movimientoId);
                if (movimientoId) {
                    // Enlazar un movimiento que ya está registrado en el banco
                    const mov = await tx.movimientoBancario.findUnique({ where: { id: movimientoId } });
                    if (!mov || mov.estado === 'ANULADO' || mov.tipo !== 'INGRESO') throw new ErrorCobro('El movimiento bancario no existe, está anulado o no es un ingreso.');
                    if (mov.transaccionId && mov.transaccionId !== venta.id) throw new ErrorCobro(`El movimiento ${mov.codigo} ya está enlazado a otra venta.`, 409);
                    if (Math.abs(Number(mov.montoPen) - venta.monto) > CENTIMO) {
                        throw new ErrorCobro(`El movimiento ${mov.codigo} es de S/ ${Number(mov.montoPen).toFixed(2)} y el pedido de S/ ${venta.monto.toFixed(2)}.`, 409);
                    }
                    movimientoBancario = await tx.movimientoBancario.update({ where: { id: mov.id }, data: { transaccionId: venta.id }, select: { id: true, codigo: true, estado: true } });
                } else if (req.body?.banco?.cuentaId) {
                    movimientoBancario = await registrarEnBanco(tx, req, {
                        transaccion: venta, monto: venta.monto, metodo, concepto: `Pedido web ${venta.numero}`,
                    }, req.body.banco);
                } else {
                    throw new ErrorCobro('Para confirmar un pago por transferencia o Yape, indica en qué cuenta llegó (y el n.º de operación) o elige el movimiento bancario.');
                }
            }

            const pedido = await tx.transaccion.update({
                where: { id },
                data: { estado: 'COMPLETADO', metodoPago: ETIQUETA_METODO[metodo], fecha: hoyLima(), hora: horaLima(), ...marca },
            });
            return { pedido, movimientoBancario, productosDevueltos: 0 };
        });

        res.json(resultado);
    } catch (e) { responderErrorCobro(res, e, 'verificar pedido web'); }
};
