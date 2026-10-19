// Recepción de archivos adjuntos (multipart) para cualquier registro: se guardan en el almacenamiento
// configurado (Backblaze B2 o disco local en desarrollo) y quedan en la tabla Archivo.
import { Request } from 'express';
import Busboy from 'busboy';
import { prisma } from '../prisma';
import { quien } from '../auth/auditoria';
import { guardarArchivo, ErrorArchivo } from './almacenamiento';

export interface OpcionesSubida {
    entidad: string;        // p. ej. 'documento_compra'
    entidadId: number;
    carpeta: string;        // carpeta dentro del almacenamiento
    maxBytes: number;
    maxArchivos: number;
    /** Mensaje cuando el mismo archivo (sha256) ya está adjunto a otro registro de la misma entidad */
    avisoDuplicado?: (otroEntidadId: number, nombre: string) => Promise<string>;
}

export interface ResultadoSubida {
    archivos: { id: number; nombre: string; mime: string; tamano: number; subidoPor: string; subidoEn: Date }[];
    avisos: string[];
    error?: Error;
}

export const recibirArchivos = (req: Request, op: OpcionesSubida): Promise<ResultadoSubida> =>
    new Promise(resolve => {
        const guardados: ResultadoSubida['archivos'] = [];
        const avisos: string[] = [];
        let errorEnvio: Error | undefined;

        if (!req.is('multipart/form-data')) {
            return resolve({ archivos: [], avisos, error: new ErrorArchivo('Envía los archivos como formulario (multipart/form-data).') });
        }
        let busboy: Busboy.Busboy;
        try {
            busboy = Busboy({ headers: req.headers, limits: { files: op.maxArchivos, fileSize: op.maxBytes + 1, fields: 5 } });
        } catch {
            return resolve({ archivos: [], avisos, error: new ErrorArchivo('Formulario no válido.') });
        }

        const tareas: Promise<void>[] = [];
        busboy.on('file', (_campo, flujo, info) => {
            tareas.push((async () => {
                try {
                    const nombre = (info.filename || 'archivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
                    const g = await guardarArchivo(flujo, { carpeta: op.carpeta, maxBytes: op.maxBytes });
                    const igual = await prisma.archivo.findFirst({ where: { sha256: g.sha256, eliminado: false, entidad: op.entidad } });
                    if (igual?.entidadId === op.entidadId) {
                        avisos.push(`"${nombre}" ya estaba adjunto.`);
                        return;
                    }
                    if (igual && op.avisoDuplicado) avisos.push(await op.avisoDuplicado(igual.entidadId, nombre));
                    const a = await prisma.archivo.create({
                        data: { ...g, nombre, entidad: op.entidad, entidadId: op.entidadId, subidoPor: quien(req) },
                        select: { id: true, nombre: true, mime: true, tamano: true, subidoPor: true, subidoEn: true },
                    });
                    guardados.push(a);
                } catch (e) {
                    flujo.resume();
                    errorEnvio ??= e instanceof Error ? e : new Error(String(e));
                }
            })());
        });
        busboy.on('filesLimit', () => { errorEnvio ??= new ErrorArchivo(`Máximo ${op.maxArchivos} archivos por envío.`); });
        busboy.on('error', e => { errorEnvio ??= e instanceof Error ? e : new Error(String(e)); });
        busboy.on('close', async () => {
            await Promise.allSettled(tareas);
            resolve({ archivos: guardados, avisos, error: errorEnvio });
        });
        req.pipe(busboy);
    });
