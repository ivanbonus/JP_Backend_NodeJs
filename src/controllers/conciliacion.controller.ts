import { Request, Response } from 'express';
import crypto from 'crypto';
import { Readable } from 'stream';
import Busboy from 'busboy';
import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';
import { quien, registrarAuditoria, ipDe } from '../auth/auditoria';
import { guardarArchivo, ErrorArchivo } from '../storage/almacenamiento';
import { leerTabla, sugerirMapeo, leerLineas, normalizarOperacion, ErrorExtracto, Mapeo } from '../utils/extracto';
import { CATEGORIAS, METODOS } from './bancos.controller';

/**
 * Conciliación bancaria con extractos (Fase 2B).
 * - Coincidencia EXACTA (mismo n.º de operación, misma cuenta, mismo tipo): se concilia sola si el monto coincide,
 *   o se marca DIFERENCIA si el monto no coincide.
 * - Coincidencias aproximadas (mismo monto y fecha cercana): se muestran como SUGERENCIAS para aprobación humana.
 * - La importación NUNCA crea ventas ni ingresos: solo líneas del extracto.
 */
const D = Prisma.Decimal;
const MAX_EXTRACTO = 5 * 1024 * 1024;
const DIA = 24 * 3600 * 1000;

class ErrorConciliacion extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

const responderError = (res: Response, error: unknown, contexto: string) => {
    if (error instanceof ErrorConciliacion || error instanceof ErrorExtracto || error instanceof ErrorArchivo) {
        res.status(error.status).json({ error: error.message });
        return;
    }
    console.error(`Error en ${contexto}:`, error);
    res.status(500).json({ error: 'Error del servidor.' });
};

// ==========================================
// Lectura del formulario (archivo pequeño en memoria + campos)
// ==========================================
const leerFormulario = (req: Request): Promise<{ archivo: Buffer; nombre: string; campos: Record<string, string> }> =>
    new Promise((resolve, reject) => {
        if (!req.is('multipart/form-data')) return reject(new ErrorConciliacion('Envía el extracto como archivo.'));
        let busboy: Busboy.Busboy;
        try {
            busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_EXTRACTO + 1, fields: 10 } });
        } catch {
            return reject(new ErrorConciliacion('Formulario no válido.'));
        }
        const campos: Record<string, string> = {};
        const partes: Buffer[] = [];
        let nombre = 'extracto';
        let excedido = false;
        busboy.on('field', (k, v) => { campos[k] = v; });
        busboy.on('file', (_c, flujo, info) => {
            nombre = (info.filename || 'extracto').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
            flujo.on('data', (d: Buffer) => partes.push(d));
            flujo.on('limit', () => { excedido = true; });
        });
        busboy.on('error', reject);
        busboy.on('close', () => {
            if (excedido) return reject(new ErrorConciliacion('El extracto supera 5 MB. Exporta un rango de fechas más corto.', 413));
            const archivo = Buffer.concat(partes);
            if (!archivo.length) return reject(new ErrorConciliacion('No se recibió el archivo del extracto.'));
            resolve({ archivo, nombre, campos });
        });
        req.pipe(busboy);
    });

const cuentaDe = async (id: unknown) => {
    const cuenta = Number.isInteger(Number(id)) ? await prisma.cuentaBancaria.findUnique({ where: { id: Number(id) } }) : null;
    if (!cuenta) throw new ErrorConciliacion('Selecciona la cuenta bancaria del extracto.');
    return cuenta;
};

const mapeoValido = (valor: unknown): Mapeo => {
    const m = typeof valor === 'string' ? JSON.parse(valor) : valor;
    const campos: (keyof Mapeo)[] = ['filaEncabezado', 'fecha', 'descripcion', 'monto', 'cargo', 'abono', 'numeroOperacion', 'saldo'];
    const r: any = {};
    for (const c of campos) {
        const n = Number(m?.[c]);
        r[c] = Number.isInteger(n) && n >= -1 && n < 200 ? n : -1;
    }
    if (r.filaEncabezado < 0) throw new ErrorConciliacion('Falta la fila de encabezados.');
    return r as Mapeo;
};

