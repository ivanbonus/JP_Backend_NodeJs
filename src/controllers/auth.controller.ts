import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { prisma } from '../prisma';
import {
    firmarSesion,
    firmarDesafio2FA,
    verificarDesafio2FA,
    hashPassword,
    verificarPassword,
    validarFortalezaPassword,
    MIN_PASSWORD_PANEL,
    MIN_PASSWORD_WEB,
    ROLES,
    ROLES_PANEL,
} from '../auth/security';
import { obtenerCuenta, refUsuario, guardarPassword, tieneDosPasos, dosPasosObligatorio, Cuenta, RefCuenta, MAX_DISPOSITIVOS } from '../auth/cuentas';
import {
    generarSecretoTotp,
    verificarCodigoTotp,
    uriOtpauth,
    generarCodigosRecuperacion,
    normalizarCodigoRecuperacion,
} from '../auth/totp';
import { cifrar, descifrar } from '../auth/cifrado';
import { registrarAuditoria, ipDe } from '../auth/auditoria';

// ==========================================
// Utilidades
// ==========================================
const estadoSeguridad = async (cuenta: Cuenta) => {
    const dosPasosActivo = await tieneDosPasos(cuenta.ref);
    return {
        debeCambiarPassword: cuenta.debeCambiarPassword,
        dosPasosActivo,
        debeConfigurar2FA: dosPasosObligatorio(cuenta.rol) && !dosPasosActivo,
    };
};

const datosUsuario = (c: Cuenta) => ({ id: c.uid, nombre: c.nombre, email: c.email, rol: c.rol });

const emitirSesion = async (
    res: Response, cuenta: Cuenta, mfa: boolean, message: string,
    extra: Record<string, unknown> = {}, dis: number | null = null
) => {
    res.json({
        message,
        token: firmarSesion({
            cuenta: cuenta.ref, uid: cuenta.uid, nombre: cuenta.nombre, email: cuenta.email,
            rol: cuenta.rol, ver: cuenta.sesionVersion, mfa, dis,
        }),
        user: datosUsuario(cuenta),
        seguridad: await estadoSeguridad(cuenta),
        ...extra,
    });
};

const minimoPara = (rol: string) => ((ROLES_PANEL as string[]).includes(rol) ? MIN_PASSWORD_PANEL : MIN_PASSWORD_WEB);

/** Busca la cuenta por correo/usuario y valida la contraseña (migrando contraseñas antiguas a hash). */
const autenticarPassword = async (login: string, password: string): Promise<Cuenta | null> => {
    const usuario = await prisma.usuario.findFirst({ where: { email: { equals: login, mode: 'insensitive' } } });
    if (usuario?.password) {
        const { ok, requiereMigracion } = await verificarPassword(password, usuario.password);
        if (ok) {
            if (requiereMigracion) {
                await prisma.usuario.update({ where: { id: usuario.id }, data: { password: await hashPassword(password) } });
            }
            return obtenerCuenta(refUsuario(usuario.id));
        }
    }

    const config = await prisma.configuracion.findFirst();
    if (config?.usuario && config.password && login.toLowerCase() === config.usuario.toLowerCase()) {
        const { ok, requiereMigracion } = await verificarPassword(password, config.password);
        if (ok) {
            if (requiereMigracion) {
                await prisma.configuracion.update({ where: { id: config.id }, data: { password: await hashPassword(password) } });
            }
            return obtenerCuenta('config');
        }
    }
    return null;
};

/**
 * Verifica un código TOTP contra los celulares confirmados de la cuenta, impidiendo
 * reutilizarlo (actualización atómica del último paso). Devuelve el celular que lo generó.
 */
