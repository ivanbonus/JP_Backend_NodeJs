// Fase 3 — Compras, proveedores y cuentas por pagar.
//
// - Un comprobante (tipo + RUC del emisor + serie + número) se registra una sola vez.
// - El estado de pago se calcula siempre desde las asignaciones de pago válidas.
// - Un pago a proveedor es un EGRESO (Transaccion) que puede quedar también en Control Bancario;
//   sus asignaciones lo reparten entre una o varias facturas (y una factura puede recibir varios pagos).
// - Registrar una compra NO mueve el inventario: eso ocurre al confirmar la recepción (Fase 5).
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { quien, registrarAuditoria, ipDe } from '../auth/auditoria';
import { hoyLima, horaLima } from '../utils/fechas';
import { ETIQUETA_METODO, normalizarMetodoPago, siguienteCorrelativo } from '../utils/caja';
import { recibirArchivos } from '../storage/subida';
import { ErrorArchivo, enlaceTemporal } from '../storage/almacenamiento';
import { ErrorValidacion } from './bancos.controller';
import { ErrorCobro, registrarEnBanco } from './cobros.controller';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
type Tx = Prisma.TransactionClient;

export const TIPOS_COMPROBANTE = ['FACTURA', 'BOLETA', 'RECIBO_HONORARIOS', 'TICKET', 'OTRO'] as const;
const ENTIDAD_ARCHIVO = 'documento_compra';
const MAX_ARCHIVO = 15 * 1024 * 1024;
const IGV = new D('0.18');
const TOLERANCIA = new D('0.10'); // redondeos de los comprobantes

class ErrorCompra extends Error {
    constructor(message: string, public status = 400, public extra?: Record<string, unknown>) { super(message); }
}

const responderError = (res: Response, error: unknown, contexto: string) => {
    if (error instanceof ErrorCompra) {
        res.status(error.status).json({ error: error.message, ...(error.extra || {}) });
        return;
    }
    if (error instanceof ErrorValidacion || error instanceof ErrorCobro || error instanceof ErrorArchivo) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
        return;
    }
    console.error(`Error en ${contexto}:`, error);
    res.status(500).json({ error: 'Error del servidor.' });
};

// ==========================================
// Validaciones
// ==========================================
const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

/** Importe exacto (hasta 2 decimales, sin flotantes) */
const dinero = (v: unknown, campo: string, { cero = false } = {}): Dec => {
    const t = String(v ?? '').trim().replace(/,/g, '');
    if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(t)) throw new ErrorCompra(`${campo} no es válido (usa hasta 2 decimales).`);
    const d = new D(t);
    if (d.lt(0) || (!cero && d.eq(0))) throw new ErrorCompra(`${campo} debe ser mayor que cero.`);
    return d;
};
const decimal = (v: unknown, campo: string, decimales: number): Dec => {
    const t = String(v ?? '').trim().replace(/,/g, '');
    if (!new RegExp(`^\\d{1,10}(\\.\\d{1,${decimales}})?$`).test(t) || new D(t).lte(0)) throw new ErrorCompra(`${campo} no es válido.`);
    return new D(t);
};
const tipoCambioValido = (v: unknown) => {
    const t = String(v ?? '').trim();
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(t) || new D(t).lte(0)) throw new ErrorCompra('El tipo de cambio no es válido (hasta 4 decimales).');
    return new D(t);
};

/** RUC peruano: 11 dígitos, prefijo válido y dígito verificador (módulo 11 de SUNAT) */
export const rucValido = (ruc: string) => {
    if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false;
    const factores = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const suma = factores.reduce((s, f, i) => s + f * Number(ruc[i]), 0);
    const resto = 11 - (suma % 11);
    const digito = resto === 10 ? 0 : resto === 11 ? 1 : resto;
    return digito === Number(ruc[10]);
};

const documentoProveedor = (tipo: unknown, valor: unknown) => {
    const t = tipo === 'DNI' ? 'DNI' : 'RUC';
    const v = String(valor ?? '').replace(/\s/g, '');
    if (t === 'RUC' && !rucValido(v)) throw new ErrorCompra('El RUC no es válido (11 dígitos con dígito verificador correcto).');
    if (t === 'DNI' && !/^\d{8}$/.test(v)) throw new ErrorCompra('El DNI debe tener 8 dígitos.');
    return { tipoDocumento: t, ruc: v };
};

/** Fecha "YYYY-MM-DD" → mediodía de Lima (evita que cambie de día por la zona horaria) */
const fechaDia = (v: unknown, campo: string): Date => {
    const t = String(v ?? '').slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!m) throw new ErrorCompra(`${campo} no es válida.`);
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 17));
    if (isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) throw new ErrorCompra(`${campo} no es válida.`);
    return d;
};
const sumarDias = (f: Date, dias: number) => new Date(f.getTime() + dias * 86400000);

/** Inicio de hoy y del mes en Lima (UTC-5) */
const rangosLima = (ahora = new Date()) => {
    const lima = new Date(ahora.getTime() - 5 * 3600 * 1000);
    const y = lima.getUTCFullYear(), m = lima.getUTCMonth(), d = lima.getUTCDate();
    return { inicioDia: new Date(Date.UTC(y, m, d, 5)), inicioMes: new Date(Date.UTC(y, m, 1, 5)), inicioMesSiguiente: new Date(Date.UTC(y, m + 1, 1, 5)) };
};

const redondear2 = (d: Dec) => d.toDecimalPlaces(2, D.ROUND_HALF_UP);

// ==========================================
// Saldos y estados
// ==========================================
const pagadoDe = async (db: Tx | typeof prisma, documentoId: number): Promise<Dec> => {
    const r = await db.asignacionPago.aggregate({ where: { documentoId, estado: 'ACTIVA' }, _sum: { monto: true } });
    return r._sum.monto ?? new D(0);
};

/** Recalcula el estado de pago desde las asignaciones válidas */
const recalcularEstadoPago = async (tx: Tx, documentoId: number) => {
    const doc = await tx.documentoCompra.findUniqueOrThrow({ where: { id: documentoId } });
    const pagado = await pagadoDe(tx, documentoId);
    const estadoPago = pagado.lte(0) ? 'PENDIENTE' : pagado.gte(doc.total) ? 'PAGADO' : 'PARCIAL';
    if (estadoPago !== doc.estadoPago) await tx.documentoCompra.update({ where: { id: documentoId }, data: { estadoPago } });
    return estadoPago;
};

/** Datos derivados para mostrar: pagado, saldo, vencido */
const conSaldo = <T extends { id: number; total: Dec; fechaVencimiento: Date | null; estado: string; estadoPago: string }>(doc: T, pagado: Dec) => {
    const saldo = D.max(doc.total.sub(pagado), 0);
    const { inicioDia } = rangosLima();
    const vencido = doc.estado === 'ACTIVO' && saldo.gt(0) && !!doc.fechaVencimiento && doc.fechaVencimiento < inicioDia;
    const diasVencido = vencido ? Math.floor((inicioDia.getTime() - doc.fechaVencimiento!.getTime()) / 86400000) + 1 : 0;
    return { ...doc, pagado: pagado.toFixed(2), saldo: saldo.toFixed(2), vencido, diasVencido };
};

