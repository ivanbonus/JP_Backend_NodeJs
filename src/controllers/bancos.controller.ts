import { Request, Response } from 'express';
import Busboy from 'busboy';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { ROLES } from '../auth/security';
import { registrarAuditoria, ipDe, quien } from '../auth/auditoria';
import { guardarArchivo, enlaceTemporal, ErrorArchivo, verificarConexion, driverActual } from '../storage/almacenamiento';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

// ==========================================
// Catálogos
// ==========================================
export const METODOS = ['TRANSFERENCIA', 'DEPOSITO', 'YAPE', 'PLIN', 'TARJETA', 'CHEQUE', 'OTRO'] as const;
export const CATEGORIAS = {
    INGRESO: ['Venta / servicio', 'Adelanto de cliente', 'Cobro de deuda', 'Préstamo recibido', 'Otros ingresos'],
    EGRESO: ['Pago a proveedor', 'Compra de repuestos', 'Planilla / personal', 'Servicios (luz, agua, internet)', 'Impuestos', 'Comisiones bancarias', 'Alquiler', 'Otros egresos'],
};
export const ESTADOS = ['PENDIENTE', 'CONCILIADO', 'DIFERENCIA', 'SIN_IDENTIFICAR', 'REQUIERE_REVISION', 'ANULADO'] as const;
const ENTIDAD_ARCHIVO = 'movimiento_bancario';
const MAX_ARCHIVO = 15 * 1024 * 1024;
const MAX_ARCHIVOS_POR_ENVIO = 5;

// ==========================================
// Utilidades
// ==========================================
class ErrorValidacion extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

/** Monto exacto con 2 decimales (nunca con números flotantes). */
const monto = (valor: unknown, campo = 'El monto'): Dec => {
    const texto = String(valor ?? '').trim().replace(/,/g, '');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(texto)) throw new ErrorValidacion(`${campo} no es válido (usa hasta 2 decimales).`);
    const d = new D(texto);
    if (d.lte(0)) throw new ErrorValidacion(`${campo} debe ser mayor que cero.`);
    return d;
};

const tipoCambio = (valor: unknown): Dec => {
    const texto = String(valor ?? '').trim().replace(/,/g, '');
    if (!/^\d{1,3}(\.\d{1,4})?$/.test(texto) || new D(texto).lte(0)) throw new ErrorValidacion('El tipo de cambio no es válido (hasta 4 decimales).');
    return new D(texto);
};

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '') || null;

const documento = (v: unknown) => {
    const t = texto(v, 15);
    if (!t) return null;
    if (!/^(\d{8}|\d{11}|[A-Z0-9]{6,15})$/i.test(t)) throw new ErrorValidacion('El documento debe ser un DNI (8 dígitos), RUC (11 dígitos) u otro documento válido.');
    return t.toUpperCase();
};

const fechaValida = (v: unknown): Date => {
    const d = v ? new Date(String(v)) : new Date();
    if (isNaN(d.getTime())) throw new ErrorValidacion('La fecha no es válida.');
    if (d.getTime() > Date.now() + 24 * 3600 * 1000) throw new ErrorValidacion('La fecha no puede estar en el futuro.');
    return d;
};

const umbralActual = async (): Promise<Dec> =>
    (await prisma.configuracion.findFirst({ select: { umbralRevision: true } }))?.umbralRevision ?? new D(2000);

/** Inicio del día y del mes en hora de Lima (UTC-5, sin horario de verano). */
const rangosLima = (ahora = new Date()) => {
    const lima = new Date(ahora.getTime() - 5 * 3600 * 1000);
    const y = lima.getUTCFullYear(), m = lima.getUTCMonth(), d = lima.getUTCDate();
    return {
        inicioDia: new Date(Date.UTC(y, m, d, 5)),
        inicioMes: new Date(Date.UTC(y, m, 1, 5)),
    };
};

const responderError = (res: Response, error: unknown, contexto: string) => {
    if (error instanceof ErrorValidacion || error instanceof ErrorArchivo) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ error: 'Ya existe un registro con esos datos (por ejemplo, el mismo n.º de operación en esta cuenta).' });
        return;
    }
    console.error(`Error en ${contexto}:`, error);
    res.status(500).json({ error: 'Error del servidor.' });
};

const baseUrl = (req: Request) => process.env.PUBLIC_API_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;

const enmascarar = (numero: string | null) => (numero ? `•••• ${numero.replace(/\s/g, '').slice(-4)}` : null);

// ==========================================
// Configuración / catálogos
// ==========================================
export const obtenerConfiguracion = async (req: Request, res: Response) => {
    try {
        res.json({
            metodos: METODOS,
            categorias: CATEGORIAS,
            estados: ESTADOS,
            umbralRevision: await umbralActual(),
            almacenamiento: await verificarConexion(),
        });
    } catch (e) { responderError(res, e, 'configuración bancaria'); }
};