const consumirCodigoTotp = async (ref: string, codigo: string): Promise<{ id: number; nombre: string } | null> => {
    const dispositivos = await prisma.dispositivoVerificacion.findMany({ where: { cuenta: ref, confirmado: true } });
    for (const d of dispositivos) {
        const paso = verificarCodigoTotp(descifrar(d.secretoCifrado), codigo, d.ultimoPaso);
        if (paso == null) continue;
        const r = await prisma.dispositivoVerificacion.updateMany({
            where: { id: d.id, OR: [{ ultimoPaso: null }, { ultimoPaso: { lt: paso } }] },
            data: { ultimoPaso: paso, ultimoUso: new Date() },
        });
        return r.count === 1 ? { id: d.id, nombre: d.nombre } : null;
    }
    return null;
};

const listarDispositivos = (ref: string) =>
    prisma.dispositivoVerificacion.findMany({
        where: { cuenta: ref, confirmado: true },
        select: { id: true, nombre: true, creadoEn: true, ultimoUso: true },
        orderBy: { creadoEn: 'asc' },
    });

/** Verifica y consume (un solo uso) un código de recuperación. */
const consumirCodigoRecuperacion = async (ref: string, codigo: string): Promise<{ ok: boolean; restantes: number }> => {
    const sf = await prisma.segundoFactor.findUnique({ where: { cuenta: ref } });
    if (!sf?.activo) return { ok: false, restantes: 0 };
    const normalizado = normalizarCodigoRecuperacion(codigo);
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizado)) return { ok: false, restantes: sf.codigosRecuperacion.length };
    for (const hash of sf.codigosRecuperacion) {
        if (await bcrypt.compare(normalizado, hash)) {
            const restantes = sf.codigosRecuperacion.filter(h => h !== hash);
            await prisma.segundoFactor.update({ where: { cuenta: ref }, data: { codigosRecuperacion: restantes } });
            return { ok: true, restantes: restantes.length };
        }
    }
    return { ok: false, restantes: sf.codigosRecuperacion.length };
};

const crearCodigosRecuperacion = async () => {
    const codigos = generarCodigosRecuperacion(10);
    const hashes = await Promise.all(codigos.map(c => bcrypt.hash(c, 10)));
    return { codigos, hashes };
};

// ==========================================
// Inicio de sesión
// ==========================================
export const login = async (req: Request, res: Response) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        if (!email || !password) {
            res.status(400).json({ error: 'Debes enviar usuario/email y contraseña' });
            return;
        }

        const cuenta = await autenticarPassword(email, password);
        if (!cuenta) {
            void registrarAuditoria({ cuenta: email, accion: 'LOGIN_FALLIDO', entidad: 'auth', ip: ipDe(req) });
            res.status(401).json({ error: 'Credenciales inválidas' });
            return;
        }

        if (await tieneDosPasos(cuenta.ref)) {
            res.json({
                requiere2FA: true,
                desafio: firmarDesafio2FA(cuenta.ref, cuenta.sesionVersion),
                message: 'Ingresa el código de tu aplicación de autenticación.',
            });
            return;
        }

        void registrarAuditoria({ cuenta: cuenta.email, rol: cuenta.rol, accion: 'LOGIN_OK', entidad: 'auth', ip: ipDe(req) });
        await emitirSesion(res, cuenta, false, 'Login exitoso');
    } catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error del servidor al intentar iniciar sesión' });
    }
};

