import { Request, Response } from 'express';
import { createHash } from 'crypto';
import { prisma } from '../prisma';

/**
 * Fotos y videos guardados en la base como "data URL" (base64).
 * Las listas NO devuelven el archivo completo: devuelven una dirección
 *   /api/media/<tipo>/<id>/<huella>
 * donde <huella> es el md5 del contenido (calculado por PostgreSQL, sin traer el archivo).
 * Así cada imagen se descarga aparte, el navegador la guarda en caché y la memoria del
 * servidor no se llena al listar productos o novedades.
 */
export type TipoMedia = 'producto' | 'novedad';

const TABLAS: Record<TipoMedia, { tabla: string; campo: string }> = {
    producto: { tabla: '"Producto"', campo: '"foto"' },
    novedad: { tabla: '"Novedad"', campo: '"imagen"' },
};

export interface InfoMedia {
    hash: string;
    mime: string;
}

/** Huella y tipo MIME de cada archivo, sin traer el contenido a Node. */
export const infoMedia = async (tipo: TipoMedia): Promise<Map<number, InfoMedia>> => {
    const { tabla, campo } = TABLAS[tipo];
    const filas = await prisma.$queryRawUnsafe<{ id: number; hash: string; mime: string }[]>(
        `SELECT id, md5(${campo}) AS hash, split_part(substring(${campo} from 6 for 100), ';', 1) AS mime
         FROM ${tabla} WHERE ${campo} LIKE 'data:%'`
    );
    return new Map(filas.map(f => [f.id, { hash: f.hash, mime: f.mime }]));
};

/** Origen público del backend (https://... en Render, detrás de su proxy). */
const origen = (req: Request) => process.env.PUBLIC_API_URL?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;

export const urlMedia = (req: Request, tipo: TipoMedia, id: number, hash: string) =>
    `${origen(req)}/api/media/${tipo}/${id}/${hash}`;

/** ¿Es una dirección de media de este servidor? (al editar sin cambiar la foto, el navegador la reenvía) */
export const esUrlMediaPropia = (valor: unknown, tipo: TipoMedia) =>
    typeof valor === 'string' && new RegExp(`/api/media/${tipo}/\\d+/[0-9a-f]{32}$`).test(valor);

/**
 * Valor a guardar para un campo de media recibido del navegador:
 * - undefined → no tocar (la dirección propia significa "sin cambios")
 * - null      → quitar la imagen
 * - string    → nuevo archivo (data URL) o enlace externo
 */
export const valorMediaParaGuardar = (valor: unknown, tipo: TipoMedia): string | null | undefined => {
    if (valor === undefined) return undefined;
    if (esUrlMediaPropia(valor, tipo)) return undefined;
    if (valor === null || valor === '') return null;
    return typeof valor === 'string' ? valor : undefined;
};

// ==========================================
// Caché pequeña en memoria (los videos se piden por partes al reproducirse)
// ==========================================
const LIMITE_CACHE = 40 * 1024 * 1024; // 40 MB como máximo
const cache = new Map<string, { mime: string; datos: Buffer }>();
let ocupado = 0;

const guardarEnCache = (clave: string, valor: { mime: string; datos: Buffer }) => {
    if (valor.datos.length > LIMITE_CACHE / 2) return; // archivos enormes no se guardan
    while (ocupado + valor.datos.length > LIMITE_CACHE && cache.size) {
        const [primera, v] = cache.entries().next().value as [string, { datos: Buffer }];
        cache.delete(primera);
        ocupado -= v.datos.length;
    }
    cache.set(clave, valor);
    ocupado += valor.datos.length;
};

const decodificarDataUrl = (dataUrl: string) => {
    const coma = dataUrl.indexOf(',');
    const cabecera = dataUrl.slice(5, coma); // "image/png;base64"
    const mime = cabecera.split(';')[0] || 'application/octet-stream';
    return { mime, datos: Buffer.from(dataUrl.slice(coma + 1), 'base64') };
};

