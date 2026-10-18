import { NextFunction, Request, Response } from 'express';
import { prisma } from '../prisma';

export interface EventoAuditoria {
    cuenta: string;
    rol?: string | null;
    accion: string;
    entidad?: string | null;
    entidadId?: string | number | null;
    metodo?: string | null;
    ruta?: string | null;
    estadoHttp?: number | null;
    ip?: string | null;
    detalle?: Record<string, unknown> | null;
}

/** Registra un evento. Nunca interrumpe la operación principal si falla. */
export const registrarAuditoria = async (evento: EventoAuditoria) => {
    try {
        await prisma.auditoria.create({
            data: {
                cuenta: evento.cuenta.slice(0, 200),
                rol: evento.rol ?? null,
                accion: evento.accion,
                entidad: evento.entidad ?? null,
                entidadId: evento.entidadId != null ? String(evento.entidadId) : null,
                metodo: evento.metodo ?? null,
                ruta: evento.ruta?.slice(0, 300) ?? null,
                estadoHttp: evento.estadoHttp ?? null,
                ip: evento.ip ?? null,
                detalle: (evento.detalle ?? undefined) as any,
            },
        });
    } catch (error) {
        console.error('[AUDITORIA] No se pudo registrar el evento:', error);
    }
};

export const ipDe = (req: Request) => req.ip || req.socket?.remoteAddress || null;

/** Identificador legible de quién hizo la acción */
export const quien = (req: Request) => req.usuario?.email || req.usuario?.nombre || 'anonimo';

const accionPorMetodo = (req: Request) => {
    if (/\/anular$/.test(req.path)) return 'ANULAR';
    if (req.method === 'POST') return 'CREAR';
    if (req.method === 'DELETE') return 'ELIMINAR';
    return 'EDITAR';
};

/**
 * Middleware: registra toda operación que modifica datos del panel (POST, PUT, PATCH, DELETE)
 * que terminó bien. No guarda el contenido enviado (puede contener datos sensibles).
 */
export const auditarCambios = (entidad: string) => (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    res.on('finish', () => {
        if (res.statusCode >= 400 || !req.usuario) return;
        const id = req.path.split('/').find(seg => /^\d+$/.test(seg)) ?? null;
        void registrarAuditoria({
            cuenta: quien(req),
            rol: req.usuario.rol,
            accion: accionPorMetodo(req),
            entidad,
            entidadId: id,
            metodo: req.method,
            ruta: req.originalUrl.split('?')[0],
            estadoHttp: res.statusCode,
            ip: ipDe(req),
        });
    });
    next();
};