export const actualizarUmbral = async (req: Request, res: Response) => {
    try {
        const valor = monto(req.body?.umbralRevision, 'El umbral');
        await prisma.configuracion.updateMany({ data: { umbralRevision: valor } });
        res.json({ umbralRevision: valor });
    } catch (e) { responderError(res, e, 'umbral'); }
};

// ==========================================
// Cuentas bancarias
// ==========================================
const cuentaPublica = (c: any) => ({ ...c, numeroMascara: enmascarar(c.numero) });

export const listarCuentas = async (req: Request, res: Response) => {
    try {
        const cuentas = await prisma.cuentaBancaria.findMany({ orderBy: [{ activa: 'desc' }, { nombre: 'asc' }] });
        res.json(cuentas.map(cuentaPublica));
    } catch (e) { responderError(res, e, 'listar cuentas'); }
};

const datosCuenta = (b: any) => {
    const nombre = texto(b?.nombre, 80);
    if (!nombre) throw new ErrorValidacion('El nombre de la cuenta es obligatorio.');
    const moneda = b?.moneda === 'USD' ? 'USD' : 'PEN';
    const tipo = ['CORRIENTE', 'AHORROS', 'BILLETERA'].includes(b?.tipo) ? b.tipo : 'CORRIENTE';
    const numero = texto(b?.numero, 30)?.replace(/[^\d-]/g, '') || null;
    const cci = texto(b?.cci, 30)?.replace(/\D/g, '') || null;
    if (cci && cci.length !== 20) throw new ErrorValidacion('El CCI debe tener 20 dígitos.');
    const saldo = b?.saldoInicial === undefined || b?.saldoInicial === '' ? new D(0) : (() => {
        const t = String(b.saldoInicial).replace(/,/g, '').trim();
        if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(t)) throw new ErrorValidacion('El saldo inicial no es válido.');
        return new D(t);
    })();
    return {
        banco: texto(b?.banco, 40) || 'BCP',
        nombre, tipo, moneda, numero, cci,
        saldoInicial: saldo,
        fechaSaldoInicial: b?.fechaSaldoInicial ? fechaValida(b.fechaSaldoInicial) : null,
    };
};

export const crearCuenta = async (req: Request, res: Response) => {
    try {
        const cuenta = await prisma.cuentaBancaria.create({ data: datosCuenta(req.body) });
        res.status(201).json(cuentaPublica(cuenta));
    } catch (e) { responderError(res, e, 'crear cuenta'); }
};

export const actualizarCuenta = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const actual = await prisma.cuentaBancaria.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Cuenta no encontrada.' });
        const datos = datosCuenta({ ...actual, ...req.body });
        // La moneda no se cambia si ya hay movimientos (alteraría los montos registrados)
        if (datos.moneda !== actual.moneda && (await prisma.movimientoBancario.count({ where: { cuentaId: id } }))) {
            throw new ErrorValidacion('No se puede cambiar la moneda de una cuenta que ya tiene movimientos.');
        }
        const cuenta = await prisma.cuentaBancaria.update({
            where: { id },
            data: { ...datos, ...(req.body?.activa !== undefined ? { activa: Boolean(req.body.activa) } : {}) },
        });
        res.json(cuentaPublica(cuenta));
    } catch (e) { responderError(res, e, 'actualizar cuenta'); }
};

// ==========================================
// Movimientos
// ==========================================
const incluirMovimiento = {
    cuenta: { select: { id: true, nombre: true, banco: true, moneda: true, numero: true } },
    cliente: { select: { id: true, nombre: true, apellidos: true, documento: true } },
    transaccion: { select: { id: true, numero: true, concepto: true, monto: true, estado: true, tipo: true } },
    numeroGuia: { select: { id: true } },
} as const;

/** Agrega a cada movimiento sus archivos (comprobantes) y si supera el umbral */
const conArchivos = async <T extends { id: number }>(movs: T[]) => {
    const archivos = movs.length
        ? await prisma.archivo.findMany({
            where: { entidad: ENTIDAD_ARCHIVO, entidadId: { in: movs.map(m => m.id) }, eliminado: false },
            select: { id: true, nombre: true, mime: true, tamano: true, subidoPor: true, subidoEn: true, entidadId: true },
            orderBy: { subidoEn: 'asc' },
        })
        : [];
    return movs.map(m => {
        const propios = archivos.filter(a => a.entidadId === m.id).map(({ entidadId, ...a }) => a);
        return { ...m, archivos: propios, cantidadArchivos: propios.length };
    });
};