/** Segundo paso del inicio de sesión: código de 6 dígitos o código de recuperación. */
export const login2FA = async (req: Request, res: Response) => {
    try {
        const desafio = verificarDesafio2FA(typeof req.body?.desafio === 'string' ? req.body.desafio : '');
        const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo.trim() : '';
        if (!desafio) {
            res.status(401).json({ error: 'El tiempo para ingresar el código expiró. Vuelve a iniciar sesión.' });
            return;
        }
        const cuenta = await obtenerCuenta(desafio.cuenta);
        if (!cuenta || cuenta.sesionVersion !== desafio.ver) {
            res.status(401).json({ error: 'Vuelve a iniciar sesión.' });
            return;
        }

        const esTotp = /^\d{6}$/.test(codigo.replace(/\s/g, ''));
        let ok = false;
        let restantes: number | undefined;
        let dispositivo: { id: number; nombre: string } | null = null;
        if (esTotp) {
            dispositivo = await consumirCodigoTotp(cuenta.ref, codigo);
            ok = !!dispositivo;
        } else {
            const r = await consumirCodigoRecuperacion(cuenta.ref, codigo);
            ok = r.ok;
            restantes = r.restantes;
        }

        if (!ok) {
            void registrarAuditoria({ cuenta: cuenta.email, rol: cuenta.rol, accion: 'LOGIN_2FA_FALLIDO', entidad: 'auth', ip: ipDe(req) });
            res.status(401).json({ error: 'Código incorrecto o ya utilizado.' });
            return;
        }

        void registrarAuditoria({
            cuenta: cuenta.email, rol: cuenta.rol, entidad: 'auth', ip: ipDe(req),
            accion: esTotp ? 'LOGIN_OK' : 'LOGIN_OK_CODIGO_RECUPERACION',
            detalle: esTotp ? { dispositivo: dispositivo!.nombre } : { codigosRestantes: restantes },
        });
        await emitirSesion(
            res, cuenta, true, 'Login exitoso',
            esTotp ? {} : { codigosRecuperacionRestantes: restantes },
            dispositivo?.id ?? null
        );
    } catch (error) {
        console.error('Error en login 2FA:', error);
        res.status(500).json({ error: 'Error del servidor al verificar el código' });
    }
};

/** Registro público: siempre crea clientes de la web (rol USER), nunca personal del panel. */
export const register = async (req: Request, res: Response) => {
    try {
        const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

        if (!nombre || !email || !password) {
            res.status(400).json({ error: 'Todos los campos son obligatorios' });
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ error: 'El correo no es válido' });
            return;
        }
        const debil = validarFortalezaPassword(password);
        if (debil) {
            res.status(400).json({ error: debil });
            return;
        }

        const existe = await prisma.usuario.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
        if (existe) {
            res.status(400).json({ error: 'El correo ya está registrado' });
            return;
        }

        const nuevo = await prisma.usuario.create({
            data: { nombre, email, password: await hashPassword(password), rol: ROLES.USER },
        });
        const cuenta = await obtenerCuenta(refUsuario(nuevo.id));
        res.status(201);
        await emitirSesion(res, cuenta!, false, 'Registro exitoso');
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error del servidor al registrar' });
    }
};

export const googleLogin = async (req: Request, res: Response) => {
    try {
        const credential = typeof req.body?.credential === 'string' ? req.body.credential : '';
        if (!credential) {
            res.status(400).json({ error: 'No se recibió la credencial de Google' });
            return;
        }

        const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
        const payload: any = await googleRes.json();

        if (!googleRes.ok || payload.error) {
            res.status(401).json({ error: 'Token de Google inválido' });
            return;
        }

        // El token debe haber sido emitido para ESTA aplicación
        const clientId = process.env.GOOGLE_CLIENT_ID;
        if (clientId) {
            if (payload.aud !== clientId) {
                res.status(401).json({ error: 'Token de Google no corresponde a esta aplicación' });
                return;
            }
        } else {
            console.warn('[SEGURIDAD] GOOGLE_CLIENT_ID no definido: no se puede verificar el destinatario del token de Google.');
        }
        if (payload.email_verified !== 'true' && payload.email_verified !== true) {
            res.status(401).json({ error: 'El correo de Google no está verificado' });
            return;
        }

        const { email, name, sub: googleId } = payload;

        let usuario = await prisma.usuario.findUnique({ where: { email } });
        if (!usuario) {
            usuario = await prisma.usuario.create({
                data: { nombre: name || email, email, googleId, rol: ROLES.USER },
            });
        } else if (!usuario.googleId) {
            usuario = await prisma.usuario.update({ where: { email }, data: { googleId } });
        } else if (usuario.googleId !== googleId) {
            res.status(401).json({ error: 'La cuenta de Google no coincide con el usuario registrado' });
            return;
        }

        const cuenta = (await obtenerCuenta(refUsuario(usuario.id)))!;
        // Google no reemplaza el segundo factor del sistema
        if (await tieneDosPasos(cuenta.ref)) {
            res.json({ requiere2FA: true, desafio: firmarDesafio2FA(cuenta.ref, cuenta.sesionVersion) });
            return;
        }
        void registrarAuditoria({ cuenta: cuenta.email, rol: cuenta.rol, accion: 'LOGIN_OK_GOOGLE', entidad: 'auth', ip: ipDe(req) });
        await emitirSesion(res, cuenta, false, 'Login con Google exitoso');
    } catch (error) {
        console.error('Error en googleLogin:', error);
        res.status(500).json({ error: 'Error al procesar login de Google' });
    }
};

