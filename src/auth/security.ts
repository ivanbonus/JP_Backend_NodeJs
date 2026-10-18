import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

// ==========================================
// ROLES
// ==========================================
export const ROLES = {
    ADMIN: 'ADMIN',
    OPERADOR: 'OPERADOR',
    CONTABILIDAD: 'CONTABILIDAD',
    USER: 'USER', // Cliente de la web: no accede al panel
} as const;

export type Rol = (typeof ROLES)[keyof typeof ROLES];

/** Roles que pueden entrar al panel administrativo */
export const ROLES_PANEL: Rol[] = [ROLES.ADMIN, ROLES.OPERADOR, ROLES.CONTABILIDAD];

export const esRolValido = (rol: unknown): rol is Rol =>
    typeof rol === 'string' && (Object.values(ROLES) as string[]).includes(rol);

// ==========================================
// SECRETO JWT
// ==========================================
const enProduccion = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

const resolverSecreto = (): string => {
    const secreto = process.env.JWT_SECRET;
    if (secreto && secreto.length >= 32) return secreto;
    if (enProduccion) {
        throw new Error('[SEGURIDAD] Falta JWT_SECRET (mínimo 32 caracteres) en las variables de entorno.');
    }
    console.warn('[SEGURIDAD] JWT_SECRET no definido: se usa un secreto temporal (las sesiones se cierran al reiniciar).');
    return crypto.randomBytes(48).toString('hex');
};

const JWT_SECRET = resolverSecreto();
const DURACION_SESION = '12h';

// ==========================================
// TOKENS DE SESIÓN
// ==========================================
export interface SesionPayload {
    /** Cuenta: "config" (administrador principal) o "usuario:<id>" */
    cuenta: string;
    /** Id de Usuario, o null para el administrador principal */
    uid: number | null;
    nombre: string;
    email: string;
    rol: Rol;
    /** Versión de sesión de la cuenta: si cambia (p. ej. nueva contraseña), el token deja de valer */
    ver: number;
    /** true si la sesión se abrió verificando el segundo factor */
    mfa: boolean;
    /** Celular con el que se verificó (null: código de recuperación o sin segundo factor) */
    dis: number | null;
}

export const firmarSesion = (payload: SesionPayload): string =>
    jwt.sign({ ...payload, tipo: 'sesion' }, JWT_SECRET, { expiresIn: DURACION_SESION });

export const verificarSesion = (token: string): SesionPayload | null => {
    try {
        const data = jwt.verify(token, JWT_SECRET) as any;
        if (data?.tipo !== 'sesion' || !esRolValido(data.rol) || typeof data.cuenta !== 'string') return null;
        return {
            cuenta: data.cuenta,
            uid: data.uid ?? null,
            nombre: data.nombre,
            email: data.email,
            rol: data.rol,
            ver: Number(data.ver) || 0,
            mfa: data.mfa === true,
            dis: Number.isInteger(data.dis) ? data.dis : null,
        };
    } catch {
        return null;
    }
};

// ==========================================
// DESAFÍO DE SEGUNDO FACTOR (entre la contraseña y el código de 6 dígitos)
// ==========================================
export const firmarDesafio2FA = (cuenta: string, ver: number): string =>
    jwt.sign({ tipo: 'desafio-2fa', cuenta, ver }, JWT_SECRET, { expiresIn: '5m' });

export const verificarDesafio2FA = (token: string): { cuenta: string; ver: number } | null => {
    try {
        const data = jwt.verify(token, JWT_SECRET) as any;
        if (data?.tipo !== 'desafio-2fa' || typeof data.cuenta !== 'string') return null;
        return { cuenta: data.cuenta, ver: Number(data.ver) || 0 };
    } catch {
        return null;
    }
};

// ==========================================
// TOKEN DE DESCARGA DE BOLETA (venta web, sin sesión)
// ==========================================
export const firmarTokenBoleta = (transaccionId: number): string =>
    jwt.sign({ tipo: 'boleta', tid: transaccionId }, JWT_SECRET, { expiresIn: '2h' });

export const verificarTokenBoleta = (token: string, transaccionId: number): boolean => {
    try {
        const data = jwt.verify(token, JWT_SECRET) as any;
        return data?.tipo === 'boleta' && data.tid === transaccionId;
    } catch {
        return false;
    }
};

// ==========================================
// CONTRASEÑAS
// ==========================================
const RONDAS_BCRYPT = 11;

export const esHashBcrypt = (valor?: string | null) => !!valor && /^\$2[aby]\$\d{2}\$/.test(valor);

export const hashPassword = (plano: string) => bcrypt.hash(plano, RONDAS_BCRYPT);

/**
 * Compara una contraseña con lo guardado. Acepta contraseñas antiguas en texto plano
 * (para no bloquear a nadie) e indica que deben migrarse a hash.
 */
export const verificarPassword = async (
    plano: string,
    guardado?: string | null
): Promise<{ ok: boolean; requiereMigracion: boolean }> => {
    if (!guardado || !plano) return { ok: false, requiereMigracion: false };
    if (esHashBcrypt(guardado)) {
        return { ok: await bcrypt.compare(plano, guardado), requiereMigracion: false };
    }
    const a = Buffer.from(plano);
    const b = Buffer.from(guardado);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { ok, requiereMigracion: ok };
};