// ==========================================
// 1. Vista previa: columnas detectadas y primeras filas
// ==========================================
export const previsualizarExtracto = async (req: Request, res: Response) => {
    try {
        const { archivo, nombre, campos } = await leerFormulario(req);
        const cuenta = await cuentaDe(campos.cuentaId);
        const filas = await leerTabla(archivo, nombre);
        let mapeo = sugerirMapeo(filas);
        if (campos.mapeo) {
            // El usuario corrigió las columnas: se muestra la interpretación con su selección
            mapeo = mapeoValido(campos.mapeo);
        } else {
            // Si la cuenta ya tiene un mapeo guardado y los encabezados coinciden, se reutiliza
            const guardado = cuenta.mapeoExtracto as any;
            if (guardado?.encabezados && JSON.stringify(guardado.encabezados) === JSON.stringify(filas[mapeo.filaEncabezado])) {
                mapeo = mapeoValido(guardado.mapeo);
            }
        }
        const { lineas, errores } = leerLineas(filas, mapeo);
        res.json({
            nombre,
            encabezados: filas[mapeo.filaEncabezado],
            mapeo,
            filasMuestra: filas.slice(mapeo.filaEncabezado + 1, mapeo.filaEncabezado + 9),
            lineasMuestra: lineas.slice(0, 8),
            totalLineas: lineas.length,
            errores: errores.slice(0, 20),
            totalErrores: errores.length,
        });
    } catch (e) {
        if (e instanceof SyntaxError) return void res.status(400).json({ error: 'Mapeo de columnas no válido.' });
        responderError(res, e, 'previsualizar extracto');
    }
};