const pagadosPorDocumento = async (ids: number[]) => {
    if (!ids.length) return new Map<number, Dec>();
    const filas = await prisma.asignacionPago.groupBy({ by: ['documentoId'], where: { documentoId: { in: ids }, estado: 'ACTIVA' }, _sum: { monto: true } });
    return new Map(filas.map(f => [f.documentoId, f._sum.monto ?? new D(0)]));
};

const archivosDe = (ids: number[]) =>
    ids.length
        ? prisma.archivo.findMany({
            where: { entidad: ENTIDAD_ARCHIVO, entidadId: { in: ids }, eliminado: false },
            select: { id: true, entidadId: true, nombre: true, mime: true, tamano: true, subidoPor: true, subidoEn: true },
            orderBy: { id: 'asc' },
        })
        : Promise.resolve([]);

// ==========================================
// Proveedores
// ==========================================
const datosProveedor = (b: any, parcial = false) => {
    const datos: Record<string, unknown> = {};
    if (!parcial || b?.ruc !== undefined) Object.assign(datos, documentoProveedor(b?.tipoDocumento, b?.ruc));
    if (!parcial || b?.razonSocial !== undefined) {
        const r = texto(b?.razonSocial, 200);
        if (!r) throw new ErrorCompra('Escribe la razón social del proveedor.');
        datos.razonSocial = r;
    }
    for (const c of ['nombreComercial', 'direccion', 'telefono', 'contacto', 'cuentaBancaria', 'observaciones'] as const) {
        if (b?.[c] !== undefined) datos[c] = texto(b[c], c === 'observaciones' ? 1000 : 200);
    }
    if (b?.email !== undefined) {
        const e = texto(b.email, 150);
        if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ErrorCompra('El correo del proveedor no es válido.');
        datos.email = e;
    }
    if (b?.diasCredito !== undefined) {
        const n = Number(b.diasCredito);
        if (!Number.isInteger(n) || n < 0 || n > 365) throw new ErrorCompra('Los días de crédito deben estar entre 0 y 365.');
        datos.diasCredito = n;
    }
    if (b?.activo !== undefined) datos.activo = !!b.activo;
    return datos;
};

export const listarProveedores = async (req: Request, res: Response) => {
    try {
        const q = texto(req.query.q, 100);
        const proveedores = await prisma.proveedor.findMany({
            where: {
                ...(req.query.activos === '1' ? { activo: true } : {}),
                ...(q ? { OR: [{ razonSocial: { contains: q, mode: 'insensitive' } }, { nombreComercial: { contains: q, mode: 'insensitive' } }, { ruc: { contains: q } }] } : {}),
            },
            orderBy: { razonSocial: 'asc' },
        });
        // Totales por proveedor (documentos activos)
        const totales = await prisma.documentoCompra.groupBy({ by: ['proveedorId'], where: { estado: 'ACTIVO' }, _sum: { totalPen: true }, _count: true });
        const docsPendientes = await prisma.documentoCompra.findMany({
            where: { estado: 'ACTIVO', estadoPago: { not: 'PAGADO' } },
            select: { id: true, proveedorId: true, total: true, totalPen: true, moneda: true },
        });
        const pagados = await pagadosPorDocumento(docsPendientes.map(d => d.id));
        const saldo = new Map<number, Dec>();
        for (const d of docsPendientes) {
            const s = D.max(d.total.sub(pagados.get(d.id) ?? 0), 0);
            // saldo en soles (proporcional si el documento es en dólares)
            const sPen = d.moneda === 'PEN' ? s : d.total.gt(0) ? redondear2(s.mul(d.totalPen).div(d.total)) : new D(0);
            saldo.set(d.proveedorId, (saldo.get(d.proveedorId) ?? new D(0)).add(sPen));
        }
        res.json(proveedores.map(p => {
            const t = totales.find(x => x.proveedorId === p.id);
            return { ...p, comprasPen: (t?._sum.totalPen ?? new D(0)).toFixed(2), documentos: t?._count ?? 0, saldoPendientePen: (saldo.get(p.id) ?? new D(0)).toFixed(2) };
        }));
    } catch (e) { responderError(res, e, 'listar proveedores'); }
};

export const crearProveedor = async (req: Request, res: Response) => {
    try {
        const datos = datosProveedor(req.body) as any;
        const existe = await prisma.proveedor.findUnique({ where: { ruc: datos.ruc } });
        if (existe) throw new ErrorCompra(`Ya existe el proveedor ${existe.razonSocial} con ese documento.`, 409, { proveedor: existe });
        res.status(201).json(await prisma.proveedor.create({ data: datos }));
    } catch (e) { responderError(res, e, 'crear proveedor'); }
};

export const actualizarProveedor = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const actual = await prisma.proveedor.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Proveedor no encontrado.' });
        const datos = datosProveedor(req.body, true) as any;
        if (datos.ruc && datos.ruc !== actual.ruc && (await prisma.documentoCompra.count({ where: { proveedorId: id } }))) {
            throw new ErrorCompra('No se puede cambiar el RUC de un proveedor que ya tiene comprobantes registrados.', 409);
        }
        res.json(await prisma.proveedor.update({ where: { id }, data: datos }));
    } catch (e) { responderError(res, e, 'actualizar proveedor'); }
};

// ==========================================
// Comprobantes de compra
// ==========================================
type DetalleEntrada = {
    codigoProveedor: string | null; descripcion: string; unidad: string; cantidad: Dec; valorUnitario: Dec;
    descuento: Dec; afectoIgv: boolean; igv: Dec; total: Dec; productoId: number | null;
};

const leerDetalles = async (lista: unknown): Promise<DetalleEntrada[]> => {
    if (lista === undefined || lista === null) return [];
    if (!Array.isArray(lista) || lista.length > 300) throw new ErrorCompra('El detalle de productos no es válido (máximo 300 líneas).');
    const productos = new Set(
        (await prisma.producto.findMany({ where: { id: { in: lista.map((l: any) => Number(l?.productoId)).filter(Number.isInteger) } }, select: { id: true } })).map(p => p.id),
    );
    return lista.map((l: any, i: number) => {
        const fila = `Línea ${i + 1}`;
        const descripcion = texto(l?.descripcion, 300);
        if (!descripcion) throw new ErrorCompra(`${fila}: falta la descripción.`);
        const cantidad = decimal(l?.cantidad, `${fila}: la cantidad`, 4);
        const valorUnitario = decimal(l?.valorUnitario, `${fila}: el valor unitario`, 6);
        const descuento = l?.descuento !== undefined && l?.descuento !== '' ? dinero(l.descuento, `${fila}: el descuento`, { cero: true }) : new D(0);
        const afectoIgv = l?.afectoIgv !== false;
        const subtotal = redondear2(cantidad.mul(valorUnitario)).sub(descuento);
        if (subtotal.lt(0)) throw new ErrorCompra(`${fila}: el descuento supera el importe.`);
        const igv = l?.igv !== undefined && l?.igv !== '' ? dinero(l.igv, `${fila}: el IGV`, { cero: true }) : afectoIgv ? redondear2(subtotal.mul(IGV)) : new D(0);
        const total = l?.total !== undefined && l?.total !== '' ? dinero(l.total, `${fila}: el total`, { cero: true }) : subtotal.add(igv);
        const productoId = l?.productoId ? Number(l.productoId) : null;
        if (productoId && !productos.has(productoId)) throw new ErrorCompra(`${fila}: el producto del inventario no existe.`);
        return {
            codigoProveedor: texto(l?.codigoProveedor, 60), descripcion, unidad: (texto(l?.unidad, 20) || 'UND').toUpperCase(),
            cantidad, valorUnitario, descuento, afectoIgv, igv, total, productoId,
        };
    });
};