/** Mínimo para clientes de la web y para el personal del panel (NIST 800-63B: priorizar longitud) */
export const MIN_PASSWORD_WEB = 8;
export const MIN_PASSWORD_PANEL = 12;
/** bcrypt solo considera los primeros 72 bytes */
const MAX_PASSWORD = 64;

// Contraseñas y palabras demasiado previsibles para este negocio
const PREVISIBLES = [
    'password', 'contrasena', 'contraseña', 'qwerty', 'admin', 'administrador', '123456', '12345678',
    '123456789', '1234567890', 'abc123', 'iloveyou', 'welcome', 'bienvenido', 'peru', 'lima',
    'juanpablo', 'juan pablo', 'tallerjuanp', 'taller', 'frenos', 'embragues', 'jp2026', 'jp2025',
];

/**
 * Reglas recomendadas por NIST 800-63B: longitud mínima, sin reglas de composición forzadas,
 * y rechazo de contraseñas comunes o relacionadas con el negocio.
 */
export const validarFortalezaPassword = (plano: string, minimo: number = MIN_PASSWORD_WEB): string | null => {
    if (typeof plano !== 'string' || plano.length < minimo) return `La contraseña debe tener al menos ${minimo} caracteres.`;
    if (plano.length > MAX_PASSWORD) return `La contraseña no puede superar ${MAX_PASSWORD} caracteres.`;
    if (/^(.)\1+$/.test(plano)) return 'La contraseña no puede repetir un solo carácter.';
    const normalizada = plano.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '');
    const sinDigitos = normalizada.replace(/\d+/g, '').trim();
    if (PREVISIBLES.some(p => normalizada === p || sinDigitos === p || (p.length >= 6 && normalizada.includes(p.replace(/\s/g, ''))))) {
        return 'La contraseña es demasiado previsible. Usa una frase de varias palabras al azar.';
    }
    return null;
};

// ==========================================
// GENERADOR DE FRASES SEGURAS
// ==========================================
const PALABRAS = [
    'acero', 'aguila', 'alamo', 'ancla', 'antena', 'arena', 'arroyo', 'atlas', 'aurora', 'avena',
    'bahia', 'balsa', 'bambu', 'barco', 'bosque', 'brisa', 'brujula', 'bufalo', 'cabra', 'cactus',
    'calma', 'camino', 'canela', 'canoa', 'cantera', 'carbon', 'casco', 'castor', 'cebra', 'cedro',
    'cereza', 'cielo', 'cobre', 'cohete', 'colina', 'condor', 'coral', 'cometa', 'cuarzo', 'cumbre',
    'delfin', 'desierto', 'diamante', 'duna', 'eco', 'eclipse', 'faro', 'felino', 'fresno', 'galaxia',
    'garza', 'geiser', 'girasol', 'glaciar', 'granito', 'grillo', 'halcon', 'helecho', 'hierro', 'hormiga',
    'huerto', 'iglu', 'iman', 'isla', 'jaguar', 'jazmin', 'jirafa', 'junco', 'koala', 'lago',
    'laurel', 'lava', 'lechuza', 'lince', 'lirio', 'llama', 'lobo', 'loro', 'luna', 'madera',
    'mango', 'manzana', 'marea', 'marmol', 'medusa', 'melon', 'mirlo', 'molino', 'monte', 'musgo',
    'nectar', 'neblina', 'nogal', 'nube', 'nutria', 'oasis', 'ocaso', 'olivo', 'onda', 'orca',
    'oruga', 'pajaro', 'palmera', 'panal', 'pantera', 'papaya', 'pelicano', 'perla', 'pino', 'pirata',
    'planeta', 'plata', 'pluma', 'polar', 'pradera', 'puma', 'quinua', 'radar', 'rayo', 'refugio',
    'robot', 'roble', 'rubi', 'sabana', 'salmon', 'sauce', 'selva', 'sendero', 'sierra', 'sirena',
    'sol', 'tapir', 'tigre', 'tomate', 'tormenta', 'tortuga', 'trigo', 'trueno', 'tucan', 'tulipan',
    'tundra', 'turquesa', 'uva', 'valle', 'vapor', 'velero', 'verano', 'vicuna', 'violeta', 'volcan',
    'yate', 'yunque', 'zafiro', 'zorro', 'zinc', 'arcilla', 'bruma', 'cascada', 'dorado', 'esmeralda',
];

const azar = (n: number) => crypto.randomInt(0, n);

/**
 * Genera una frase segura: 5 palabras al azar + número de 3 cifras
 * (p. ej. "Puma-Cedro-Bahia-Rayo-Nube-482"). ~46 bits de entropía,
 * suficiente con bcrypt y límite de intentos, y fácil de escribir.
 */
export const generarFraseSegura = (): string => {
    const palabras = Array.from({ length: 5 }, () => {
        const p = PALABRAS[azar(PALABRAS.length)];
        return p.charAt(0).toUpperCase() + p.slice(1);
    });
    return `${palabras.join('-')}-${String(azar(1000)).padStart(3, '0')}`;
};
