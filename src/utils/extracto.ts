import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';

/**
 * Lectura de extractos bancarios (BCP u otros) en Excel (.xlsx), CSV o "xls" en formato HTML.
 * Como cada banco exporta columnas distintas, la lectura usa un MAPEO de columnas
 * (sugerido automáticamente y corregible por el usuario).
 */
const D = Prisma.Decimal;

export class ErrorExtracto extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

export interface Mapeo {
    filaEncabezado: number;   // índice (0-based) de la fila de encabezados
    fecha: number;            // índices de columna (0-based); -1 = no existe
    descripcion: number;
    monto: number;            // monto con signo (abono +, cargo −)…
    cargo: number;            // …o columnas separadas de cargo y abono
    abono: number;
    numeroOperacion: number;
    saldo: number;
}

export interface LineaLeida {
    fila: number;             // fila del archivo (1-based), para mensajes
    fecha: Date;
    descripcion: string;
    tipo: 'INGRESO' | 'EGRESO';
    monto: Prisma.Decimal;
    numeroOperacion: string | null;
    saldo: Prisma.Decimal | null;
    huella: string;
}

// ==========================================
// 1. Archivo → tabla de textos
// ==========================================
const quitarEtiquetas = (html: string) =>
    html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\s+/g, ' ').trim();

const leerHtml = (texto: string): string[][] => {
    const filas: string[][] = [];
    for (const tr of texto.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
        filas.push((tr.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(quitarEtiquetas));
    }
    return filas;
};

const leerCsv = (texto: string): string[][] => {
    const lineas = texto.replace(/^﻿/, '').split(/\r?\n/);
    const muestra = lineas.slice(0, 20).join('\n');
    const separador = [';', ',', '\t', '|'].map(s => ({ s, n: muestra.split(s).length })).sort((a, b) => b.n - a.n)[0].s;
    const filas: string[][] = [];
    let actual: string[] = [];
    let campo = '';
    let comillas = false;
    const t = texto.replace(/^﻿/, '');
    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (comillas) {
            if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
            else if (c === '"') comillas = false;
            else campo += c;
        } else if (c === '"') comillas = true;
        else if (c === separador) { actual.push(campo.trim()); campo = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && t[i + 1] === '\n') i++;
            actual.push(campo.trim()); filas.push(actual); actual = []; campo = '';
        } else campo += c;
    }
    if (campo || actual.length) { actual.push(campo.trim()); filas.push(actual); }
    return filas;
};

const textoCelda = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
        // Excel guarda la fecha "local" como UTC: se conserva el día tal cual
        return `${String(v.getUTCDate()).padStart(2, '0')}/${String(v.getUTCMonth() + 1).padStart(2, '0')}/${v.getUTCFullYear()}`;
    }
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object') {
        if ('richText' in v) return v.richText.map(r => r.text).join('').trim();
        if ('text' in v) return String((v as any).text).trim();
        if ('result' in v) return textoCelda((v as any).result);
    }
    return String(v).trim();
};

export const leerTabla = async (buffer: Buffer, nombre: string): Promise<string[][]> => {
    if (buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
        throw new ErrorExtracto('Este Excel es de formato antiguo (.xls). Ábrelo y guárdalo como ".xlsx" o CSV, y vuelve a subirlo.');
    }
    if (buffer.subarray(0, 2).toString('latin1') === 'PK') {
        const libro = new ExcelJS.Workbook();
        try { await libro.xlsx.load(buffer as any); } catch { throw new ErrorExtracto('No se pudo leer el archivo de Excel.'); }
        const hoja = libro.worksheets.find(h => h.rowCount > 0);
        if (!hoja) throw new ErrorExtracto('El Excel no tiene datos.');
        const filas: string[][] = [];
        hoja.eachRow({ includeEmpty: true }, fila => {
            const valores = (fila.values as ExcelJS.CellValue[]).slice(1);
            filas.push(valores.map(textoCelda));
        });
        return filas;
    }
    let texto = buffer.toString('utf8');
    if (texto.includes('�')) texto = buffer.toString('latin1'); // archivos guardados en Windows-1252
    if (/<table[\s>]/i.test(texto)) return leerHtml(texto);
    if (/\0/.test(texto)) throw new ErrorExtracto('Formato no reconocido. Usa Excel (.xlsx) o CSV.');
    return leerCsv(texto);
};