const filtrosMovimientos = async (q: Record<string, any>): Promise<Prisma.MovimientoBancarioWhereInput> => {
    const where: Prisma.MovimientoBancarioWhereInput = {};
    const y: Prisma.MovimientoBancarioWhereInput[] = [];
    if (q.cuentaId) where.cuentaId = Number(q.cuentaId);
    if (q.tipo === 'INGRESO' || q.tipo === 'EGRESO') where.tipo = q.tipo;
    if (q.estado && (ESTADOS as readonly string[]).includes(q.estado)) where.estado = q.estado;
    else if (q.incluirAnulados !== '1') where.estado = { not: 'ANULADO' };
    if (q.metodo) where.metodo = String(q.metodo);
    if (q.responsable) where.responsable = { contains: String(q.responsable), mode: 'insensitive' };
    if (q.desde || q.hasta) {
        const fecha: Prisma.DateTimeFilter = {};
        if (q.desde && !isNaN(Date.parse(q.desde))) fecha.gte = new Date(`${String(q.desde).slice(0, 10)}T05:00:00.000Z`);
        if (q.hasta && !isNaN(Date.parse(q.hasta))) fecha.lt = new Date(new Date(`${String(q.hasta).slice(0, 10)}T05:00:00.000Z`).getTime() + 24 * 3600 * 1000);
        where.fecha = fecha;
    }
    if (q.montoMin || q.montoMax) {
        const f: Prisma.DecimalFilter = {};
        if (q.montoMin && !isNaN(Number(q.montoMin))) f.gte = new D(String(q.montoMin));
        if (q.montoMax && !isNaN(Number(q.montoMax))) f.lte = new D(String(q.montoMax));
        where.montoPen = f;
    }
    if (q.revision === 'pendiente') { where.requiereRevision = true; where.revisionEstado = { in: ['PENDIENTE', 'OBSERVADO'] }; }
    if (q.revision === 'todas') where.requiereRevision = true;
    if (q.q) {
        const t = String(q.q).trim();
        const or: Prisma.MovimientoBancarioWhereInput[] = [
            { codigo: { contains: t, mode: 'insensitive' } },
            { numeroOperacion: { contains: t, mode: 'insensitive' } },
            { contraparteNombre: { contains: t, mode: 'insensitive' } },
            { contraparteDoc: { contains: t } },
            { concepto: { contains: t, mode: 'insensitive' } },
            { referenciaTexto: { contains: t, mode: 'insensitive' } },
        ];
        const num = t.replace(/,/g, '');
        if (/^\d+(\.\d{1,2})?$/.test(num)) or.push({ monto: new D(num) });
        y.push({ OR: or });
    }
    if (q.sinComprobante === '1') {
        const conArchivo = await prisma.archivo.findMany({ where: { entidad: ENTIDAD_ARCHIVO, eliminado: false }, select: { entidadId: true }, distinct: ['entidadId'] });
        y.push({ id: { notIn: conArchivo.map(a => a.entidadId) } });
    }
    if (y.length) where.AND = y;
    return where;
};

export const listarMovimientos = async (req: Request, res: Response) => {
    try {
        const pagina = Math.max(1, Number(req.query.pagina) || 1);
        const porPagina = Math.min(100, Math.max(10, Number(req.query.porPagina) || 30));
        const where = await filtrosMovimientos(req.query);
        const [total, movimientos] = await Promise.all([
            prisma.movimientoBancario.count({ where }),
            prisma.movimientoBancario.findMany({
                where, include: incluirMovimiento,
                orderBy: [{ fecha: 'desc' }, { id: 'desc' }],
                skip: (pagina - 1) * porPagina, take: porPagina,
            }),
        ]);
        res.json({ total, pagina, porPagina, movimientos: await conArchivos(movimientos) });
    } catch (e) { responderError(res, e, 'listar movimientos'); }
};

export const obtenerMovimiento = async (req: Request, res: Response) => {
    try {
        const m = await prisma.movimientoBancario.findUnique({ where: { id: Number(req.params.id) }, include: incluirMovimiento });
        if (!m) return void res.status(404).json({ error: 'Movimiento no encontrado.' });
        res.json((await conArchivos([m]))[0]);
    } catch (e) { responderError(res, e, 'obtener movimiento'); }
};

