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
// Lectura por trozos: Node nunca carga el archivo completo en memoria.
// PostgreSQL extrae y decodifica solo el pedazo de base64 que se necesita.
// ==========================================
const TROZO = 1024 * 1024; // 1 MB por respuesta / por lectura

interface MetaMedia { mime: string; coma: number; total: number }
const metas = new Map<string, MetaMedia>(); // solo metadatos (bytes), nunca contenido
const MAX_METAS = 500;

/** Valida la huella una vez y guarda tipo, posición de los datos y tamaño real. */
const obtenerMeta = async (tipo: TipoMedia, id: number, hash: string): Promise<MetaMedia | null> => {
    const clave = `${tipo}:${id}:${hash}`;
    const enCache = metas.get(clave);
    if (enCache) return enCache;

    const { tabla, campo } = TABLAS[tipo];
    const filas = await prisma.$queryRawUnsafe<{ coma: number; largo: number; fin: string; mime: string }[]>(
        `SELECT position(',' in ${campo}) AS coma, length(${campo}) AS largo, right(${campo}, 2) AS fin,
                split_part(substring(${campo} from 6 for 100), ';', 1) AS mime
         FROM ${tabla} WHERE id = $1::int AND ${campo} LIKE 'data:%' AND md5(${campo}) = $2::text`, id, hash
    );
    const f = filas[0];
    if (!f || !f.coma) return null;
    const caracteres = Number(f.largo) - Number(f.coma);
    const relleno = (f.fin.match(/=/g) || []).length;
    const meta = { mime: f.mime || 'application/octet-stream', coma: Number(f.coma), total: (caracteres / 4) * 3 - relleno };

    if (metas.size >= MAX_METAS) metas.delete(metas.keys().next().value as string);
    metas.set(clave, meta);
    return meta;
};

/** Lee los bytes [inicio, fin] (inclusive) decodificando en PostgreSQL solo los bloques necesarios. */
const leerBytes = async (tipo: TipoMedia, id: number, meta: MetaMedia, inicio: number, fin: number): Promise<Buffer> => {
    const { tabla, campo } = TABLAS[tipo];
    const bloqueIni = Math.floor(inicio / 3);
    const bloqueFin = Math.floor(fin / 3);
    const desde = meta.coma + 1 + bloqueIni * 4; // posición 1-based del primer carácter base64
    const cantidad = (bloqueFin - bloqueIni + 1) * 4;
    const filas = await prisma.$queryRawUnsafe<{ b: Buffer }[]>(
        `SELECT decode(substring(${campo} from $2::int for $3::int), 'base64') AS b FROM ${tabla} WHERE id = $1::int`, id, desde, cantidad
    );
    const datos = Buffer.from(filas[0]?.b ?? []);
    const desplazamiento = inicio - bloqueIni * 3;
    return datos.subarray(desplazamiento, desplazamiento + (fin - inicio + 1));
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

        // El contenido nunca cambia para una misma huella: el navegador puede guardarlo para siempre
        if (req.headers['if-none-match'] === `"${hash}"`) {
            res.status(304).end();
            return;
        }

        const meta = await obtenerMeta(tipo, id, hash);
        if (!meta) {
            res.status(404).end();
            return;
        }
        const total = meta.total;
        res.setHeader('Content-Type', meta.mime);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('ETag', `"${hash}"`);

        // Pedidos por partes (los videos lo usan para reproducir y adelantar)
        const rango = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
        if (rango && (rango[1] || rango[2])) {
            let inicio: number;
            let fin: number;
            if (rango[1]) {
                inicio = Number(rango[1]);
                fin = rango[2] ? Number(rango[2]) : total - 1;
            } else {
                inicio = Math.max(0, total - Number(rango[2]));
                fin = total - 1;
            }
            if (isNaN(inicio) || inicio >= total || fin < inicio) {
                res.status(416).setHeader('Content-Range', `bytes */${total}`).end();
                return;
            }
            // Se entrega como máximo un trozo; el navegador pide el siguiente cuando lo necesita
            fin = Math.min(fin, total - 1, inicio + TROZO - 1);
            const datos = await leerBytes(tipo, id, meta, inicio, fin);
            res.status(206);
            res.setHeader('Content-Range', `bytes ${inicio}-${fin}/${total}`);
            res.setHeader('Content-Length', String(datos.length));
            res.end(datos);
            return;
        }

        // Archivo completo: se envía por trozos, sin juntarlo en memoria
        res.setHeader('Content-Length', String(total));
        for (let inicio = 0; inicio < total; inicio += TROZO) {
            const datos = await leerBytes(tipo, id, meta, inicio, Math.min(inicio + TROZO, total) - 1);
            if (!res.write(datos)) await new Promise(r => res.once('drain', r));
            if (res.destroyed) return;
        }
        res.end();
    } catch (error) {
        console.error('Error al servir media:', error);
        if (!res.headersSent) res.status(500);
        res.end();
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