// ==========================================
// 2. Detección de encabezados y mapeo sugerido
// ==========================================
const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const PALABRAS = ['fecha', 'descripcion', 'detalle', 'concepto', 'monto', 'importe', 'cargo', 'abono', 'operacion', 'saldo', 'referencia'];

export const detectarEncabezado = (filas: string[][]): number => {
    let mejor = -1, puntaje = 0;
    filas.slice(0, 40).forEach((f, i) => {
        const p = f.filter(c => PALABRAS.some(w => normalizar(c).includes(w))).length;
        if (p > puntaje) { puntaje = p; mejor = i; }
    });
    if (puntaje < 2) throw new ErrorExtracto('No se encontró la fila de encabezados (Fecha, Descripción, Monto…). Revisa que sea el extracto de movimientos.');
    return mejor;
};

export const sugerirMapeo = (filas: string[][]): Mapeo => {
    const filaEncabezado = detectarEncabezado(filas);
    const enc = filas[filaEncabezado].map(normalizar);
    const buscar = (pruebas: ((h: string) => boolean)[]) => {
        for (const p of pruebas) { const i = enc.findIndex(p); if (i >= 0) return i; }
        return -1;
    };
    return {
        filaEncabezado,
        fecha: buscar([h => h === 'fecha', h => h.startsWith('fecha') && !h.includes('valuta') && !h.includes('proceso'), h => h.includes('fecha')]),
        descripcion: buscar([h => h.includes('descripcion'), h => h.includes('detalle'), h => h.includes('concepto'), h => h.includes('glosa')]),
        monto: buscar([h => h === 'monto' || h.startsWith('monto'), h => h.includes('importe')]),
        cargo: buscar([h => h.includes('cargo'), h => h.includes('debito') || h.includes('debe')]),
        abono: buscar([h => h.includes('abono'), h => h.includes('credito') || h.includes('haber')]),
        // "Operación - Número", "Nro. Operación", "N° de operación"… pero NO "Descripción operación"
        numeroOperacion: buscar([
            h => h.includes('operacion') && /\b(numero|nro|num|no)\b/.test(h) && !h.includes('descripcion'),
            h => /^n (de )?operacion$/.test(h),
            h => h === 'operacion',
            h => h.includes('referencia') && !h.includes('descripcion'),
            h => h.includes('documento'),
        ]),
        saldo: buscar([h => h.includes('saldo')]),
    };
};

// ==========================================
// 3. Valores: montos y fechas en formatos peruanos
// ==========================================
/** "S/ 1,234.56", "-1,234.56", "(1,234.56)", "1.234,56" → Decimal con signo, o null si está vacío. */
export const leerMonto = (valor: string): Prisma.Decimal | null => {
    let t = (valor || '').replace(/S\/\.?|US\$|\$|PEN|USD|\s/gi, '');
    if (!t || t === '-') return null;
    let negativo = false;
    if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
    if (t.endsWith('-')) { negativo = true; t = t.slice(0, -1); }
    if (t.startsWith('-')) { negativo = !negativo; t = t.slice(1); }
    if (t.startsWith('+')) t = t.slice(1);
    // Formato con coma decimal (1.234,56) frente a punto decimal (1,234.56)
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) throw new ErrorExtracto(`Monto no reconocido: "${valor}"`);
    const d = new D(t).toDecimalPlaces(2, D.ROUND_HALF_UP);
    return negativo ? d.neg() : d;
};