// ==========================================
// Sesión actual y cambio de contraseña
// ==========================================
export const me = async (req: Request, res: Response) => {
    const cuenta = await obtenerCuenta(req.usuario!.cuenta);
    if (!cuenta) {
        res.status(401).json({ error: 'Sesión no válida' });
        return;
    }
    res.json({ user: datosUsuario(cuenta), seguridad: req.seguridad });
};

export const cambiarPassword = async (req: Request, res: Response) => {
    try {
        const actual = typeof req.body?.actual === 'string' ? req.body.actual : '';
        const nueva = typeof req.body?.nueva === 'string' ? req.body.nueva : '';
        const cuenta = await obtenerCuenta(req.usuario!.cuenta);
        if (!cuenta) {
            res.status(401).json({ error: 'Sesión no válida' });
            return;
        }
        if (!actual || !nueva) {
            res.status(400).json({ error: 'Ingresa tu contraseña actual y la nueva.' });
            return;
        }
        const { ok } = await verificarPassword(actual, cuenta.passwordHash);
        if (!ok) {
            res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
            return;
        }
        if (actual === nueva) {
            res.status(400).json({ error: 'La nueva contraseña debe ser distinta de la actual.' });
            return;
        }
        const debil = validarFortalezaPassword(nueva, minimoPara(cuenta.rol));
        if (debil) {
            res.status(400).json({ error: debil });
            return;
        }

        await guardarPassword(cuenta.ref, await hashPassword(nueva));
        void registrarAuditoria({ cuenta: cuenta.email, rol: cuenta.rol, accion: 'PASSWORD_CAMBIADA', entidad: 'auth', ip: ipDe(req) });

        // Las demás sesiones quedan cerradas; esta continúa con un token nuevo
        const actualizada = (await obtenerCuenta(cuenta.ref))!;
        await emitirSesion(res, actualizada, req.usuario!.mfa, 'Contraseña actualizada', {}, req.usuario!.dis);
    } catch (error) {
        console.error('Error al cambiar contraseña:', error);
        res.status(500).json({ error: 'Error del servidor al cambiar la contraseña' });
    }
};

// ==========================================
// Verificación en dos pasos
// ==========================================
const nombreValido = (valor: unknown) => (typeof valor === 'string' ? valor.trim().replace(/\s+/g, ' ').slice(0, 40) : '');

export const estado2FA = async (req: Request, res: Response) => {
    const ref = req.usuario!.cuenta;
    const sf = await prisma.segundoFactor.findUnique({ where: { cuenta: ref } });
    const dispositivos = sf?.activo ? await listarDispositivos(ref) : [];
    res.json({
        activo: !!sf?.activo && dispositivos.length > 0,
        obligatorio: dosPasosObligatorio(req.usuario!.rol),
        activadoEn: sf?.activadoEn ?? null,
        codigosRecuperacionRestantes: sf?.activo ? sf.codigosRecuperacion.length : 0,
        dispositivos: dispositivos.map(d => ({ ...d, esteDispositivo: d.id === req.usuario!.dis })),
        maxDispositivos: MAX_DISPOSITIVOS,
    });
};

/**
 * Registra un celular nuevo y devuelve su QR.
 * - Primera activación: no pide código.
 * - Si ya hay celulares: exige un código vigente de cualquiera de ellos.
 */
