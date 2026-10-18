import { Request, Response } from 'express';
import { prisma } from '../prisma';

/** Historial de auditoría con filtros y paginación (solo administrador). */
export const listarAuditoria = async (req: Request, res: Response) => {
    try {
        const pagina = Math.max(1, Number(req.query.pagina) || 1);
        const porPagina = Math.min(100, Math.max(10, Number(req.query.porPagina) || 30));
        const { accion, entidad, desde, hasta, tipo } = req.query as Record<string, string | undefined>;

        const where: any = {};
        if (accion) where.accion = accion;
        if (entidad) where.entidad = entidad;
        // tipo=accesos → inicios de sesión y seguridad; tipo=cambios → modificaciones de datos
        if (tipo === 'accesos') where.entidad = 'auth';
        if (tipo === 'cambios') where.entidad = { not: 'auth' };
        if (desde || hasta) {
            where.fecha = {};
            if (desde && !isNaN(Date.parse(desde))) where.fecha.gte = new Date(desde);
            if (hasta && !isNaN(Date.parse(hasta))) where.fecha.lte = new Date(hasta);
        }

        const [total, registros] = await Promise.all([
            prisma.auditoria.count({ where }),
            prisma.auditoria.findMany({ where, orderBy: { fecha: 'desc' }, skip: (pagina - 1) * porPagina, take: porPagina }),
        ]);
        res.json({ total, pagina, porPagina, registros });
    } catch (error) {
        console.error('Error al listar auditoría:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
};