/** Fecha a las 12:00 de Lima (evita que el día cambie por la zona horaria). */
export const leerFecha = (valor: string): Date | null => {
    const t = (valor || '').trim();
    if (!t) return null;
    let d: number, m: number, y: number;
    let r = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(t);
    if (r) { d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000; }
    else if ((r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) { y = +r[1]; m = +r[2]; d = +r[3]; }
    else if (/^\d{5}(\.\d+)?$/.test(t)) {
        // Número de serie de Excel (días desde 1899-12-30)
        const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
        y = f.getUTCFullYear(); m = f.getUTCMonth() + 1; d = f.getUTCDate();
    } else return null;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return new Date(Date.UTC(y, m - 1, d, 17)); // 12:00 en Lima (UTC−5)
};

// ==========================================
// 4. Tabla + mapeo → líneas normalizadas
// ==========================================
export const leerLineas = (filas: string[][], mapeo: Mapeo): { lineas: LineaLeida[]; errores: string[] } => {
    if (mapeo.fecha < 0) throw new ErrorExtracto('Indica la columna de la fecha.');
    if (mapeo.monto < 0 && (mapeo.cargo < 0 || mapeo.abono < 0)) throw new ErrorExtracto('Indica la columna del monto, o las columnas de cargo y abono.');
    const lineas: LineaLeida[] = [];
    const errores: string[] = [];
    const ocurrencias = new Map<string, number>();
    const celda = (f: string[], i: number) => (i >= 0 ? (f[i] ?? '').trim() : '');

    filas.slice(mapeo.filaEncabezado + 1).forEach((f, idx) => {
        const fila = mapeo.filaEncabezado + 2 + idx;
        if (f.every(c => !c?.trim())) return;
        const textoFecha = celda(f, mapeo.fecha);
        const fecha = leerFecha(textoFecha);
        if (!fecha) {
            // Filas de totales, subtítulos, etc.: se omiten sin error si no parecen movimientos
            if (textoFecha && /\d/.test(textoFecha)) errores.push(`Fila ${fila}: fecha no reconocida ("${textoFecha}").`);
            return;
        }
        try {
            let valor: Prisma.Decimal | null;
            if (mapeo.monto >= 0) valor = leerMonto(celda(f, mapeo.monto));
            else {
                const cargo = leerMonto(celda(f, mapeo.cargo));
                const abono = leerMonto(celda(f, mapeo.abono));
                valor = abono && !abono.isZero() ? abono.abs() : cargo && !cargo.isZero() ? cargo.abs().neg() : null;
            }
            if (!valor || valor.isZero()) return;
            const descripcion = celda(f, mapeo.descripcion) || '(sin descripción)';
            const tipo = valor.isNegative() ? 'EGRESO' : 'INGRESO';
            const monto = valor.abs();
            const numeroOperacion = celda(f, mapeo.numeroOperacion).replace(/\s/g, '') || null;
            const saldoTexto = celda(f, mapeo.saldo);
            const saldo = saldoTexto ? leerMonto(saldoTexto) : null;

            // Huella estable: la misma línea en otro extracto (que se solapa) no se duplica
            const base = [fecha.toISOString().slice(0, 10), tipo, monto.toFixed(2), numeroOperacion ?? '', normalizar(descripcion)].join('|');
            const n = (ocurrencias.get(base) ?? 0) + 1;
            ocurrencias.set(base, n);
            const huella = crypto.createHash('sha256').update(`${base}|${n}`).digest('hex');

            lineas.push({ fila, fecha, descripcion: descripcion.slice(0, 300), tipo, monto, numeroOperacion: numeroOperacion?.slice(0, 40) ?? null, saldo, huella });
        } catch (e) {
            errores.push(`Fila ${fila}: ${e instanceof Error ? e.message : 'no se pudo leer'}`);
        }
    });
    return { lineas, errores };
};

/** "000123" y "123" son el mismo número de operación */
export const normalizarOperacion = (n: string | null | undefined) => (n ? n.replace(/\D/g, '').replace(/^0+/, '') || null : null);
