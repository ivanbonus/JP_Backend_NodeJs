import { prisma } from '../prisma';
import { esRolValido, Rol, ROLES } from './security';

/**
 * Una "cuenta" es quien inicia sesión:
 *  - "config"        → administrador principal (credenciales en Configuración)
 *  - "usuario:<id>"  → registro de la tabla Usuario
 */
export type RefCuenta = 'config' | `usuario:${number}`;

export interface Cuenta {
    ref: RefCuenta;
    uid: number | null;
    nombre: string;
    email: string;
    login: string; // lo que se escribe en el formulario de inicio de sesión
    rol: Rol;
    passwordHash: string | null;
    debeCambiarPassword: boolean;
    sesionVersion: number;
}

export const refUsuario = (id: number): RefCuenta => `usuario:${id}`;

export const obtenerCuenta = async (ref: string): Promise<Cuenta | null> => {
    if (ref === 'config') {
        const c = await prisma.configuracion.findFirst();
        if (!c) return null;
        return {
            ref: 'config',
            uid: null,
            nombre: c.nombreResponsable || 'Administrador',
            email: c.email || c.usuario,
            login: c.usuario,
            rol: ROLES.ADMIN,
            passwordHash: c.password,
            debeCambiarPassword: c.debeCambiarPassword,
            sesionVersion: c.sesionVersion,
        };
    }
    const m = /^usuario:(\d+)$/.exec(ref);
    if (!m) return null;
    const u = await prisma.usuario.findUnique({ where: { id: Number(m[1]) } });
    if (!u) return null;
    return {
        ref: refUsuario(u.id),
        uid: u.id,
        nombre: u.nombre,
        email: u.email,
        login: u.email,
        rol: esRolValido(u.rol) ? u.rol : ROLES.USER,
        passwordHash: u.password,
        debeCambiarPassword: u.debeCambiarPassword,
        sesionVersion: u.sesionVersion,
    };
};

/** Guarda una nueva contraseña (ya cifrada) e invalida todas las sesiones anteriores. */
export const guardarPassword = async (ref: RefCuenta, hash: string, opciones: { debeCambiar?: boolean } = {}) => {
    const data = { password: hash, debeCambiarPassword: opciones.debeCambiar ?? false, sesionVersion: { increment: 1 } };
    if (ref === 'config') {
        const c = await prisma.configuracion.findFirst();
        if (!c) throw new Error('No existe la configuración del administrador.');
        await prisma.configuracion.update({ where: { id: c.id }, data });
    } else {
        await prisma.usuario.update({ where: { id: Number(ref.split(':')[1]) }, data });
    }
};

/** Cierra todas las sesiones abiertas de la cuenta. */
export const invalidarSesiones = async (ref: RefCuenta) => {
    if (ref === 'config') {
        const c = await prisma.configuracion.findFirst();
        if (c) await prisma.configuracion.update({ where: { id: c.id }, data: { sesionVersion: { increment: 1 } } });
    } else {
        await prisma.usuario.update({ where: { id: Number(ref.split(':')[1]) }, data: { sesionVersion: { increment: 1 } } });
    }
};

/** ¿Tiene la verificación en dos pasos activa (y al menos un celular confirmado)? */
export const tieneDosPasos = async (ref: string) => {
    const sf = await prisma.segundoFactor.findUnique({ where: { cuenta: ref }, select: { activo: true } });
    if (!sf?.activo) return false;
    return (await prisma.dispositivoVerificacion.count({ where: { cuenta: ref, confirmado: true } })) > 0;
};

/** Máximo de celulares de verificación por cuenta */
export const MAX_DISPOSITIVOS = 5;

/** La verificación en dos pasos es obligatoria para los administradores. */
export const dosPasosObligatorio = (rol: Rol) => rol === ROLES.ADMIN;