export const iniciar2FA = async (req: Request, res: Response) => {
    try {
        const ref = req.usuario!.cuenta as RefCuenta;
        const cuenta = (await obtenerCuenta(ref))!;
        const activa = await tieneDosPasos(ref);
        const nombre = nombreValido(req.body?.nombre) || (activa ? '' : 'Celular principal');

        if (!nombre) {
            res.status(400).json({ error: 'Ponle un nombre a este celular (por ejemplo, "Celular de Juan").' });
            return;
        }
        const confirmados = await listarDispositivos(ref);
        if (confirmados.some(d => d.nombre.toLowerCase() === nombre.toLowerCase())) {
            res.status(400).json({ error: 'Ya hay un celular con ese nombre.' });
            return;
        }
        if (confirmados.length >= MAX_DISPOSITIVOS) {
            res.status(400).json({ error: `Puedes tener hasta ${MAX_DISPOSITIVOS} celulares. Quita uno antes de agregar otro.` });
            return;
        }
        if (activa) {
            const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo : '';
            if (!(await consumirCodigoTotp(ref, codigo))) {
                res.status(400).json({ error: 'Para agregar un celular ingresa el código actual de uno ya registrado.' });
                return;
            }
        }

        // Un solo celular pendiente de confirmar a la vez
        const secreto = generarSecretoTotp();
        const [, dispositivo] = await prisma.$transaction([
            prisma.dispositivoVerificacion.deleteMany({ where: { cuenta: ref, confirmado: false } }),
            prisma.dispositivoVerificacion.create({ data: { cuenta: ref, nombre, secretoCifrado: cifrar(secreto) } }),
        ]);

        const uri = uriOtpauth(secreto, cuenta.login);
        res.json({
            dispositivoId: dispositivo.id,
            nombre,
            secreto: secreto.replace(/(.{4})/g, '$1 ').trim(), // para escribirlo a mano si no se puede escanear
            uri,
            qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }),
        });
    } catch (error) {
        console.error('Error al iniciar 2FA:', error);
        res.status(500).json({ error: 'No se pudo iniciar la configuración' });
    }
};

/**
 * Confirma el código del celular nuevo.
 * - Primera activación: activa la verificación y entrega los códigos de recuperación (una sola vez).
 * - Celular adicional: solo queda registrado.
 */
export const activar2FA = async (req: Request, res: Response) => {
    try {
        const ref = req.usuario!.cuenta as RefCuenta;
        const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo : '';
        const pendiente = await prisma.dispositivoVerificacion.findFirst({
            where: { cuenta: ref, confirmado: false, ...(Number.isInteger(req.body?.dispositivoId) ? { id: req.body.dispositivoId } : {}) },
            orderBy: { creadoEn: 'desc' },
        });
        if (!pendiente) {
            res.status(400).json({ error: 'Primero genera el código QR.' });
            return;
        }

        const paso = verificarCodigoTotp(descifrar(pendiente.secretoCifrado), codigo);
        if (paso == null) {
            res.status(400).json({ error: 'El código no coincide. Revisa la hora del celular e inténtalo de nuevo.' });
            return;
        }

        const yaActiva = await tieneDosPasos(ref);
        const confirmar = prisma.dispositivoVerificacion.update({
            where: { id: pendiente.id },
            data: { confirmado: true, ultimoPaso: paso, ultimoUso: new Date() },
        });

        if (yaActiva) {
            await confirmar;
            void registrarAuditoria({
                cuenta: req.usuario!.email, rol: req.usuario!.rol, entidad: 'auth', ip: ipDe(req),
                accion: '2FA_DISPOSITIVO_AGREGADO', detalle: { dispositivo: pendiente.nombre },
            });
            res.json({ message: `"${pendiente.nombre}" quedó registrado.`, dispositivo: { id: pendiente.id, nombre: pendiente.nombre } });
            return;
        }

        // Primera activación
        const { codigos, hashes } = await crearCodigosRecuperacion();
        await prisma.$transaction([
            confirmar,
            prisma.segundoFactor.upsert({
                where: { cuenta: ref },
                create: { cuenta: ref, activo: true, codigosRecuperacion: hashes, activadoEn: new Date() },
                update: { activo: true, codigosRecuperacion: hashes, activadoEn: new Date() },
            }),
            ref === 'config'
                ? prisma.configuracion.updateMany({ data: { sesionVersion: { increment: 1 } } })
                : prisma.usuario.update({ where: { id: Number(ref.split(':')[1]) }, data: { sesionVersion: { increment: 1 } } }),
        ]);

        const cuenta = (await obtenerCuenta(ref))!;
        void registrarAuditoria({
            cuenta: cuenta.email, rol: cuenta.rol, entidad: 'auth', ip: ipDe(req),
            accion: '2FA_ACTIVADO', detalle: { dispositivo: pendiente.nombre },
        });
        await emitirSesion(res, cuenta, true, 'Verificación en dos pasos activada', { codigosRecuperacion: codigos }, pendiente.id);
    } catch (error) {
        console.error('Error al activar 2FA:', error);
        res.status(500).json({ error: 'No se pudo activar la verificación' });
    }
};