/** Lee y valida los datos del comprobante; `actual` = documento existente al editar */
const leerDocumento = async (b: any, actual?: { proveedorId: number }) => {
    const tipo = String(b?.tipo || '').toUpperCase();
    if (!(TIPOS_COMPROBANTE as readonly string[]).includes(tipo)) throw new ErrorCompra('Elige el tipo de comprobante.');
    const serie = String(b?.serie ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(serie)) throw new ErrorCompra('La serie no es válida (hasta 4 letras o números, p. ej. F001).');
    const numeroTexto = String(b?.numero ?? '').trim();
    if (!/^\d{1,10}$/.test(numeroTexto)) throw new ErrorCompra('El número del comprobante debe tener solo dígitos.');
    const numero = String(Number(numeroTexto));

    // Proveedor: por id, o por RUC (se crea si no existe)
    let proveedor;
    if (b?.proveedorId) {
        proveedor = await prisma.proveedor.findUnique({ where: { id: Number(b.proveedorId) } });
        if (!proveedor) throw new ErrorCompra('El proveedor no existe.');
    } else if (b?.proveedor?.ruc) {
        const datos = datosProveedor(b.proveedor) as any;
        proveedor = await prisma.proveedor.findUnique({ where: { ruc: datos.ruc } })
            ?? await prisma.proveedor.create({ data: datos });
    } else if (actual) {
        proveedor = await prisma.proveedor.findUniqueOrThrow({ where: { id: actual.proveedorId } });
    } else {
        throw new ErrorCompra('Elige el proveedor o escribe su RUC y razón social.');
    }

    const fechaEmision = fechaDia(b?.fechaEmision, 'La fecha de emisión');
    if (fechaEmision.getTime() > Date.now() + 86400000) throw new ErrorCompra('La fecha de emisión no puede estar en el futuro.');
    const condicionPago = b?.condicionPago === 'CREDITO' ? 'CREDITO' : 'CONTADO';
    let fechaVencimiento: Date | null = b?.fechaVencimiento ? fechaDia(b.fechaVencimiento, 'La fecha de vencimiento') : null;
    if (condicionPago === 'CONTADO') fechaVencimiento ??= fechaEmision;
    if (condicionPago === 'CREDITO' && !fechaVencimiento) {
        if (proveedor.diasCredito > 0) fechaVencimiento = sumarDias(fechaEmision, proveedor.diasCredito);
        else throw new ErrorCompra('Es una compra al crédito: indica la fecha de vencimiento (o los días de crédito del proveedor).');
    }
    if (fechaVencimiento && fechaVencimiento < fechaEmision) throw new ErrorCompra('El vencimiento no puede ser anterior a la emisión.');

    const moneda = b?.moneda === 'USD' ? 'USD' : 'PEN';
    const tipoCambio = moneda === 'USD' ? tipoCambioValido(b?.tipoCambio) : null;
    const baseImponible = dinero(b?.baseImponible, 'La base imponible', { cero: true });
    const igv = dinero(b?.igv, 'El IGV', { cero: true });
    const otrosTributos = b?.otrosTributos ? dinero(b.otrosTributos, 'Otros tributos', { cero: true }) : new D(0);
    const descuentos = b?.descuentos ? dinero(b.descuentos, 'Los descuentos', { cero: true }) : new D(0);
    const total = dinero(b?.total, 'El total');
    // La base ya viene con los descuentos aplicados (como en el comprobante): total = base + IGV + otros
    if (baseImponible.add(igv).add(otrosTributos).sub(total).abs().gt(TOLERANCIA)) {
        throw new ErrorCompra(`Base imponible + IGV + otros tributos (${baseImponible.add(igv).add(otrosTributos).toFixed(2)}) no coincide con el total (${total.toFixed(2)}). Revisa los importes.`);
    }

    const detalles = await leerDetalles(b?.detalles);
    if (detalles.length) {
        const sumaLineas = detalles.reduce((s, d) => s.add(d.total), new D(0));
        if (sumaLineas.sub(total).abs().gt(TOLERANCIA)) {
            throw new ErrorCompra(`La suma de las líneas (${sumaLineas.toFixed(2)}) no coincide con el total del comprobante (${total.toFixed(2)}).`);
        }
    }

    const recepcion = ['PENDIENTE', 'NO_APLICA'].includes(b?.estadoRecepcion) ? b.estadoRecepcion : undefined;
    const origen = ['MANUAL', 'FOTO', 'XML', 'PDF'].includes(b?.origen) ? b.origen : undefined;

    return {
        datos: {
            tipo, serie, numero, proveedorId: proveedor.id, rucEmisor: proveedor.ruc, razonSocialEmisor: proveedor.razonSocial,
            fechaEmision, fechaVencimiento, moneda, tipoCambio, baseImponible, igv, otrosTributos, descuentos, total,
            totalPen: tipoCambio ? redondear2(total.mul(tipoCambio)) : total,
            condicionPago, observaciones: texto(b?.observaciones, 1000),
            ...(recepcion ? { estadoRecepcion: recepcion } : {}),
            ...(origen ? { origen } : {}),
        },
        detalles,
    };
};

const incluirDocumento = {
    proveedor: { select: { id: true, ruc: true, razonSocial: true, nombreComercial: true, diasCredito: true, cuentaBancaria: true } },
} as const;

/** Detalle completo: líneas, pagos (con su egreso y movimiento bancario) y archivos */
const documentoCompleto = async (id: number) => {
    const doc = await prisma.documentoCompra.findUnique({
        where: { id },
        include: {
            ...incluirDocumento,
            detalles: { orderBy: { orden: 'asc' }, include: { producto: { select: { id: true, sku: true, nombre: true } } } },
            asignaciones: {
                orderBy: { id: 'asc' },
                include: {
                    transaccion: {
                        select: {
                            id: true, numero: true, fecha: true, metodoPago: true, monto: true, estado: true,
                            movimientosBancarios: { where: { estado: { not: 'ANULADO' } }, select: { id: true, codigo: true, estado: true, numeroOperacion: true } },
                        },
                    },
                },
            },
        },
    });
    if (!doc) return null;
    const pagado = doc.asignaciones.filter(a => a.estado === 'ACTIVA').reduce((s, a) => s.add(a.monto), new D(0));
    return { ...conSaldo(doc, pagado), archivos: await archivosDe([id]) };
};

