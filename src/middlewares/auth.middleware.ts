import { NextFunction, Request, Response } from 'express';
import { verificarSesion, SesionPayload, Rol, ROLES, ROLES_PANEL } from '../auth/security';
import { obtenerCuenta, tieneDosPasos, dosPasosObligatorio } from '../auth/cuentas';
import { prisma } from '../prisma';

export interface EstadoSeguridad {
    debeCambiarPassword: boolean;
    dosPasosActivo: boolean;
    debeConfigurar2FA: boolean;
}

declare global {
    namespace Express {
        interface Request {
            usuario?: SesionPayload;
            seguridad?: EstadoSeguridad;
        }
    }
}

/**
 * Exige un token de sesión válido (cabecera Authorization: Bearer <token>) y comprueba,
 * contra la base de datos, que la cuenta siga existiendo, que la sesión no haya sido
 * cerrada (versión) y que no tenga pasos de seguridad pendientes.
 *
 * `permitirPendientes`: deja pasar sesiones que aún deben cambiar la contraseña o
 * configurar la verificación en dos pasos (solo para las rutas que resuelven eso).
 */
const crearRequireAuth = (permitirPendientes: boolean) =>
    async (req: Request, res: Response, next: NextFunction) => {
        try {
            const cabecera = req.headers.authorization || '';
            const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
            const sesion = token ? verificarSesion(token) : null;
            const cuenta = sesion ? await obtenerCuenta(sesion.cuenta) : null;

            if (!sesion || !cuenta || cuenta.sesionVersion !== sesion.ver) {
                res.status(401).json({ error: 'Sesión no válida o expirada. Inicia sesión nuevamente.' });
                return;
            }

            const dosPasosActivo = await tieneDosPasos(cuenta.ref);
            if (dosPasosActivo && !sesion.mfa) {
                // Sesión abierta antes de activar el segundo factor: debe volver a entrar
                res.status(401).json({ error: 'Inicia sesión nuevamente con tu código de verificación.' });
                return;
            }
            if (sesion.dis != null) {
                // Si el celular con el que se abrió la sesión fue retirado, la sesión deja de valer
                const sigue = await prisma.dispositivoVerificacion.count({ where: { id: sesion.dis, cuenta: cuenta.ref, confirmado: true } });
                if (!sigue) {
                    res.status(401).json({ error: 'El celular con el que iniciaste sesión fue retirado. Inicia sesión nuevamente.' });
                    return;
                }
            }

            // El rol vigente es el de la base de datos (por si cambió después de emitir el token)
            req.usuario = { ...sesion, rol: cuenta.rol, nombre: cuenta.nombre, email: cuenta.email };
            req.seguridad = {
                debeCambiarPassword: cuenta.debeCambiarPassword,
                dosPasosActivo,
                debeConfigurar2FA: dosPasosObligatorio(cuenta.rol) && !dosPasosActivo,
            };

            if (!permitirPendientes) {
                if (req.seguridad.debeCambiarPassword) {
                    res.status(403).json({ error: 'Debes cambiar tu contraseña antes de continuar.', codigo: 'CAMBIAR_PASSWORD' });
                    return;
                }
                if (req.seguridad.debeConfigurar2FA) {
                    res.status(403).json({ error: 'Debes activar la verificación en dos pasos antes de continuar.', codigo: 'CONFIGURAR_2FA' });
                    return;
                }
            }
            next();
        } catch (error) {
            next(error);
        }
    };

export const requireAuth = crearRequireAuth(false);
export const requireAuthConPendientes = crearRequireAuth(true);

/** Permite el acceso solo a los roles indicados (usar después de requireAuth). */
export const requireRole = (...roles: Rol[]) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
        res.status(403).json({ error: 'No tienes permisos para realizar esta acción.' });
        return;
    }
    next();
};

const LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Permisos por tipo de operación:
 * - lectura (GET): `leer`
 * - creación / edición (POST, PUT, PATCH): `escribir`
 * - eliminación (DELETE): `eliminar`
 */
export const permisosPorMetodo = (opts: { leer: Rol[]; escribir: Rol[]; eliminar: Rol[] }) =>
    (req: Request, res: Response, next: NextFunction) => {
        const permitidos = LECTURA.has(req.method)
            ? opts.leer
            : req.method === 'DELETE'
                ? opts.eliminar
                : opts.escribir;
        return requireRole(...permitidos)(req, res, next);
    };

/** Perfil estándar para módulos operativos del panel */
export const PERMISOS_OPERATIVOS = {
    leer: ROLES_PANEL,
    escribir: [ROLES.ADMIN, ROLES.OPERADOR] as Rol[],
    eliminar: [ROLES.ADMIN] as Rol[],
};

/** Middleware combinado: sesión + permisos operativos */
export const panelOperativo = [requireAuth, permisosPorMetodo(PERMISOS_OPERATIVOS)];

/** Middleware combinado: sesión + solo administrador */
export const soloAdmin = [requireAuth, requireRole(ROLES.ADMIN)];