/** Quita un celular. Exige un código vigente y que quede al menos uno. Cierra las sesiones abiertas con él. */
export const eliminarDispositivo2FA = async (req: Request, res: Response) => {
    try {
        const ref = req.usuario!.cuenta;
        const id = Number(req.params.id);
        const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo : '';
        const dispositivo = await prisma.dispositivoVerificacion.findFirst({ where: { id, cuenta: ref, confirmado: true } });
        if (!dispositivo) {
            res.status(404).json({ error: 'Celular no encontrado.' });
            return;
        }
        const total = await prisma.dispositivoVerificacion.count({ where: { cuenta: ref, confirmado: true } });
        if (total <= 1) {
            res.status(400).json({ error: 'Debe quedar al menos un celular registrado. Agrega otro antes de quitar este.' });
            return;
        }
        if (!(await consumirCodigoTotp(ref, codigo))) {
            res.status(400).json({ error: 'Código incorrecto o ya utilizado.' });
            return;
        }
        await prisma.dispositivoVerificacion.delete({ where: { id } });
        void registrarAuditoria({
            cuenta: req.usuario!.email, rol: req.usuario!.rol, entidad: 'auth', ip: ipDe(req),
            accion: '2FA_DISPOSITIVO_ELIMINADO', detalle: { dispositivo: dispositivo.nombre },
        });
        res.json({ message: `"${dispositivo.nombre}" ya no puede generar códigos.`, cerrarSesion: req.usuario!.dis === id });
    } catch (error) {
        console.error('Error al eliminar celular:', error);
        res.status(500).json({ error: 'No se pudo quitar el celular' });
    }
};

/** Genera 10 códigos de recuperación nuevos (los anteriores dejan de servir). */
export const regenerarCodigos2FA = async (req: Request, res: Response) => {
    try {
        const ref = req.usuario!.cuenta;
        const codigo = typeof req.body?.codigo === 'string' ? req.body.codigo : '';
        if (!(await consumirCodigoTotp(ref, codigo))) {
            res.status(400).json({ error: 'Código incorrecto o ya utilizado.' });
            return;
        }
        const { codigos, hashes } = await crearCodigosRecuperacion();
        await prisma.segundoFactor.update({ where: { cuenta: ref }, data: { codigosRecuperacion: hashes } });
        void registrarAuditoria({ cuenta: req.usuario!.email, rol: req.usuario!.rol, accion: '2FA_CODIGOS_REGENERADOS', entidad: 'auth', ip: ipDe(req) });
        res.json({ codigosRecuperacion: codigos });
    } catch (error) {
        console.error('Error al regenerar códigos:', error);
        res.status(500).json({ error: 'No se pudieron generar los códigos' });
    }
};