// ==========================================
// 2. Importar: guarda líneas (sin duplicar) y concilia lo exacto
// ==========================================
export const importarExtracto = async (req: Request, res: Response) => {
    try {
        const { archivo, nombre, campos } = await leerFormulario(req);
        const cuenta = await cuentaDe(campos.cuentaId);
        const filas = await leerTabla(archivo, nombre);
        const mapeo = campos.mapeo ? mapeoValido(campos.mapeo) : sugerirMapeo(filas);
        const { lineas, errores } = leerLineas(filas, mapeo);
        if (!lineas.length) throw new ErrorConciliacion(errores.length ? `No se pudo leer ninguna línea. ${errores.slice(0, 3).join(' ')}` : 'El extracto no tiene movimientos.');

        const sha256 = crypto.createHash('sha256').update(archivo).digest('hex');
        const previo = await prisma.extractoBancario.findUnique({ where: { cuentaId_sha256: { cuentaId: cuenta.id, sha256 } } });
        if (previo) {
            throw new ErrorConciliacion(`Este mismo archivo ya se importó el ${previo.importadoEn.toLocaleDateString('es-PE', { timeZone: 'America/Lima' })}.`, 409);
        }

        // Guardar el archivo original (si el almacenamiento está disponible)
        let archivoId: number | null = null;
        let avisoArchivo: string | null = null;
        try {
            const esExcel = archivo.subarray(0, 2).toString('latin1') === 'PK';
            const g = await guardarArchivo(Readable.from(archivo), {
                carpeta: 'extractos', maxBytes: MAX_EXTRACTO,
                tipo: esExcel
                    ? { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' }
                    : { mime: 'text/csv', ext: /<table/i.test(archivo.subarray(0, 4096).toString('latin1')) ? 'html' : 'csv' },
            });
            archivoId = (await prisma.archivo.create({
                data: { ...g, nombre, entidad: 'extracto_bancario', entidadId: 0, subidoPor: quien(req) },
            })).id;
        } catch (e) {
            avisoArchivo = e instanceof ErrorArchivo ? `El archivo original no se guardó: ${e.message}` : 'El archivo original no se pudo guardar.';
        }

        const fechas = lineas.map(l => l.fecha.getTime());
        const extracto = await prisma.$transaction(async tx => {
            const ex = await tx.extractoBancario.create({
                data: {
                    cuentaId: cuenta.id, nombreArchivo: nombre, archivoId, sha256,
                    desde: new Date(Math.min(...fechas)), hasta: new Date(Math.max(...fechas)),
                    lineasTotales: lineas.length, importadoPor: quien(req),
                },
            });
            const creadas = await tx.lineaExtracto.createMany({
                data: lineas.map(l => ({
                    extractoId: ex.id, cuentaId: cuenta.id, fecha: l.fecha, descripcion: l.descripcion, tipo: l.tipo,
                    monto: l.monto, numeroOperacion: l.numeroOperacion, saldo: l.saldo, huella: l.huella,
                })),
                skipDuplicates: true, // líneas que ya vinieron en otro extracto (períodos que se solapan)
            });
            return tx.extractoBancario.update({
                where: { id: ex.id },
                data: { lineasNuevas: creadas.count, lineasRepetidas: lineas.length - creadas.count },
            });
        });
        if (archivoId) await prisma.archivo.update({ where: { id: archivoId }, data: { entidadId: extracto.id } });

        // Recordar el mapeo para la próxima importación de esta cuenta
        await prisma.cuentaBancaria.update({
            where: { id: cuenta.id },
            data: { mapeoExtracto: { encabezados: filas[mapeo.filaEncabezado], mapeo } as any },
        });

        const auto = await conciliarAutomaticamente(cuenta.id, quien(req));
        void registrarAuditoria({
            cuenta: quien(req), rol: req.usuario?.rol, accion: 'EXTRACTO_IMPORTADO', entidad: 'bancos', entidadId: extracto.id, ip: ipDe(req),
            detalle: { cuenta: cuenta.nombre, archivo: nombre, nuevas: extracto.lineasNuevas, repetidas: extracto.lineasRepetidas, conciliadas: auto.conciliadas },
        });

        res.status(201).json({
            extracto,
            lineasLeidas: lineas.length,
            lineasNuevas: extracto.lineasNuevas,
            lineasRepetidas: extracto.lineasRepetidas,
            conciliadasAutomaticamente: auto.conciliadas,
            conDiferencia: auto.diferencias,
            erroresLectura: errores.slice(0, 20),
            avisoArchivo,
        });
    } catch (e) {
        if (e instanceof SyntaxError) return void res.status(400).json({ error: 'Mapeo de columnas no válido.' });
        responderError(res, e, 'importar extracto');
    }
};

// ==========================================
// Conciliación automática (solo coincidencias exactas por n.º de operación)
// ==========================================
export const conciliarAutomaticamente = async (cuentaId: number, usuario: string) => {
    const lineas = await prisma.lineaExtracto.findMany({
        where: { cuentaId, movimientoId: null, estado: { in: ['PENDIENTE', 'SIN_IDENTIFICAR'] }, numeroOperacion: { not: null } },
    });
    const movimientos = await prisma.movimientoBancario.findMany({
        where: { cuentaId, estado: { notIn: ['ANULADO', 'CONCILIADO'] }, numeroOperacion: { not: null }, lineaExtracto: null },
    });
    const porOperacion = new Map<string, typeof movimientos>();
    for (const m of movimientos) {
        const k = `${m.tipo}|${normalizarOperacion(m.numeroOperacion)}`;
        porOperacion.set(k, [...(porOperacion.get(k) ?? []), m]);
    }

    let conciliadas = 0, diferencias = 0;
    const usados = new Set<number>();
    for (const l of lineas) {
        const candidatos = (porOperacion.get(`${l.tipo}|${normalizarOperacion(l.numeroOperacion)}`) ?? []).filter(m => !usados.has(m.id));
        if (candidatos.length !== 1) continue; // 0: no hay; 2+: ambiguo (se revisa a mano)
        const m = candidatos[0];
        usados.add(m.id);
        const igual = new D(m.monto).equals(l.monto);
        await prisma.$transaction([
            prisma.lineaExtracto.update({
                where: { id: l.id },
                data: {
                    movimientoId: m.id, estado: igual ? 'CONCILIADO' : 'DIFERENCIA', formaConciliacion: 'AUTOMATICA',
                    conciliadoPor: usuario, conciliadoEn: new Date(),
                    notaConciliacion: igual ? null : `Monto en banco ${l.monto.toFixed(2)} distinto de registrado ${new D(m.monto).toFixed(2)}`,
                },
            }),
            prisma.movimientoBancario.update({
                where: { id: m.id },
                data: igual ? { estado: 'CONCILIADO', fechaConciliacion: new Date() } : { estado: 'DIFERENCIA' },
            }),
        ]);
        igual ? conciliadas++ : diferencias++;
    }

    // Líneas del banco que no tienen ni siquiera un candidato aproximado → "sin identificar" (no registradas en el sistema)
    const pendientes = await prisma.lineaExtracto.findMany({ where: { cuentaId, movimientoId: null, estado: { in: ['PENDIENTE', 'SIN_IDENTIFICAR'] } } });
    for (const l of pendientes) {
        const hay = await prisma.movimientoBancario.count({
            where: {
                cuentaId, tipo: l.tipo, monto: l.monto, estado: { notIn: ['ANULADO', 'CONCILIADO'] }, lineaExtracto: null,
                fecha: { gte: new Date(l.fecha.getTime() - 7 * DIA), lte: new Date(l.fecha.getTime() + 7 * DIA) },
            },
        });
        const estado = hay ? 'PENDIENTE' : 'SIN_IDENTIFICAR';
        if (estado !== l.estado) await prisma.lineaExtracto.update({ where: { id: l.id }, data: { estado } });
    }
    return { conciliadas, diferencias };
};

// ==========================================
// 3. Estado de la conciliación de una cuenta (con sugerencias)
// ==========================================
const normal = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const puntuar = (l: { fecha: Date; monto: Prisma.Decimal; descripcion: string; numeroOperacion: string | null }, m: any) => {
    const motivos: string[] = [];
    let puntos = 0;
    if (new D(m.monto).equals(l.monto)) { puntos += 60; motivos.push('mismo monto'); }
    const dias = Math.abs(l.fecha.getTime() - new Date(m.fecha).getTime()) / DIA;
    if (dias <= 1) { puntos += 25; motivos.push('misma fecha'); }
    else if (dias <= 3) { puntos += 15; motivos.push(`${Math.round(dias)} días de diferencia`); }
    else if (dias <= 7) { puntos += 5; motivos.push(`${Math.round(dias)} días de diferencia`); }
    const desc = normal(l.descripcion);
    const contraparte = normal(m.contraparteNombre);
    if (contraparte && contraparte.split(' ').filter((p: string) => p.length > 3).some((p: string) => desc.includes(p))) { puntos += 15; motivos.push('nombre en la descripción'); }
    const opL = normalizarOperacion(l.numeroOperacion), opM = normalizarOperacion(m.numeroOperacion);
    if (opL && opM && (opL.endsWith(opM) || opM.endsWith(opL))) { puntos += 20; motivos.push('n.º de operación parecido'); }
    return { puntos, motivos };
};

export const estadoConciliacion = async (req: Request, res: Response) => {
    try {
        const cuenta = await cuentaDe(req.query.cuentaId);
        const desde = req.query.desde ? new Date(`${String(req.query.desde).slice(0, 10)}T05:00:00Z`) : undefined;
        const hasta = req.query.hasta ? new Date(new Date(`${String(req.query.hasta).slice(0, 10)}T05:00:00Z`).getTime() + DIA) : undefined;
        const rango = desde || hasta ? { ...(desde ? { gte: desde } : {}), ...(hasta ? { lt: hasta } : {}) } : undefined;

        const [abiertas, conciliadas, extractos] = await Promise.all([
            prisma.lineaExtracto.findMany({
                where: { cuentaId: cuenta.id, estado: { in: ['PENDIENTE', 'SIN_IDENTIFICAR', 'DIFERENCIA'] }, ...(rango ? { fecha: rango } : {}) },
                include: { movimiento: { select: { id: true, codigo: true, monto: true, fecha: true, concepto: true, contraparteNombre: true } } },
                orderBy: { fecha: 'asc' },
            }),
            prisma.lineaExtracto.findMany({
                where: { cuentaId: cuenta.id, estado: { in: ['CONCILIADO', 'IGNORADO'] }, ...(rango ? { fecha: rango } : {}) },
                include: { movimiento: { select: { id: true, codigo: true, concepto: true } } },
                orderBy: { fecha: 'desc' }, take: 200,
            }),
            prisma.extractoBancario.findMany({ where: { cuentaId: cuenta.id }, orderBy: { importadoEn: 'desc' }, take: 20 }),
        ]);

        // Período cubierto por los extractos importados
        const cobertura = await prisma.lineaExtracto.aggregate({ where: { cuentaId: cuenta.id }, _min: { fecha: true }, _max: { fecha: true } });
        const libres = await prisma.movimientoBancario.findMany({
            where: { cuentaId: cuenta.id, estado: { notIn: ['ANULADO', 'CONCILIADO'] }, lineaExtracto: null },
            select: { id: true, codigo: true, fecha: true, tipo: true, monto: true, moneda: true, numeroOperacion: true, concepto: true, contraparteNombre: true, estado: true },
            orderBy: { fecha: 'asc' },
        });

        // Sugerencias para cada línea abierta sin vínculo
        const lineas = abiertas.map(l => {
            if (l.movimientoId) return { ...l, sugerencias: [] };
            const sugerencias = libres
                .filter(m => m.tipo === l.tipo)
                .map(m => ({ movimiento: m, ...puntuar(l, m) }))
                .filter(s => s.puntos >= 60)
                .sort((a, b) => b.puntos - a.puntos)
                .slice(0, 3);
            return { ...l, sugerencias };
        });

        // Movimientos registrados en el sistema que NO aparecen en el banco (dentro del período cubierto)
        const min = cobertura._min.fecha, max = cobertura._max.fecha;
        const noEnBanco = min && max
            ? libres.filter(m => m.fecha.getTime() >= min.getTime() - DIA && m.fecha.getTime() <= max.getTime() + DIA)
            : [];

        // Posibles duplicados registrados: mismo tipo, monto y día
        const grupos = new Map<string, typeof libres>();
        for (const m of libres) {
            const k = `${m.tipo}|${new D(m.monto).toFixed(2)}|${new Date(m.fecha.getTime() - 5 * 3600 * 1000).toISOString().slice(0, 10)}`;
            grupos.set(k, [...(grupos.get(k) ?? []), m]);
        }
        const posiblesDuplicados = [...grupos.values()].filter(g => g.length > 1);

        res.json({
            cuenta: { id: cuenta.id, nombre: cuenta.nombre, moneda: cuenta.moneda },
            cobertura: { desde: min, hasta: max },
            resumen: {
                pendientes: lineas.filter(l => l.estado === 'PENDIENTE').length,
                sinIdentificar: lineas.filter(l => l.estado === 'SIN_IDENTIFICAR').length,
                diferencias: lineas.filter(l => l.estado === 'DIFERENCIA').length,
                conciliadas: await prisma.lineaExtracto.count({ where: { cuentaId: cuenta.id, estado: 'CONCILIADO' } }),
                noEnBanco: noEnBanco.length,
                posiblesDuplicados: posiblesDuplicados.length,
            },
            lineas,
            noEnBanco,
            posiblesDuplicados,
            conciliadas,
            extractos,
            mapeoGuardado: (cuenta.mapeoExtracto as any)?.mapeo ?? null,
        });
    } catch (e) { responderError(res, e, 'estado de conciliación'); }
};

// ==========================================
// 4. Acciones manuales
// ==========================================
const lineaDe = async (id: unknown) => {
    const l = Number.isInteger(Number(id)) ? await prisma.lineaExtracto.findUnique({ where: { id: Number(id) } }) : null;
    if (!l) throw new ErrorConciliacion('Línea del extracto no encontrada.', 404);
    return l;
};

/** Vincular una línea del banco con un movimiento registrado (aprobar una sugerencia o elegir a mano). */
export const vincular = async (req: Request, res: Response) => {
    try {
        const l = await lineaDe(req.body?.lineaId);
        const m = await prisma.movimientoBancario.findUnique({ where: { id: Number(req.body?.movimientoId) }, include: { lineaExtracto: true } });
        if (!m) throw new ErrorConciliacion('Movimiento no encontrado.', 404);
        if (l.movimientoId) throw new ErrorConciliacion('Esa línea del banco ya está vinculada.');
        if (m.lineaExtracto) throw new ErrorConciliacion(`El movimiento ${m.codigo} ya está vinculado a otra línea del banco.`);
        if (m.estado === 'ANULADO') throw new ErrorConciliacion('El movimiento está anulado.');
        if (m.cuentaId !== l.cuentaId) throw new ErrorConciliacion('La línea y el movimiento son de cuentas distintas.');
        if (m.tipo !== l.tipo) throw new ErrorConciliacion('Uno es ingreso y el otro egreso.');

        const igual = new D(m.monto).equals(l.monto);
        if (!igual && req.body?.aceptarDiferencia !== true) {
            return void res.status(409).json({
                error: `Los montos no coinciden (banco ${l.monto.toFixed(2)} / registrado ${new D(m.monto).toFixed(2)}). Confirma para marcarlo como diferencia.`,
                diferencia: l.monto.sub(m.monto).toFixed(2),
            });
        }
        const nota = typeof req.body?.nota === 'string' ? req.body.nota.trim().slice(0, 300) : null;
        await prisma.$transaction([
            prisma.lineaExtracto.update({
                where: { id: l.id },
                data: {
                    movimientoId: m.id, estado: igual ? 'CONCILIADO' : 'DIFERENCIA', formaConciliacion: 'MANUAL',
                    conciliadoPor: quien(req), conciliadoEn: new Date(),
                    notaConciliacion: nota ?? (igual ? null : `Monto en banco ${l.monto.toFixed(2)} distinto de registrado ${new D(m.monto).toFixed(2)}`),
                },
            }),
            prisma.movimientoBancario.update({
                where: { id: m.id },
                data: igual ? { estado: 'CONCILIADO', fechaConciliacion: new Date() } : { estado: 'DIFERENCIA', fechaConciliacion: null },
            }),
        ]);
        res.json({ ok: true, estado: igual ? 'CONCILIADO' : 'DIFERENCIA' });
    } catch (e) { responderError(res, e, 'vincular'); }
};

/** Deshacer un vínculo (vuelven a quedar pendientes). */
export const desvincular = async (req: Request, res: Response) => {
    try {
        const l = await lineaDe(req.body?.lineaId);
        if (!l.movimientoId) throw new ErrorConciliacion('La línea no está vinculada.');
        const m = await prisma.movimientoBancario.findUnique({ where: { id: l.movimientoId } });
        await prisma.$transaction([
            prisma.lineaExtracto.update({ where: { id: l.id }, data: { movimientoId: null, estado: 'PENDIENTE', formaConciliacion: null, conciliadoPor: null, conciliadoEn: null, notaConciliacion: null } }),
            prisma.movimientoBancario.update({
                where: { id: l.movimientoId },
                data: { estado: m && m.tipo === 'INGRESO' && !m.contraparteNombre && !m.clienteId ? 'SIN_IDENTIFICAR' : 'PENDIENTE', fechaConciliacion: null },
            }),
        ]);
        res.json({ ok: true });
    } catch (e) { responderError(res, e, 'desvincular'); }
};

/** Registrar en el sistema un movimiento que está en el banco pero no se había anotado (p. ej. comisiones). */
export const registrarDesdeLinea = async (req: Request, res: Response) => {
    try {
        const l = await lineaDe(req.body?.lineaId);
        if (l.movimientoId) throw new ErrorConciliacion('Esa línea ya está vinculada.');
        const cuenta = await cuentaDe(l.cuentaId);
        if (cuenta.moneda === 'USD' && !req.body?.tipoCambio) throw new ErrorConciliacion('En cuentas en dólares indica el tipo de cambio.');
        const concepto = (typeof req.body?.concepto === 'string' && req.body.concepto.trim()) || l.descripcion;
        const metodo = (METODOS as readonly string[]).includes(req.body?.metodo) ? req.body.metodo : 'TRANSFERENCIA';
        const categorias = (CATEGORIAS as any)[l.tipo] as string[];
        const categoria = categorias.includes(req.body?.categoria) ? req.body.categoria : categorias[categorias.length - 1];
        const tc = cuenta.moneda === 'USD' ? new D(String(req.body.tipoCambio)) : null;
        const montoPen = tc ? l.monto.mul(tc).toDecimalPlaces(2, D.ROUND_HALF_UP) : l.monto;
        const umbral = (await prisma.configuracion.findFirst({ select: { umbralRevision: true } }))?.umbralRevision ?? new D(2000);
        const contraparteNombre = typeof req.body?.contraparteNombre === 'string' ? req.body.contraparteNombre.trim().slice(0, 120) || null : null;

        const creado = await prisma.$transaction(async tx => {
            const tmp = await tx.movimientoBancario.create({
                data: {
                    codigo: `TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    fecha: l.fecha, tipo: l.tipo, cuentaId: l.cuentaId, metodo, monto: l.monto, moneda: cuenta.moneda,
                    tipoCambio: tc, montoPen, numeroOperacion: l.numeroOperacion, concepto: concepto.slice(0, 200), categoria,
                    contraparteNombre, responsable: quien(req), estado: 'CONCILIADO', fechaConciliacion: new Date(),
                    requiereRevision: montoPen.gt(umbral), revisionEstado: montoPen.gt(umbral) ? 'PENDIENTE' : null,
                    observaciones: 'Registrado desde el extracto bancario.',
                },
            });
            await tx.lineaExtracto.update({
                where: { id: l.id },
                data: { movimientoId: tmp.id, estado: 'CONCILIADO', formaConciliacion: 'MANUAL', conciliadoPor: quien(req), conciliadoEn: new Date(), notaConciliacion: 'Registrado desde el extracto' },
            });
            return tx.movimientoBancario.update({ where: { id: tmp.id }, data: { codigo: `MB-${l.fecha.getUTCFullYear()}-${String(tmp.id).padStart(6, '0')}` } });
        });
        res.status(201).json(creado);
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return void res.status(409).json({ error: 'Ya existe un movimiento con ese n.º de operación en esta cuenta: vincúlalo en lugar de crear otro.' });
        }
        responderError(res, e, 'registrar desde línea');
    }
};

/** Ignorar una línea que no corresponde conciliar (p. ej. traspaso entre cuentas propias), con motivo. */
export const ignorarLinea = async (req: Request, res: Response) => {
    try {
        const l = await lineaDe(req.body?.lineaId);
        const reactivar = req.body?.ignorar === false;
        if (l.movimientoId) throw new ErrorConciliacion('Primero desvincula la línea.');
        const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 300) : '';
        if (!reactivar && motivo.length < 5) throw new ErrorConciliacion('Escribe el motivo (mínimo 5 caracteres).');
        await prisma.lineaExtracto.update({
            where: { id: l.id },
            data: reactivar
                ? { estado: 'PENDIENTE', notaConciliacion: null, conciliadoPor: null, conciliadoEn: null }
                : { estado: 'IGNORADO', notaConciliacion: motivo, conciliadoPor: quien(req), conciliadoEn: new Date() },
        });
        if (reactivar) await conciliarAutomaticamente(l.cuentaId, quien(req));
        res.json({ ok: true });
    } catch (e) { responderError(res, e, 'ignorar línea'); }
};

/** Volver a ejecutar la conciliación automática (por ejemplo, después de registrar movimientos que faltaban). */
export const reconciliar = async (req: Request, res: Response) => {
    try {
        const cuenta = await cuentaDe(req.body?.cuentaId);
        res.json(await conciliarAutomaticamente(cuenta.id, quien(req)));
    } catch (e) { responderError(res, e, 'reconciliar'); }
};