/** Valida y arma los datos de un movimiento (crear o editar). */
const prepararMovimiento = async (b: any, actual?: { id: number }) => {
    const tipo = b?.tipo === 'EGRESO' ? 'EGRESO' : b?.tipo === 'INGRESO' ? 'INGRESO' : null;
    if (!tipo) throw new ErrorValidacion('Indica si es un ingreso o un egreso.');
    const cuentaId = Number(b?.cuentaId);
    const cuenta = Number.isInteger(cuentaId) ? await prisma.cuentaBancaria.findUnique({ where: { id: cuentaId } }) : null;
    if (!cuenta) throw new ErrorValidacion('Selecciona la cuenta bancaria.');
    if (!cuenta.activa && !actual) throw new ErrorValidacion('La cuenta está desactivada.');
    const metodo = String(b?.metodo || '').toUpperCase();
    if (!(METODOS as readonly string[]).includes(metodo)) throw new ErrorValidacion('Selecciona el método de pago.');
    const concepto = texto(b?.concepto, 200);
    if (!concepto) throw new ErrorValidacion('Escribe el concepto del movimiento.');

    const m = monto(b?.monto);
    let tc: Dec | null = null;
    let montoPen = m;
    if (cuenta.moneda === 'USD') {
        tc = tipoCambio(b?.tipoCambio);
        montoPen = m.mul(tc).toDecimalPlaces(2, D.ROUND_HALF_UP);
    }

    const categorias = (CATEGORIAS as any)[tipo] as string[];
    const categoria = categorias.includes(b?.categoria) ? b.categoria : categorias[categorias.length - 1];

    // Referencias opcionales (venta/egreso, cliente, orden de trabajo)
    let transaccionId: number | null = null;
    if (b?.transaccionId) {
        const t = await prisma.transaccion.findUnique({ where: { id: Number(b.transaccionId) } });
        if (!t || t.estado === 'ANULADO') throw new ErrorValidacion('La venta/egreso de referencia no existe o está anulada.');
        transaccionId = t.id;
        // Un pago no puede exceder el monto de la venta (sumando otros movimientos ya enlazados)
        const otros = await prisma.movimientoBancario.aggregate({
            where: { transaccionId: t.id, estado: { not: 'ANULADO' }, ...(actual ? { id: { not: actual.id } } : {}) },
            _sum: { montoPen: true },
        });
        const total = (otros._sum.montoPen ?? new D(0)).add(montoPen);
        if (total.gt(new D(t.monto).add(0.01))) {
            throw new ErrorValidacion(`Los pagos enlazados (S/ ${total.toFixed(2)}) superarían el monto de ${t.numero} (S/ ${new D(t.monto).toFixed(2)}).`);
        }
    }
    const clienteId = b?.clienteId ? Number(b.clienteId) : null;
    if (clienteId && !(await prisma.cliente.findUnique({ where: { id: clienteId } }))) throw new ErrorValidacion('El cliente no existe.');
    const numeroGuiaId = b?.numeroGuiaId ? Number(b.numeroGuiaId) : null;
    if (numeroGuiaId && !(await prisma.numeroGuia.findUnique({ where: { id: numeroGuiaId } }))) throw new ErrorValidacion('La orden de trabajo no existe.');

    const contraparteNombre = texto(b?.contraparteNombre, 120);
    const contraparteDoc = documento(b?.contraparteDoc);

    return {
        tipo, cuentaId, metodo, concepto, categoria,
        monto: m, moneda: cuenta.moneda, tipoCambio: tc, montoPen,
        fecha: fechaValida(b?.fecha),
        numeroOperacion: texto(b?.numeroOperacion, 40)?.replace(/\s/g, '') || null,
        contraparteNombre, contraparteDoc, clienteId, transaccionId, numeroGuiaId,
        referenciaTexto: texto(b?.referenciaTexto, 120),
        observaciones: texto(b?.observaciones, 1000),
    };
};