export const listarDocumentos = async (req: Request, res: Response) => {
    try {
        const q = req.query as Record<string, string>;
        const where: Prisma.DocumentoCompraWhereInput = {};
        if (q.estado === 'ANULADO') where.estado = 'ANULADO';
        else if (q.estado !== 'TODOS') where.estado = 'ACTIVO';
        if (q.proveedorId) where.proveedorId = Number(q.proveedorId);
        if (q.estadoPago && ['PENDIENTE', 'PARCIAL', 'PAGADO'].includes(q.estadoPago)) where.estadoPago = q.estadoPago;
        if (q.estadoRevision && ['PENDIENTE', 'REVISADO', 'OBSERVADO'].includes(q.estadoRevision)) where.estadoRevision = q.estadoRevision;
        if (q.contabilidad === 'pendiente') where.entregadoContabilidad = false;
        if (q.contabilidad === 'entregado') where.entregadoContabilidad = true;
        if (q.desde || q.hasta) {
            // fechaDia = mediodía de Lima: el día va de 12 h antes a 12 h después
            where.fechaEmision = {
                ...(q.desde ? { gte: new Date(fechaDia(q.desde, 'Desde').getTime() - 12 * 3600000) } : {}),
                ...(q.hasta ? { lt: new Date(fechaDia(q.hasta, 'Hasta').getTime() + 12 * 3600000) } : {}),
            };
        }
        const busca = texto(q.q, 100);
        if (busca) {
            const partes = /^([A-Z0-9]{1,4})-(\d+)$/i.exec(busca);
            where.OR = [
                { razonSocialEmisor: { contains: busca, mode: 'insensitive' } },
                { rucEmisor: { contains: busca } },
                { codigo: { contains: busca, mode: 'insensitive' } },
                { serie: { equals: busca.toUpperCase() } },
                ...(partes ? [{ serie: partes[1].toUpperCase(), numero: String(Number(partes[2])) }] : []),
                { detalles: { some: { descripcion: { contains: busca, mode: 'insensitive' } } } },
            ];
        }
        const docs = await prisma.documentoCompra.findMany({
            where, include: incluirDocumento, orderBy: [{ fechaEmision: 'desc' }, { id: 'desc' }], take: Math.min(Number(q.limite) || 300, 1000),
        });
        const pagados = await pagadosPorDocumento(docs.map(d => d.id));
        const archivos = await archivosDe(docs.map(d => d.id));
        let lista = docs.map(d => ({ ...conSaldo(d, pagados.get(d.id) ?? new D(0)), archivos: archivos.filter(a => a.entidadId === d.id).length }));
        if (q.vencidos === '1') lista = lista.filter(d => d.vencido);
        res.json(lista);
    } catch (e) { responderError(res, e, 'listar comprobantes'); }
};

export const obtenerDocumento = async (req: Request, res: Response) => {
    try {
        const d = await documentoCompleto(Number(req.params.id));
        if (!d) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
        res.json(d);
    } catch (e) { responderError(res, e, 'obtener comprobante'); }
};

/** Si el comprobante ya existe: se cuenta el intento y se responde 409 con el registro existente */
const avisarDuplicado = async (tipo: string, rucEmisor: string, serie: string, numero: string, excluirId?: number) => {
    const existente = await prisma.documentoCompra.findUnique({ where: { tipo_rucEmisor_serie_numero: { tipo, rucEmisor, serie, numero } } });
    if (!existente || existente.id === excluirId) return;
    await prisma.documentoCompra.update({ where: { id: existente.id }, data: { intentosDuplicado: { increment: 1 } } });
    throw new ErrorCompra(
        `Este comprobante ya está registrado (${existente.codigo}${existente.estado === 'ANULADO' ? ', anulado' : ''}). No se registra dos veces.`,
        409,
        { duplicado: { id: existente.id, codigo: existente.codigo, estado: existente.estado } },
    );
};

