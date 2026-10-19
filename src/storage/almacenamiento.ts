import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PassThrough, Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import { S3Client, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import jwt from 'jsonwebtoken';

/**
 * Almacenamiento privado de archivos.
 * - "s3": Backblaze B2 (o cualquier servicio compatible con S3). Producción.
 * - "local": carpeta en disco. Solo desarrollo y pruebas (Render borra el disco en cada despliegue).
 *
 * Los archivos SIEMPRE pasan en streaming: nunca se cargan completos en la memoria del servidor.
 */
export type Driver = 'local' | 's3';

const enProduccion = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const configS3 = () => {
    const endpoint = process.env.B2_ENDPOINT?.trim();
    const bucket = process.env.B2_BUCKET?.trim();
    const keyId = process.env.B2_KEY_ID?.trim();
    const key = process.env.B2_APPLICATION_KEY?.trim();
    if (!endpoint || !bucket || !keyId || !key) return null;
    const region = /s3\.([a-z0-9-]+)\.backblazeb2\.com/.exec(endpoint)?.[1] || process.env.B2_REGION || 'us-east-1';
    return { endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`, bucket, keyId, key, region };
};

export const driverActual = (): Driver => (configS3() ? 's3' : 'local');

let cliente: S3Client | null = null;
const s3 = () => {
    const c = configS3();
    if (!c) throw new Error('Backblaze B2 no está configurado (B2_ENDPOINT, B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY).');
    cliente ??= new S3Client({
        endpoint: c.endpoint,
        region: c.region,
        credentials: { accessKeyId: c.keyId, secretAccessKey: c.key },
        forcePathStyle: true,
    });
    return { cliente, bucket: c.bucket };
};

const CARPETA_LOCAL = path.resolve(process.env.STORAGE_LOCAL_DIR || path.join(process.cwd(), 'uploads'));

// ==========================================
// Tipos de archivo permitidos (se valida el CONTENIDO, no solo la extensión)
// ==========================================
export const TIPOS_PERMITIDOS: Record<string, { ext: string; firma: (b: Buffer) => boolean }> = {
    'application/pdf': { ext: 'pdf', firma: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
    'image/jpeg': { ext: 'jpg', firma: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    'image/png': { ext: 'png', firma: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    'image/webp': { ext: 'webp', firma: b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
    'image/heic': { ext: 'heic', firma: b => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)/.test(b.subarray(8, 12).toString('latin1')) },
};

/** Detecta el tipo real a partir de los primeros bytes. */
export const detectarTipo = (primeros: Buffer): string | null =>
    Object.entries(TIPOS_PERMITIDOS).find(([, t]) => t.firma(primeros))?.[0] ?? null;

export class ErrorArchivo extends Error {
    constructor(message: string, public status = 400) { super(message); }
}

export interface ArchivoGuardado {
    clave: string;
    mime: string;
    tamano: number;
    sha256: string;
    almacenamiento: Driver;
}

/**
 * Guarda un archivo recibido como stream.
 * Valida el tipo real por su firma, limita el tamaño y calcula SHA-256 mientras transmite.
 */
export const guardarArchivo = async (
    entrada: Readable,
    opciones: { carpeta: string; maxBytes: number; /** tipo ya validado por quien llama (p. ej. extractos CSV/Excel) */ tipo?: { mime: string; ext: string } }
): Promise<ArchivoGuardado> => {
    // En producción nunca se guarda en el disco del servidor (Render lo borra en cada despliegue)
    if (enProduccion && driverActual() === 'local') {
        entrada.resume();
        throw new ErrorArchivo('El almacenamiento de archivos (Backblaze B2) no está configurado todavía.', 503);
    }
    // 1. Leer la cabecera para validar el tipo antes de enviar nada
    const cabecera = await leerCabecera(entrada, 16);
    const mime = opciones.tipo?.mime ?? detectarTipo(cabecera);
    if (!mime) throw new ErrorArchivo('Tipo de archivo no permitido. Usa PDF, JPG, PNG, WEBP o HEIC.', 415);
    const ext = opciones.tipo?.ext ?? TIPOS_PERMITIDOS[mime].ext;

    const hoy = new Date();
    const clave = `${opciones.carpeta}/${hoy.getUTCFullYear()}/${String(hoy.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;

    const hash = crypto.createHash('sha256');
    let tamano = 0;
    const control = new Transform({
        transform(chunk: Buffer, _enc, cb) {
            tamano += chunk.length;
            if (tamano > opciones.maxBytes) {
                cb(new ErrorArchivo(`El archivo supera el máximo de ${Math.round(opciones.maxBytes / 1024 / 1024)} MB.`, 413));
                return;
            }
            hash.update(chunk);
            cb(null, chunk);
        },
    });

    const flujo = new PassThrough();
    flujo.write(cabecera);
    entrada.pipe(flujo);
    const datos = flujo.pipe(control);
    // Si la entrada falla, propagarlo
    entrada.on('error', e => control.destroy(e));

    const driver = driverActual();
    try {
        if (driver === 's3') {
            const { cliente: c, bucket } = s3();
            await new Upload({
                client: c,
                params: { Bucket: bucket, Key: clave, Body: datos, ContentType: mime },
                queueSize: 2,
                partSize: 5 * 1024 * 1024,
            }).done();
        } else {
            const destino = path.join(CARPETA_LOCAL, clave);
            await fs.promises.mkdir(path.dirname(destino), { recursive: true });
            await pipeline(datos, fs.createWriteStream(destino));
        }
    } catch (error) {
        if (error instanceof ErrorArchivo) throw error;
        if ((error as any)?.cause instanceof ErrorArchivo) throw (error as any).cause;
        throw error;
    }

    if (tamano === 0) throw new ErrorArchivo('El archivo está vacío.');
    return { clave, mime, tamano, sha256: hash.digest('hex'), almacenamiento: driver };
};

const leerCabecera = (entrada: Readable, bytes: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const partes: Buffer[] = [];
        let total = 0;
        const alLeer = (chunk: Buffer) => {
            partes.push(chunk);
            total += chunk.length;
            if (total >= bytes) terminar();
        };
        const terminar = () => {
            entrada.off('data', alLeer);
            entrada.off('end', terminar);
            entrada.off('error', reject);
            entrada.pause();
            resolve(Buffer.concat(partes));
        };
        entrada.on('data', alLeer);
        entrada.once('end', terminar);
        entrada.once('error', reject);
    });

// ==========================================
// Descarga: enlace temporal (5 minutos)
// ==========================================
const SECRETO_DESCARGA = () => process.env.JWT_SECRET || 'solo-desarrollo';

/**
 * Devuelve un enlace temporal para ver o descargar el archivo.
 * - s3: URL firmada de Backblaze (el archivo no pasa por el servidor).
 * - local: URL de este backend con un token de un solo propósito.
 */
export const enlaceTemporal = async (
    archivo: { clave: string; nombre: string; mime: string; almacenamiento: string },
    baseUrl: string,
    descargar = false
): Promise<string> => {
    const disposicion = `${descargar ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(archivo.nombre)}`;
    if (archivo.almacenamiento === 's3') {
        const { cliente: c, bucket } = s3();
        return getSignedUrl(c, new GetObjectCommand({
            Bucket: bucket, Key: archivo.clave, ResponseContentDisposition: disposicion, ResponseContentType: archivo.mime,
        }), { expiresIn: 300 });
    }
    const token = jwt.sign({ tipo: 'archivo', clave: archivo.clave, mime: archivo.mime, disp: disposicion }, SECRETO_DESCARGA(), { expiresIn: '5m' });
    return `${baseUrl}/api/archivos/local/${token}`;
};

/** Sirve un archivo local a partir del token (solo almacenamiento local). */
export const abrirArchivoLocal = (token: string) => {
    if (enProduccion && driverActual() === 's3') return null;
    try {
        const d = jwt.verify(token, SECRETO_DESCARGA()) as any;
        if (d?.tipo !== 'archivo' || typeof d.clave !== 'string' || d.clave.includes('..')) return null;
        const ruta = path.join(CARPETA_LOCAL, d.clave);
        if (!ruta.startsWith(CARPETA_LOCAL) || !fs.existsSync(ruta)) return null;
        return { stream: fs.createReadStream(ruta), mime: d.mime as string, disposicion: d.disp as string, tamano: fs.statSync(ruta).size };
    } catch {
        return null;
    }
};

/** Comprueba la conexión con Backblaze (para el diagnóstico del panel). */
export const verificarConexion = async (): Promise<{ driver: Driver; ok: boolean; detalle?: string }> => {
    const driver = driverActual();
    if (driver === 'local') {
        return { driver, ok: !enProduccion, detalle: enProduccion ? 'En producción falta configurar Backblaze B2.' : 'Almacenamiento local de desarrollo.' };
    }
    try {
        const { cliente: c, bucket } = s3();
        await c.send(new HeadBucketCommand({ Bucket: bucket }));
        return { driver, ok: true };
    } catch (e: any) {
        return { driver, ok: false, detalle: e?.name || 'No se pudo conectar con Backblaze B2' };
    }
};