export const crearMovimiento = async (req: Request, res: Response) => {
    try {
        const datos = await prepararMovimiento(req.body);
        const umbral = await umbralActual();
        const requiereRevision = datos.montoPen.gt(umbral);
        // Ingreso sin saber quién lo depositó → "sin identificar"
        const estado = datos.tipo === 'INGRESO' && !datos.contraparteNombre && !datos.clienteId ? 'SIN_IDENTIFICAR' : 'PENDIENTE';

        const creado = await prisma.$transaction(async tx => {
            const temporal = await tx.movimientoBancario.create({
                data: {
                    ...datos,
                    codigo: `TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    responsable: quien(req),
                    estado,
                    requiereRevision,
                    revisionEstado: requiereRevision ? 'PENDIENTE' : null,
                },
            });
            return tx.movimientoBancario.update({
                where: { id: temporal.id },
                data: { codigo: `MB-${datos.fecha.getUTCFullYear()}-${String(temporal.id).padStart(6, '0')}` },
                include: incluirMovimiento,
            });
        });

        res.status(201).json({
            ...(await conArchivos([creado]))[0],
            aviso: requiereRevision
                ? `Operación mayor a S/ ${umbral.toFixed(2)}: queda en revisión administrativa. Identifica la contraparte y adjunta el comprobante.`
                : null,
        });
    } catch (e) { responderError(res, e, 'crear movimiento'); }
};

export const actualizarMovimiento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const actual = await prisma.movimientoBancario.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Movimiento no encontrado.' });
        if (actual.estado === 'ANULADO') throw new ErrorValidacion('El movimiento está anulado.');

        // Conciliado: solo se pueden cambiar las observaciones
        if (actual.estado === 'CONCILIADO') {
            const m = await prisma.movimientoBancario.update({
                where: { id }, data: { observaciones: texto(req.body?.observaciones, 1000) }, include: incluirMovimiento,
            });
            return void res.json((await conArchivos([m]))[0]);
        }

        const datos = await prepararMovimiento({ ...actual, ...req.body, monto: req.body?.monto ?? actual.monto.toString(), tipoCambio: req.body?.tipoCambio ?? actual.tipoCambio?.toString() }, actual);
        const umbral = await umbralActual();
        const requiereRevision = datos.montoPen.gt(umbral);
        const montoCambio = !datos.montoPen.equals(actual.montoPen);
        let estado = actual.estado;
        if (estado === 'SIN_IDENTIFICAR' && (datos.contraparteNombre || datos.clienteId)) estado = 'PENDIENTE';
        if (estado === 'PENDIENTE' && datos.tipo === 'INGRESO' && !datos.contraparteNombre && !datos.clienteId) estado = 'SIN_IDENTIFICAR';

        const m = await prisma.movimientoBancario.update({
            where: { id },
            data: {
                ...datos,
                estado,
                requiereRevision,
                // Si cambió el monto, una revisión anterior ya no vale
                revisionEstado: requiereRevision ? (montoCambio || !actual.revisionEstado ? 'PENDIENTE' : actual.revisionEstado) : null,
                ...(montoCambio ? { revisadoPor: null, revisadoEn: null } : {}),
            },
            include: incluirMovimiento,
        });
        res.json((await conArchivos([m]))[0]);
    } catch (e) { responderError(res, e, 'actualizar movimiento'); }
};

export const anularMovimiento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const motivo = texto(req.body?.motivo, 300);
        if (!motivo || motivo.length < 5) throw new ErrorValidacion('Escribe el motivo de la anulación (mínimo 5 caracteres).');
        const actual = await prisma.movimientoBancario.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Movimiento no encontrado.' });
        if (actual.estado === 'ANULADO') throw new ErrorValidacion('El movimiento ya está anulado.');
        // Si estaba vinculado a una línea del extracto, la línea vuelve a quedar pendiente
        await prisma.lineaExtracto.updateMany({
            where: { movimientoId: id },
            data: { movimientoId: null, estado: 'PENDIENTE', formaConciliacion: null, conciliadoPor: null, conciliadoEn: null, notaConciliacion: null },
        });
        const m = await prisma.movimientoBancario.update({
            where: { id },
            data: { estado: 'ANULADO', anuladoPor: quien(req), anuladoEn: new Date(), motivoAnulacion: motivo },
            include: incluirMovimiento,
        });
        res.json((await conArchivos([m]))[0]);
    } catch (e) { responderError(res, e, 'anular movimiento'); }
};

/** Revisión administrativa de operaciones mayores al umbral. */
export const revisarMovimiento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const resultado = req.body?.resultado;
        const nota = texto(req.body?.nota, 500);
        if (resultado !== 'REVISADO' && resultado !== 'OBSERVADO') throw new ErrorValidacion('Indica el resultado de la revisión.');
        const actual = await prisma.movimientoBancario.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Movimiento no encontrado.' });
        if (!actual.requiereRevision) throw new ErrorValidacion('Este movimiento no requiere revisión administrativa.');
        if (actual.estado === 'ANULADO') throw new ErrorValidacion('El movimiento está anulado.');

        if (resultado === 'REVISADO') {
            if (!actual.contraparteNombre || !actual.contraparteDoc) {
                throw new ErrorValidacion('Para aprobar la revisión identifica a la contraparte (nombre y DNI/RUC).');
            }
            const evidencias = await prisma.archivo.count({ where: { entidad: ENTIDAD_ARCHIVO, entidadId: id, eliminado: false } });
            if (!evidencias) throw new ErrorValidacion('Para aprobar la revisión adjunta al menos un comprobante.');
        } else if (!nota) {
            throw new ErrorValidacion('Escribe qué se observó.');
        }

        const m = await prisma.movimientoBancario.update({
            where: { id },
            data: { revisionEstado: resultado, revisadoPor: quien(req), revisadoEn: new Date(), notaRevision: nota },
            include: incluirMovimiento,
        });
        res.json((await conArchivos([m]))[0]);
    } catch (e) { responderError(res, e, 'revisar movimiento'); }
};

/**
 * Conciliación manual: solo cuando se verificó en el extracto/banca por internet.
 * Un comprobante (captura) por sí solo NO concilia un movimiento.
 */
export const conciliarMovimiento = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        const conciliar = req.body?.conciliado !== false;
        const actual = await prisma.movimientoBancario.findUnique({ where: { id } });
        if (!actual) return void res.status(404).json({ error: 'Movimiento no encontrado.' });
        if (actual.estado === 'ANULADO') throw new ErrorValidacion('El movimiento está anulado.');

        let data: Prisma.MovimientoBancarioUpdateInput;
        if (conciliar) {
            const verificacion = texto(req.body?.verificacion, 300);
            if (!verificacion || verificacion.length < 5) {
                throw new ErrorValidacion('Indica dónde verificaste el movimiento (p. ej. "Extracto BCP octubre, línea del 15/10").');
            }
            if (actual.estado === 'SIN_IDENTIFICAR') throw new ErrorValidacion('Primero identifica quién hizo el depósito.');
            data = {
                estado: 'CONCILIADO', fechaConciliacion: new Date(),
                observaciones: [actual.observaciones, `Conciliado manualmente por ${quien(req)}: ${verificacion}`].filter(Boolean).join('\n'),
            };
        } else {
            data = { estado: actual.contraparteNombre || actual.clienteId || actual.tipo === 'EGRESO' ? 'PENDIENTE' : 'SIN_IDENTIFICAR', fechaConciliacion: null };
        }
        const m = await prisma.movimientoBancario.update({ where: { id }, data, include: incluirMovimiento });
        res.json((await conArchivos([m]))[0]);
    } catch (e) { responderError(res, e, 'conciliar movimiento'); }
};

// ==========================================
// Comprobantes (archivos)
// ==========================================
export const subirComprobantes = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const movimiento = await prisma.movimientoBancario.findUnique({ where: { id } }).catch(() => null);
    if (!movimiento) return void res.status(404).json({ error: 'Movimiento no encontrado.' });
    if (movimiento.estado === 'ANULADO') return void res.status(400).json({ error: 'El movimiento está anulado.' });
    if (!req.is('multipart/form-data')) return void res.status(400).json({ error: 'Envía los archivos como formulario (multipart/form-data).' });

    const guardados: any[] = [];
    const avisos: string[] = [];
    let busboy: Busboy.Busboy;
    try {
        busboy = Busboy({ headers: req.headers, limits: { files: MAX_ARCHIVOS_POR_ENVIO, fileSize: MAX_ARCHIVO + 1, fields: 5 } });
    } catch {
        return void res.status(400).json({ error: 'Formulario no válido.' });
    }

    const tareas: Promise<void>[] = [];
    let errorEnvio: unknown = null;

    busboy.on('file', (_campo, flujo, info) => {
        tareas.push((async () => {
            try {
                const nombre = (info.filename || 'comprobante').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
                const g = await guardarArchivo(flujo, { carpeta: 'bancos', maxBytes: MAX_ARCHIVO });
                // ¿Es el mismo archivo que ya está en otro movimiento? (posible comprobante duplicado)
                const igual = await prisma.archivo.findFirst({ where: { sha256: g.sha256, eliminado: false, entidad: ENTIDAD_ARCHIVO } });
                if (igual?.entidadId === id) {
                    avisos.push(`"${nombre}" ya estaba adjunto a este movimiento.`);
                    return;
                }
                if (igual) {
                    const otro = await prisma.movimientoBancario.findUnique({ where: { id: igual.entidadId }, select: { codigo: true } });
                    avisos.push(`Atención: "${nombre}" es idéntico al comprobante del movimiento ${otro?.codigo ?? igual.entidadId}. Revisa si es un pago duplicado.`);
                }
                const a = await prisma.archivo.create({
                    data: { ...g, nombre, entidad: ENTIDAD_ARCHIVO, entidadId: id, subidoPor: quien(req) },
                    select: { id: true, nombre: true, mime: true, tamano: true, subidoPor: true, subidoEn: true },
                });
                guardados.push(a);
            } catch (e) {
                flujo.resume();
                errorEnvio ??= e;
            }
        })());
    });
    busboy.on('filesLimit', () => { errorEnvio ??= new ErrorValidacion(`Máximo ${MAX_ARCHIVOS_POR_ENVIO} archivos por envío.`); });
    busboy.on('error', e => { errorEnvio ??= e; });
    busboy.on('close', async () => {
        await Promise.allSettled(tareas);
        if (!guardados.length) {
            return responderError(res, errorEnvio ?? new ErrorValidacion('No se recibió ningún archivo.'), 'subir comprobantes');
        }
        void registrarAuditoria({
            cuenta: quien(req), rol: req.usuario?.rol, accion: 'COMPROBANTE_SUBIDO', entidad: 'bancos', entidadId: id,
            ip: ipDe(req), detalle: { archivos: guardados.map(g => g.nombre), movimiento: movimiento.codigo },
        });
        res.status(201).json({ archivos: guardados, avisos, error: errorEnvio instanceof Error ? errorEnvio.message : undefined });
    });
    req.pipe(busboy);
};

export const enlaceArchivo = async (req: Request, res: Response) => {
    try {
        const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
        if (!a || a.eliminado) return void res.status(404).json({ error: 'Archivo no encontrado.' });
        const url = await enlaceTemporal(a, baseUrl(req), req.query.descargar === '1');
        res.json({ url, nombre: a.nombre, mime: a.mime, expiraEnSegundos: 300 });
    } catch (e) { responderError(res, e, 'enlace de archivo'); }
};

/** Quita un comprobante (borrado lógico: el archivo se conserva en el almacenamiento). Solo administrador. */
export const quitarArchivo = async (req: Request, res: Response) => {
    try {
        if (req.usuario?.rol !== ROLES.ADMIN) return void res.status(403).json({ error: 'No tienes permisos.' });
        const a = await prisma.archivo.findUnique({ where: { id: Number(req.params.id) } });
        if (!a || a.eliminado) return void res.status(404).json({ error: 'Archivo no encontrado.' });
        if (a.entidad === ENTIDAD_ARCHIVO) {
            const m = await prisma.movimientoBancario.findUnique({ where: { id: a.entidadId }, select: { estado: true, revisionEstado: true } });
            if (m?.estado === 'CONCILIADO' || m?.revisionEstado === 'REVISADO') {
                throw new ErrorValidacion('No se puede quitar el comprobante de un movimiento conciliado o ya revisado.');
            }
        }
        await prisma.archivo.update({ where: { id: a.id }, data: { eliminado: true, eliminadoPor: quien(req), eliminadoEn: new Date() } });
        res.json({ ok: true });
    } catch (e) { responderError(res, e, 'quitar archivo'); }
};

// ==========================================
// Resumen (dashboard bancario)
// ==========================================
const sumar = async (where: Prisma.MovimientoBancarioWhereInput) =>
    (await prisma.movimientoBancario.aggregate({ where, _sum: { montoPen: true }, _count: true }));

export const resumenBancario = async (req: Request, res: Response) => {
    try {
        const { inicioDia, inicioMes } = rangosLima();
        const cuentaId = req.query.cuentaId ? Number(req.query.cuentaId) : undefined;
        const base: Prisma.MovimientoBancarioWhereInput = { estado: { not: 'ANULADO' }, ...(cuentaId ? { cuentaId } : {}) };
        const umbral = await umbralActual();

        const [ingHoy, egrHoy, ingMes, egrMes, pendientes, sinIdentificar, revision, mayores] = await Promise.all([
            sumar({ ...base, tipo: 'INGRESO', fecha: { gte: inicioDia } }),
            sumar({ ...base, tipo: 'EGRESO', fecha: { gte: inicioDia } }),
            sumar({ ...base, tipo: 'INGRESO', fecha: { gte: inicioMes } }),
            sumar({ ...base, tipo: 'EGRESO', fecha: { gte: inicioMes } }),
            sumar({ ...base, estado: { in: ['PENDIENTE', 'DIFERENCIA', 'REQUIERE_REVISION'] } }),
            sumar({ ...base, estado: 'SIN_IDENTIFICAR' }),
            sumar({ ...base, requiereRevision: true, revisionEstado: { in: ['PENDIENTE', 'OBSERVADO'] } }),
            sumar({ ...base, requiereRevision: true, fecha: { gte: inicioMes } }),
        ]);

        // Movimientos sin comprobante
        const conArchivo = await prisma.archivo.findMany({ where: { entidad: ENTIDAD_ARCHIVO, eliminado: false }, select: { entidadId: true }, distinct: ['entidadId'] });
        const sinComprobante = await prisma.movimientoBancario.count({ where: { ...base, id: { notIn: conArchivo.map(a => a.entidadId) } } });

        // Saldos por cuenta (en la moneda de la cuenta)
        const cuentas = await prisma.cuentaBancaria.findMany({ where: { activa: true }, orderBy: { nombre: 'asc' } });
        const grupos = await prisma.movimientoBancario.groupBy({
            by: ['cuentaId', 'tipo', 'estado'],
            where: { estado: { not: 'ANULADO' } },
            _sum: { monto: true },
        });
        const saldos = cuentas.map(c => {
            let registrado = new D(c.saldoInicial);
            let conciliado = new D(c.saldoInicial);
            for (const g of grupos.filter(g => g.cuentaId === c.id)) {
                const v = g._sum.monto ?? new D(0);
                const signo = g.tipo === 'INGRESO' ? 1 : -1;
                registrado = registrado.add(v.mul(signo));
                if (g.estado === 'CONCILIADO') conciliado = conciliado.add(v.mul(signo));
            }
            return { cuentaId: c.id, nombre: c.nombre, banco: c.banco, moneda: c.moneda, numeroMascara: enmascarar(c.numero), saldoRegistrado: registrado, saldoConciliado: conciliado };
        });

        const cero = new D(0);
        res.json({
            umbralRevision: umbral,
            hoy: { ingresos: ingHoy._sum.montoPen ?? cero, egresos: egrHoy._sum.montoPen ?? cero, cantidad: ingHoy._count + egrHoy._count },
            mes: { ingresos: ingMes._sum.montoPen ?? cero, egresos: egrMes._sum.montoPen ?? cero, cantidad: ingMes._count + egrMes._count },
            pendientesConciliacion: { cantidad: pendientes._count, monto: pendientes._sum.montoPen ?? cero },
            sinIdentificar: { cantidad: sinIdentificar._count, monto: sinIdentificar._sum.montoPen ?? cero },
            revisionPendiente: { cantidad: revision._count, monto: revision._sum.montoPen ?? cero },
            mayoresUmbralMes: { cantidad: mayores._count, monto: mayores._sum.montoPen ?? cero },
            sinComprobante,
            saldos,
            almacenamiento: driverActual(),
        });
    } catch (e) { responderError(res, e, 'resumen bancario'); }
};

// ==========================================
// Exportación a Excel
// ==========================================
export const exportarMovimientos = async (req: Request, res: Response) => {
    try {
        const where = await filtrosMovimientos({ ...req.query, incluirAnulados: req.query.incluirAnulados ?? '1' });
        const total = await prisma.movimientoBancario.count({ where });
        if (total > 20000) throw new ErrorValidacion('Demasiados movimientos para exportar. Acota el rango de fechas.');

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="movimientos-bancarios-${new Date().toISOString().slice(0, 10)}.xlsx"`);

        const libro = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true });
        const hoja = libro.addWorksheet('Movimientos');
        hoja.columns = [
            { header: 'Código', key: 'codigo', width: 16 },
            { header: 'Fecha', key: 'fecha', width: 18 },
            { header: 'Tipo', key: 'tipo', width: 10 },
            { header: 'Cuenta', key: 'cuenta', width: 22 },
            { header: 'Método', key: 'metodo', width: 14 },
            { header: 'N.º operación', key: 'numeroOperacion', width: 16 },
            { header: 'Contraparte', key: 'contraparte', width: 28 },
            { header: 'DNI/RUC', key: 'doc', width: 14 },
            { header: 'Concepto', key: 'concepto', width: 34 },
            { header: 'Categoría', key: 'categoria', width: 22 },
            { header: 'Moneda', key: 'moneda', width: 8 },
            { header: 'Monto', key: 'monto', width: 14, style: { numFmt: '#,##0.00' } },
            { header: 'T. cambio', key: 'tc', width: 10, style: { numFmt: '0.0000' } },
            { header: 'Monto S/', key: 'montoPen', width: 14, style: { numFmt: '#,##0.00' } },
            { header: 'Estado', key: 'estado', width: 16 },
            { header: 'Revisión', key: 'revision', width: 12 },
            { header: 'Comprobantes', key: 'comprobantes', width: 12 },
            { header: 'Responsable', key: 'responsable', width: 22 },
            { header: 'Referencia', key: 'referencia', width: 18 },
        ];
        hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1F2E' } };
        hoja.getRow(1).commit();

        // Por lotes, para no cargar todo en memoria
        for (let salto = 0; salto < total; salto += 500) {
            const lote = await conArchivos(await prisma.movimientoBancario.findMany({
                where, include: incluirMovimiento, orderBy: [{ fecha: 'asc' }, { id: 'asc' }], skip: salto, take: 500,
            }));
            for (const m of lote) {
                hoja.addRow({
                    codigo: m.codigo,
                    fecha: new Date(m.fecha.getTime() - 5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 16),
                    tipo: m.tipo, cuenta: m.cuenta.nombre, metodo: m.metodo, numeroOperacion: m.numeroOperacion ?? '',
                    contraparte: m.contraparteNombre ?? (m.cliente ? `${m.cliente.nombre} ${m.cliente.apellidos ?? ''}`.trim() : ''),
                    doc: m.contraparteDoc ?? '', concepto: m.concepto, categoria: m.categoria, moneda: m.moneda,
                    monto: Number(m.monto), tc: m.tipoCambio ? Number(m.tipoCambio) : null, montoPen: Number(m.montoPen),
                    estado: m.estado, revision: m.requiereRevision ? (m.revisionEstado ?? '') : '',
                    comprobantes: m.cantidadArchivos, responsable: m.responsable,
                    referencia: m.transaccion?.numero ?? m.referenciaTexto ?? '',
                }).commit();
            }
        }
        hoja.commit();
        await libro.commit();
        void registrarAuditoria({ cuenta: quien(req), rol: req.usuario?.rol, accion: 'EXPORTAR', entidad: 'bancos', ip: ipDe(req), detalle: { registros: total } });
    } catch (e) {
        if (!res.headersSent) responderError(res, e, 'exportar movimientos');
        else res.end();
    }
};