export const crearDocumento = async (req: Request, res: Response) => {
    try {
        const { datos, detalles } = await leerDocumento(req.body);
        await avisarDuplicado(datos.tipo, datos.rucEmisor, datos.serie, datos.numero);
        const creado = await prisma.$transaction(async tx => {
            const temporal = await tx.documentoCompra.create({
                data: {
                    ...datos,
                    codigo: `TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    registradoPor: quien(req),
                    detalles: { create: detalles.map((d, i) => ({ ...d, orden: i + 1 })) },
                },
            });
            return tx.documentoCompra.update({
                where: { id: temporal.id },
                data: { codigo: `CP-${datos.fechaEmision.getUTCFullYear()}-${String(temporal.id).padStart(6, '0')}` },
            });
        });
        res.status(201).json(await documentoCompleto(creado.id));
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return void res.status(409).json({ error: 'Este comprobante ya está registrado. No se registra dos veces.' });
        }
        responderError(res, e, 'registrar comprobante');
    }
};

export const actualizarDocumento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const actual = await prisma.documentoCompra.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
        if (actual.estado === 'ANULADO') throw new ErrorCompra('El comprobante está anulado.');

        // Revisado: solo datos que no cambian el documento
        if (actual.estadoRevision === 'REVISADO') {
            const data: Prisma.DocumentoCompraUpdateInput = {};
            if (req.body?.observaciones !== undefined) data.observaciones = texto(req.body.observaciones, 1000);
            if (req.body?.fechaVencimiento) data.fechaVencimiento = fechaDia(req.body.fechaVencimiento, 'La fecha de vencimiento');
            await prisma.documentoCompra.update({ where: { id }, data });
            return void res.json(await documentoCompleto(id));
        }

        const { datos, detalles } = await leerDocumento({ ...req.body }, actual);
        await avisarDuplicado(datos.tipo, datos.rucEmisor, datos.serie, datos.numero, id);
        const pagado = await pagadoDe(prisma, id);
        if (datos.total.lt(pagado)) throw new ErrorCompra(`El total no puede ser menor a lo ya pagado (${pagado.toFixed(2)}).`, 409);
        if (datos.moneda !== actual.moneda && pagado.gt(0)) throw new ErrorCompra('No se puede cambiar la moneda de un comprobante con pagos.', 409);
        if (actual.estadoRecepcion !== 'PENDIENTE' && actual.estadoRecepcion !== 'NO_APLICA' && Array.isArray(req.body?.detalles)) {
            throw new ErrorCompra('La mercadería ya se recibió: el detalle de productos no se puede reemplazar.', 409);
        }

        await prisma.$transaction(async tx => {
            await tx.documentoCompra.update({
                where: { id },
                data: { ...datos, ...(actual.estadoRevision === 'OBSERVADO' ? { estadoRevision: 'PENDIENTE' } : {}) },
            });
            if (Array.isArray(req.body?.detalles)) {
                await tx.detalleCompra.deleteMany({ where: { documentoId: id } });
                if (detalles.length) await tx.detalleCompra.createMany({ data: detalles.map((d, i) => ({ ...d, orden: i + 1, documentoId: id })) });
            }
            await recalcularEstadoPago(tx, id);
        });
        res.json(await documentoCompleto(id));
    } catch (e) { responderError(res, e, 'actualizar comprobante'); }
};

export const revisarDocumento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const doc = await prisma.documentoCompra.findUnique({ where: { id } });
        if (!doc) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
        if (doc.estado === 'ANULADO') throw new ErrorCompra('El comprobante está anulado.');
        const resultado = req.body?.resultado;
        if (resultado !== 'REVISADO' && resultado !== 'OBSERVADO') throw new ErrorCompra('Indica si está revisado u observado.');
        const nota = texto(req.body?.nota, 500);
        if (resultado === 'OBSERVADO' && (!nota || nota.length < 5)) throw new ErrorCompra('Escribe qué hay que corregir (mínimo 5 caracteres).');
        if (resultado === 'REVISADO') {
            const archivos = await prisma.archivo.count({ where: { entidad: ENTIDAD_ARCHIVO, entidadId: id, eliminado: false } });
            if (!archivos) throw new ErrorCompra('Adjunta el comprobante (PDF o foto) antes de marcarlo como revisado.');
        }
        await prisma.documentoCompra.update({
            where: { id },
            data: { estadoRevision: resultado, notaRevision: nota, revisadoPor: quien(req), revisadoEn: new Date() },
        });
        res.json(await documentoCompleto(id));
    } catch (e) { responderError(res, e, 'revisar comprobante'); }
};

export const marcarContabilidad = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const doc = await prisma.documentoCompra.findUnique({ where: { id } });
        if (!doc) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
        const entregado = req.body?.entregado !== false;
        await prisma.documentoCompra.update({
            where: { id },
            data: entregado
                ? { entregadoContabilidad: true, entregadoContabilidadEn: new Date(), entregadoContabilidadPor: quien(req) }
                : { entregadoContabilidad: false, entregadoContabilidadEn: null, entregadoContabilidadPor: null },
        });
        res.json(await documentoCompleto(id));
    } catch (e) { responderError(res, e, 'marcar entrega a contabilidad'); }
};

export const anularDocumento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const motivo = texto(req.body?.motivo, 300);
        if (!motivo || motivo.length < 5) throw new ErrorCompra('Escribe el motivo de la anulación (mínimo 5 caracteres).');
        const doc = await prisma.documentoCompra.findUnique({ where: { id } });
        if (!doc) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
        if (doc.estado === 'ANULADO') throw new ErrorCompra('Ya está anulado.', 409);
        const pagos = await prisma.asignacionPago.count({ where: { documentoId: id, estado: 'ACTIVA' } });
        if (pagos) throw new ErrorCompra(`Tiene ${pagos} pago(s) aplicados: quítalos primero.`, 409);
        if (doc.estadoRecepcion === 'PARCIAL' || doc.estadoRecepcion === 'RECIBIDO') {
            throw new ErrorCompra('La mercadería ya ingresó al inventario: no se puede anular.', 409);
        }
        await prisma.documentoCompra.update({
            where: { id }, data: { estado: 'ANULADO', anuladoPor: quien(req), anuladoEn: new Date(), motivoAnulacion: motivo },
        });
        res.json(await documentoCompleto(id));
    } catch (e) { responderError(res, e, 'anular comprobante'); }
};

// ==========================================
// Archivos del comprobante (PDF y fotos)
// ==========================================
export const subirArchivosDocumento = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const doc = await prisma.documentoCompra.findUnique({ where: { id } }).catch(() => null);
    if (!doc) return void res.status(404).json({ error: 'Comprobante no encontrado.' });
    if (doc.estado === 'ANULADO') return void res.status(400).json({ error: 'El comprobante está anulado.' });
    const r = await recibirArchivos(req, {
        entidad: ENTIDAD_ARCHIVO, entidadId: id, carpeta: 'compras', maxBytes: MAX_ARCHIVO, maxArchivos: 10,
        avisoDuplicado: async (otroId, nombre) => {
            const otro = await prisma.documentoCompra.findUnique({ where: { id: otroId }, select: { codigo: true, serie: true, numero: true } });
            return `Atención: "${nombre}" es idéntico al archivo del comprobante ${otro ? `${otro.codigo} (${otro.serie}-${otro.numero})` : otroId}. ¿Es la misma factura?`;
        },
    });
    if (!r.archivos.length) return responderError(res, r.error ?? new ErrorCompra('No se recibió ningún archivo.'), 'subir archivos de compra');
    // Fotos de una factura impresa: el origen pasa a FOTO si estaba como manual
    if (doc.origen === 'MANUAL' && r.archivos.some(a => a.mime.startsWith('image/'))) {
        await prisma.documentoCompra.update({ where: { id }, data: { origen: 'FOTO' } });
    }
    void registrarAuditoria({
        cuenta: quien(req), rol: req.usuario?.rol, accion: 'COMPROBANTE_SUBIDO', entidad: 'compras', entidadId: id,
        ip: ipDe(req), detalle: { archivos: r.archivos.map(a => a.nombre), documento: doc.codigo },
    });
    res.status(201).json({ archivos: r.archivos, avisos: r.avisos, error: r.error?.message });
};

const baseUrl = (req: Request) => process.env.PUBLIC_API_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;

export const enlaceArchivoCompra = async (req: Request, res: Response) => {
    try {
        const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
        if (!a || a.eliminado || a.entidad !== ENTIDAD_ARCHIVO) return void res.status(404).json({ error: 'Archivo no encontrado.' });
        res.json({ url: await enlaceTemporal(a, baseUrl(req), req.query.descargar === '1'), nombre: a.nombre, mime: a.mime, expiraEnSegundos: 300 });
    } catch (e) { responderError(res, e, 'enlace de archivo de compra'); }
};

export const quitarArchivoCompra = async (req: Request, res: Response) => {
    try {
        const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
        if (!a || a.eliminado || a.entidad !== ENTIDAD_ARCHIVO) return void res.status(404).json({ error: 'Archivo no encontrado.' });
        const doc = await prisma.documentoCompra.findUnique({ where: { id: a.entidadId }, select: { estadoRevision: true } });
        if (doc?.estadoRevision === 'REVISADO') throw new ErrorCompra('El comprobante ya está revisado: no se quitan sus archivos.', 409);
        await prisma.archivo.update({ where: { id: a.id }, data: { eliminado: true, eliminadoPor: quien(req), eliminadoEn: new Date() } });
        res.json({ ok: true });
    } catch (e) { responderError(res, e, 'quitar archivo de compra'); }
};

// ==========================================
// Pagos a proveedores (asignaciones)
// ==========================================
const METODO_DESDE_BANCO: Record<string, string> = {
    TRANSFERENCIA: 'Transferencia', DEPOSITO: 'Transferencia', YAPE: 'Yape/Plin', PLIN: 'Yape/Plin', TARJETA: 'Tarjeta', CHEQUE: 'Transferencia', OTRO: 'Transferencia',
};

/** Lo que aún se puede asignar de un egreso (en soles) */
const disponibleDeEgreso = async (tx: Tx, transaccionId: number) => {
    const t = await tx.transaccion.findUnique({ where: { id: transaccionId } });
    if (!t || t.tipo !== 'EGRESO' || t.estado !== 'COMPLETADO') throw new ErrorCompra('El egreso elegido no existe, no está pagado o no es un egreso.');
    const usado = (await tx.asignacionPago.aggregate({ where: { transaccionId, estado: 'ACTIVA' }, _sum: { montoPen: true } }))._sum.montoPen ?? new D(0);
    return { transaccion: t, disponible: redondear2(new D(t.monto)).sub(usado) };
};

/**
 * POST /compras/pagos
 * { asignaciones: [{ documentoId, monto }], origen: 'nuevo' | 'movimiento' | 'egreso',
 *   metodoPago? (nuevo), tipoCambio? (documentos en USD), nota?, banco? (nuevo), movimientoId?, transaccionId? }
 */
export const registrarPagoProveedor = async (req: Request, res: Response) => {
    try {
        const b = req.body || {};
        if (!Array.isArray(b.asignaciones) || !b.asignaciones.length || b.asignaciones.length > 50) {
            throw new ErrorCompra('Elige las facturas y cuánto pagas de cada una.');
        }
        const pedidos = b.asignaciones.map((a: any) => ({ documentoId: Number(a?.documentoId), monto: dinero(a?.monto, 'El monto a pagar') }));
        if (new Set(pedidos.map((p: any) => p.documentoId)).size !== pedidos.length) throw new ErrorCompra('Una factura aparece dos veces en el pago.');
        const origen = b.origen === 'movimiento' || b.origen === 'egreso' ? b.origen : 'nuevo';

        const resultado = await prisma.$transaction(async tx => {
            const docs = await tx.documentoCompra.findMany({ where: { id: { in: pedidos.map((p: any) => p.documentoId) } } });
            if (docs.length !== pedidos.length) throw new ErrorCompra('Alguna factura no existe.');
            if (docs.some(d => d.estado !== 'ACTIVO')) throw new ErrorCompra('Alguna factura está anulada.');
            if (new Set(docs.map(d => d.proveedorId)).size > 1) throw new ErrorCompra('Un pago se aplica a facturas de un mismo proveedor.');
            const moneda = docs[0].moneda;
            if (docs.some(d => d.moneda !== moneda)) throw new ErrorCompra('No se mezclan facturas en soles y en dólares en un mismo pago.');
            const tc = moneda === 'USD' ? tipoCambioValido(b.tipoCambio) : null;

            // Cada asignación no supera el saldo de su factura
            const lineas = [];
            for (const p of pedidos) {
                const doc = docs.find(d => d.id === p.documentoId)!;
                const saldo = doc.total.sub(await pagadoDe(tx, doc.id));
                if (p.monto.gt(saldo)) {
                    throw new ErrorCompra(`El pago a ${doc.serie}-${doc.numero} (${p.monto.toFixed(2)}) supera su saldo (${saldo.toFixed(2)}). Si es un ajuste, regístralo aparte.`);
                }
                lineas.push({ doc, monto: p.monto, montoPen: tc ? redondear2(p.monto.mul(tc)) : p.monto });
            }
            const totalPen = lineas.reduce((s, l) => s.add(l.montoPen), new D(0));
            const proveedor = await tx.proveedor.findUniqueOrThrow({ where: { id: docs[0].proveedorId } });
            const referencias = lineas.map(l => `${l.doc.serie}-${l.doc.numero}`).join(', ');

            let transaccionId: number;
            let movimientoBancario: any = null;

            if (origen === 'egreso') {
                // Egreso ya registrado en Caja (p. ej. pagado en efectivo antes)
                const { transaccion, disponible } = await disponibleDeEgreso(tx, Number(b.transaccionId));
                if (totalPen.gt(disponible)) throw new ErrorCompra(`El egreso ${transaccion.numero} solo tiene S/ ${disponible.toFixed(2)} sin aplicar.`);
                transaccionId = transaccion.id;
            } else if (origen === 'movimiento') {
                // Transferencia ya registrada en Control Bancario
                const mov = await tx.movimientoBancario.findUnique({ where: { id: Number(b.movimientoId) } });
                if (!mov || mov.estado === 'ANULADO' || mov.tipo !== 'EGRESO') throw new ErrorCompra('El movimiento bancario no existe, está anulado o no es un egreso.');
                if (mov.transaccionId) {
                    const { disponible } = await disponibleDeEgreso(tx, mov.transaccionId);
                    if (totalPen.gt(disponible)) throw new ErrorCompra(`Del movimiento ${mov.codigo} quedan S/ ${disponible.toFixed(2)} sin aplicar.`);
                    transaccionId = mov.transaccionId;
                } else {
                    if (totalPen.gt(mov.montoPen)) throw new ErrorCompra(`El pago (S/ ${totalPen.toFixed(2)}) supera el movimiento ${mov.codigo} (S/ ${mov.montoPen.toFixed(2)}).`);
                    // Se registra el egreso del negocio por el importe del movimiento, enlazado a él
                    const existentes = await tx.transaccion.findMany({ where: { numero: { startsWith: 'EGR-' } }, select: { numero: true } });
                    const t = await tx.transaccion.create({
                        data: {
                            numero: siguienteCorrelativo('EGR', existentes.map(e => e.numero)),
                            tipo: 'EGRESO', monto: Number(mov.montoPen), metodoPago: METODO_DESDE_BANCO[mov.metodo] || 'Transferencia',
                            concepto: `Pago a ${proveedor.razonSocial} (${mov.codigo})`.slice(0, 200), categoria: 'Pago a proveedor',
                            fecha: hoyLima(mov.fecha), hora: horaLima(mov.fecha), estado: 'COMPLETADO', clienteNombre: proveedor.razonSocial,
                            nota: `Facturas: ${referencias}`.slice(0, 500),
                        },
                    });
                    await tx.movimientoBancario.update({ where: { id: mov.id }, data: { transaccionId: t.id } });
                    transaccionId = t.id;
                }
            } else {
                // Pago nuevo: egreso en Caja y, si es transferencia/Yape/tarjeta, también en el banco
                const metodo = normalizarMetodoPago(String(b.metodoPago || ''));
                if (metodo === 'OTRO') throw new ErrorCompra('Elige el método de pago.');
                const existentes = await tx.transaccion.findMany({ where: { numero: { startsWith: 'EGR-' } }, select: { numero: true } });
                const t = await tx.transaccion.create({
                    data: {
                        numero: siguienteCorrelativo('EGR', existentes.map(e => e.numero)),
                        tipo: 'EGRESO', monto: Number(totalPen), metodoPago: ETIQUETA_METODO[metodo],
                        concepto: `Pago a ${proveedor.razonSocial}: ${referencias}`.slice(0, 200), categoria: 'Pago a proveedor',
                        fecha: hoyLima(), hora: horaLima(), estado: 'COMPLETADO', clienteNombre: proveedor.razonSocial,
                        nota: texto(b.nota, 500),
                    },
                });
                if (b.banco?.cuentaId) {
                    movimientoBancario = await registrarEnBanco(tx, req, {
                        transaccion: t, monto: Number(totalPen), metodo, concepto: `Pago a ${proveedor.razonSocial}: ${referencias}`.slice(0, 200),
                    }, b.banco);
                    // El proveedor queda identificado en el movimiento
                    movimientoBancario = await tx.movimientoBancario.update({
                        where: { id: movimientoBancario.id },
                        data: { contraparteNombre: proveedor.razonSocial, contraparteDoc: proveedor.ruc, referenciaTexto: referencias.slice(0, 120) },
                        select: { id: true, codigo: true, estado: true, requiereRevision: true },
                    });
                }
                transaccionId = t.id;
            }

            for (const l of lineas) {
                await tx.asignacionPago.create({
                    data: { documentoId: l.doc.id, transaccionId, monto: l.monto, montoPen: l.montoPen, responsable: quien(req) },
                });
                await recalcularEstadoPago(tx, l.doc.id);
            }
            return { transaccionId, movimientoBancario };
        });

        const documentos = await Promise.all(pedidos.map((p: any) => documentoCompleto(p.documentoId)));
        const transaccion = await prisma.transaccion.findUnique({ where: { id: resultado.transaccionId }, select: { id: true, numero: true, monto: true, metodoPago: true, fecha: true } });
        res.status(201).json({ transaccion, movimientoBancario: resultado.movimientoBancario, documentos });
    } catch (e) { responderError(res, e, 'registrar pago a proveedor'); }
};

export const anularAsignacion = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const motivo = texto(req.body?.motivo, 300);
        if (!motivo || motivo.length < 5) throw new ErrorCompra('Escribe el motivo (mínimo 5 caracteres).');
        const a = await prisma.asignacionPago.findUnique({ where: { id }, include: { transaccion: { select: { numero: true } } } });
        if (!a) return void res.status(404).json({ error: 'Pago no encontrado.' });
        if (a.estado === 'ANULADA') throw new ErrorCompra('Ya está anulado.', 409);
        await prisma.$transaction(async tx => {
            await tx.asignacionPago.update({ where: { id }, data: { estado: 'ANULADA', anuladaPor: quien(req), anuladaEn: new Date(), motivoAnulacion: motivo } });
            await recalcularEstadoPago(tx, a.documentoId);
        });
        res.json({
            documento: await documentoCompleto(a.documentoId),
            avisos: [`El egreso ${a.transaccion.numero} sigue registrado (y su movimiento bancario, si lo tiene): el importe queda disponible para aplicarlo a otra factura. Si el pago no se hizo, anúlalo en Caja o en Control Bancario.`],
        });
    } catch (e) { responderError(res, e, 'quitar pago de factura'); }
};

/** Egresos y movimientos bancarios con importe aún sin aplicar a facturas (para elegir en "pago ya registrado") */
export const pagosDisponibles = async (req: Request, res: Response) => {
    try {
        const desde = new Date(Date.now() - 120 * 86400000);
        const movimientos = await prisma.movimientoBancario.findMany({
            where: { tipo: 'EGRESO', estado: { not: 'ANULADO' }, fecha: { gte: desde } },
            select: { id: true, codigo: true, fecha: true, monto: true, moneda: true, montoPen: true, metodo: true, numeroOperacion: true, concepto: true, contraparteNombre: true, transaccionId: true, cuenta: { select: { nombre: true } } },
            orderBy: { fecha: 'desc' }, take: 300,
        });
        const egresos = await prisma.transaccion.findMany({
            where: { tipo: 'EGRESO', estado: 'COMPLETADO' }, orderBy: { id: 'desc' }, take: 300,
            select: { id: true, numero: true, fecha: true, monto: true, metodoPago: true, concepto: true, categoria: true, clienteNombre: true },
        });
        const usados = await prisma.asignacionPago.groupBy({
            by: ['transaccionId'], where: { estado: 'ACTIVA', transaccionId: { in: [...egresos.map(e => e.id), ...movimientos.map(m => m.transaccionId).filter((x): x is number => !!x)] } },
            _sum: { montoPen: true },
        });
        const usado = (tid: number | null) => (tid ? usados.find(u => u.transaccionId === tid)?._sum.montoPen ?? new D(0) : new D(0));
        const montoEgreso = new Map(egresos.map(e => [e.id, e.monto]));
        res.json({
            movimientos: movimientos
                .map(m => {
                    const base = m.transaccionId && montoEgreso.has(m.transaccionId) ? new D(montoEgreso.get(m.transaccionId)!) : m.montoPen;
                    return { ...m, disponiblePen: redondear2(base).sub(usado(m.transaccionId)).toFixed(2) };
                })
                .filter(m => new D(m.disponiblePen).gt(0)),
            egresos: egresos
                .map(e => ({ ...e, disponiblePen: redondear2(new D(e.monto)).sub(usado(e.id)).toFixed(2) }))
                .filter(e => new D(e.disponiblePen).gt(0)),
        });
    } catch (e) { responderError(res, e, 'pagos disponibles'); }
};

// ==========================================
// Cuentas por pagar
// ==========================================
export const cuentasPorPagar = async (req: Request, res: Response) => {
    try {
        const docs = await prisma.documentoCompra.findMany({
            where: { estado: 'ACTIVO', estadoPago: { not: 'PAGADO' }, ...(req.query.proveedorId ? { proveedorId: Number(req.query.proveedorId) } : {}) },
            include: incluirDocumento, orderBy: [{ fechaVencimiento: 'asc' }, { id: 'asc' }],
        });
        const pagados = await pagadosPorDocumento(docs.map(d => d.id));
        const lista = docs.map(d => conSaldo(d, pagados.get(d.id) ?? new D(0)));
        const { inicioDia } = rangosLima();
        const en7 = sumarDias(inicioDia, 7);
        const sumaPen = (xs: typeof lista) => xs.reduce((s, d) => s.add(d.moneda === 'PEN' ? new D(d.saldo) : d.total.gt(0) ? redondear2(new D(d.saldo).mul(d.totalPen).div(d.total)) : 0), new D(0)).toFixed(2);
        const vencidos = lista.filter(d => d.vencido);
        const porVencer = lista.filter(d => !d.vencido && d.fechaVencimiento && d.fechaVencimiento < en7);
        res.json({
            resumen: {
                documentos: lista.length, saldoPen: sumaPen(lista),
                vencidos: vencidos.length, saldoVencidoPen: sumaPen(vencidos),
                porVencer7Dias: porVencer.length, saldoPorVencerPen: sumaPen(porVencer),
            },
            documentos: lista,
        });
    } catch (e) { responderError(res, e, 'cuentas por pagar'); }
};

// ==========================================
// Resumen e historial
// ==========================================
export const resumenCompras = async (req: Request, res: Response) => {
    try {
        const { inicioMes, inicioMesSiguiente } = rangosLima();
        const delMes = { estado: 'ACTIVO', fechaEmision: { gte: inicioMes, lt: inicioMesSiguiente } } as const;
        const [mes, pendRevision, observados, pendContabilidad, pagadasMes, duplicados, porProveedor, lineasMes] = await Promise.all([
            prisma.documentoCompra.aggregate({ where: delMes, _count: true, _sum: { totalPen: true } }),
            prisma.documentoCompra.count({ where: { estado: 'ACTIVO', estadoRevision: 'PENDIENTE' } }),
            prisma.documentoCompra.count({ where: { estado: 'ACTIVO', estadoRevision: 'OBSERVADO' } }),
            prisma.documentoCompra.count({ where: { estado: 'ACTIVO', entregadoContabilidad: false } }),
            prisma.documentoCompra.count({ where: { ...delMes, estadoPago: 'PAGADO' } }),
            prisma.documentoCompra.aggregate({ where: { intentosDuplicado: { gt: 0 } }, _sum: { intentosDuplicado: true }, _count: true }),
            prisma.documentoCompra.groupBy({ by: ['proveedorId'], where: delMes, _sum: { totalPen: true }, _count: true, orderBy: { _sum: { totalPen: 'desc' } }, take: 8 }),
            prisma.detalleCompra.findMany({
                where: { documento: delMes },
                select: { descripcion: true, unidad: true, cantidad: true, total: true, productoId: true, documento: { select: { moneda: true, tipoCambio: true } } },
            }),
        ]);
        const proveedores = await prisma.proveedor.findMany({ where: { id: { in: porProveedor.map(p => p.proveedorId) } }, select: { id: true, razonSocial: true, ruc: true } });

        // Cuentas por pagar (saldo total y vencido)
        const abiertos = await prisma.documentoCompra.findMany({ where: { estado: 'ACTIVO', estadoPago: { not: 'PAGADO' } } });
        const pagados = await pagadosPorDocumento(abiertos.map(d => d.id));
        let saldoPen = new D(0), vencidoPen = new D(0), vencidos = 0;
        for (const d of abiertos) {
            const x = conSaldo(d, pagados.get(d.id) ?? new D(0));
            const s = d.moneda === 'PEN' ? new D(x.saldo) : d.total.gt(0) ? redondear2(new D(x.saldo).mul(d.totalPen).div(d.total)) : new D(0);
            saldoPen = saldoPen.add(s);
            if (x.vencido) { vencidos++; vencidoPen = vencidoPen.add(s); }
        }

        // Productos comprados en el mes (agrupados por descripción/producto)
        const productos = new Map<string, { descripcion: string; unidad: string; cantidad: Dec; totalPen: Dec; lineas: number }>();
        for (const l of lineasMes) {
            const clave = l.productoId ? `p${l.productoId}` : `${l.descripcion.toLowerCase()}|${l.unidad}`;
            const tpen = l.documento.moneda === 'USD' && l.documento.tipoCambio ? redondear2(l.total.mul(l.documento.tipoCambio)) : l.total;
            const p = productos.get(clave) ?? { descripcion: l.descripcion, unidad: l.unidad, cantidad: new D(0), totalPen: new D(0), lineas: 0 };
            p.cantidad = p.cantidad.add(l.cantidad); p.totalPen = p.totalPen.add(tpen); p.lineas++;
            productos.set(clave, p);
        }

        res.json({
            mes: { documentos: mes._count, totalPen: (mes._sum.totalPen ?? new D(0)).toFixed(2), pagados: pagadasMes },
            pendientesRevision: pendRevision,
            observados,
            pendientesPago: { documentos: abiertos.length, saldoPen: saldoPen.toFixed(2) },
            vencidos: { documentos: vencidos, saldoPen: vencidoPen.toFixed(2) },
            pendientesContabilidad: pendContabilidad,
            duplicadosDetectados: { comprobantes: duplicados._count, intentos: duplicados._sum.intentosDuplicado ?? 0 },
            porProveedor: porProveedor.map(p => ({
                proveedor: proveedores.find(x => x.id === p.proveedorId), documentos: p._count, totalPen: (p._sum.totalPen ?? new D(0)).toFixed(2),
            })),
            productosDelMes: {
                distintos: productos.size,
                principales: [...productos.values()].sort((a, b) => b.totalPen.cmp(a.totalPen)).slice(0, 8)
                    .map(p => ({ ...p, cantidad: p.cantidad.toString(), totalPen: p.totalPen.toFixed(2) })),
            },
        });
    } catch (e) { responderError(res, e, 'resumen de compras'); }
};

/** Historial de compras por producto/descripción, con estadísticas comparables (misma unidad) */
export const historialCompras = async (req: Request, res: Response) => {
    try {
        const q = texto(req.query.q, 100);
        const productoId = req.query.productoId ? Number(req.query.productoId) : null;
        const proveedorId = req.query.proveedorId ? Number(req.query.proveedorId) : null;
        const lineas = await prisma.detalleCompra.findMany({
            where: {
                documento: { estado: 'ACTIVO', ...(proveedorId ? { proveedorId } : {}) },
                ...(productoId ? { productoId } : {}),
                ...(q ? { OR: [{ descripcion: { contains: q, mode: 'insensitive' } }, { codigoProveedor: { contains: q, mode: 'insensitive' } }] } : {}),
            },
            include: {
                documento: { select: { id: true, codigo: true, tipo: true, serie: true, numero: true, fechaEmision: true, moneda: true, tipoCambio: true, proveedor: { select: { id: true, razonSocial: true, ruc: true } } } },
                producto: { select: { id: true, sku: true, nombre: true } },
            },
            orderBy: { documento: { fechaEmision: 'desc' } },
            take: 500,
        });
        // Costo unitario sin IGV en soles, con el descuento de la línea repartido
        const filas = lineas.map(l => {
            const neto = redondear2(l.cantidad.mul(l.valorUnitario)).sub(l.descuento);
            const unitario = l.cantidad.gt(0) ? neto.div(l.cantidad) : new D(0);
            const tc = l.documento.moneda === 'USD' && l.documento.tipoCambio ? l.documento.tipoCambio : new D(1);
            return {
                ...l, costoUnitario: unitario.toDecimalPlaces(4).toString(),
                costoUnitarioPen: unitario.mul(tc).toDecimalPlaces(4).toString(),
                costoUnitarioConIgvPen: (l.afectoIgv ? unitario.mul(1.18) : unitario).mul(tc).toDecimalPlaces(4).toString(),
            };
        });
        // Variación respecto de la compra anterior (misma unidad; se recorre de la más antigua a la más reciente)
        const ultimoPorUnidad = new Map<string, Dec>();
        const conVariacion = [...filas].reverse().map(f => {
            const clave = `${productoId ? '' : f.descripcion.toLowerCase()}|${f.unidad}`;
            const previo = ultimoPorUnidad.get(clave);
            const actual = new D(f.costoUnitarioPen);
            ultimoPorUnidad.set(clave, actual);
            return { ...f, variacionPct: previo && previo.gt(0) ? actual.sub(previo).div(previo).mul(100).toDecimalPlaces(1).toNumber() : null };
        }).reverse();

        // Estadísticas por unidad (solo se comparan precios de la misma unidad)
        const porUnidad = new Map<string, typeof conVariacion>();
        for (const f of conVariacion) porUnidad.set(f.unidad, [...(porUnidad.get(f.unidad) ?? []), f]);
        const estadisticas = [...porUnidad.entries()].map(([unidad, fs]) => {
            const costos = fs.map(f => new D(f.costoUnitarioPen));
            const suma = costos.reduce((s, c) => s.add(c), new D(0));
            const minimo = costos.reduce((m, c) => (c.lt(m) ? c : m), costos[0]);
            const maximo = costos.reduce((m, c) => (c.gt(m) ? c : m), costos[0]);
            const masBarata = fs.find(f => new D(f.costoUnitarioPen).eq(minimo))!;
            return {
                unidad, compras: fs.length,
                ultimoPen: costos[0].toDecimalPlaces(4).toString(),
                promedioPen: suma.div(costos.length).toDecimalPlaces(4).toString(),
                minimoPen: minimo.toDecimalPlaces(4).toString(),
                maximoPen: maximo.toDecimalPlaces(4).toString(),
                proveedorMasEconomico: masBarata.documento.proveedor,
            };
        });
        res.json({ lineas: conVariacion, estadisticas, nota: 'Costos unitarios sin IGV, en soles, con descuentos de línea. Solo se comparan compras con la misma unidad.' });
    } catch (e) { responderError(res, e, 'historial de compras'); }
};

export const catalogosCompras = (_req: Request, res: Response) => {
    res.json({ tipos: TIPOS_COMPROBANTE, condiciones: ['CONTADO', 'CREDITO'], monedas: ['PEN', 'USD'], igv: '0.18' });
};