/** GET /api/media/:tipo/:id/:hash — pública, pero solo funciona con la huella exacta del contenido. */
export const servirMedia = async (req: Request, res: Response) => {
    try {
        const tipo = String(req.params.tipo) as TipoMedia;
        const id = Number(req.params.id);
        const hash = String(req.params.hash);
        if (!TABLAS[tipo] || !Number.isInteger(id) || !/^[0-9a-f]{32}$/.test(hash)) {
            res.status(404).end();
            return;
        }

        const clave = `${tipo}:${id}:${hash}`;
        let archivo = cache.get(clave);
        if (!archivo) {
            const { tabla, campo } = TABLAS[tipo];
            const filas = await prisma.$queryRawUnsafe<{ valor: string }[]>(
                `SELECT ${campo} AS valor FROM ${tabla} WHERE id = $1 AND md5(${campo}) = $2`, id, hash
            );
            const valor = filas[0]?.valor;
            if (!valor || !valor.startsWith('data:')) {
                res.status(404).end();
                return;
            }
            archivo = decodificarDataUrl(valor);
            guardarEnCache(clave, archivo);
        }

        const total = archivo.datos.length;
        res.setHeader('Content-Type', archivo.mime);
        res.setHeader('Accept-Ranges', 'bytes');
        // El contenido nunca cambia para una misma huella: el navegador puede guardarlo para siempre
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('ETag', `"${hash}"`);

        if (req.headers['if-none-match'] === `"${hash}"`) {
            res.status(304).end();
            return;
        }

        // Pedidos por partes (los videos lo usan para adelantar/retroceder)
        const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
        if (rango) {
            let inicio = rango[1] ? Number(rango[1]) : total - Number(rango[2]);
            let fin = rango[1] && rango[2] ? Number(rango[2]) : total - 1;
            if (!rango[1]) fin = total - 1;
            if (isNaN(inicio) || inicio < 0 || inicio >= total || fin < inicio) {
                res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
                return;
            }
            fin = Math.min(fin, total - 1);
            res.status(206);
            res.setHeader('Content-Range', `bytes ${inicio}-${fin}/${total}`);
            res.setHeader('Content-Length', String(fin - inicio + 1));
            res.end(archivo.datos.subarray(inicio, fin + 1));
            return;
        }

        res.setHeader('Content-Length', String(total));
        res.end(archivo.datos);
    } catch (error) {
        console.error('Error al servir media:', error);
        res.status(500).end();
    }
};

// ==========================================
// Ayudantes para las respuestas JSON
// ==========================================

/** Reemplaza el archivo de un registro ya cargado por su dirección (y agrega el tipo MIME). */
export const conDireccionMedia = <T extends { id: number }>(req: Request, tipo: TipoMedia, campo: keyof T & string, registro: T) => {
    const valor = (registro as any)[campo];
    if (typeof valor !== 'string' || !valor.startsWith('data:')) {
        return { ...registro, [`${campo}Tipo`]: null };
    }
    const hash = createHash('md5').update(valor, 'utf8').digest('hex');
    const mime = valor.slice(5, valor.indexOf(';'));
    return { ...registro, [campo]: urlMedia(req, tipo, registro.id, hash), [`${campo}Tipo`]: mime };
};

/** Para listas cargadas SIN el archivo: agrega la dirección usando las huellas calculadas en la base. */
export const agregarDireccionesMedia = async <T extends { id: number }>(req: Request, tipo: TipoMedia, campo: string, lista: T[]) => {
    const info = await infoMedia(tipo);
    return lista.map(r => {
        const i = info.get(r.id);
        const actual = (r as any)[campo];
        // Enlaces externos (si existieran) se dejan tal cual
        if (!i) return { ...r, [campo]: typeof actual === 'string' && /^https?:\/\//.test(actual) ? actual : null, [`${campo}Tipo`]: null };
        return { ...r, [campo]: urlMedia(req, tipo, r.id, i.hash), [`${campo}Tipo`]: i.mime };
    });
};
