import { Request, Response } from 'express';
import { prisma } from '../prisma';

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ error: 'Debes enviar usuario/email y contraseña' });
        return;
    }

    // 1. Intentar buscar en la nueva tabla de Usuarios
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (usuario && usuario.password === password) {
        res.json({
            message: 'Login exitoso',
            user: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }
        });
        return;
    }

    // 2. Compatibilidad con legacy admin (configuracion)
    let config = await prisma.configuracion.findFirst();
    if (config && email === config.usuario && password === config.password) {
        res.json({
             message: 'Login exitoso (Admin)', 
             user: { nombre: config.nombreResponsable, email: config.email, rol: 'ADMIN' } 
        });
        return;
    }

    res.status(401).json({ error: 'Credenciales inválidas' });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ error: 'Error del servidor al intentar iniciar sesión' });
  }
};

export const register = async (req: Request, res: Response) => {
    try {
        const { nombre, email, password } = req.body;
        if (!nombre || !email || !password) {
            res.status(400).json({ error: 'Todos los campos son obligatorios' });
            return;
        }

        const existe = await prisma.usuario.findUnique({ where: { email } });
        if (existe) {
            res.status(400).json({ error: 'El correo ya está registrado' });
            return;
        }

        const nuevoUsuario = await prisma.usuario.create({
            data: { nombre, email, password, rol: 'USER' }
        });

        res.status(201).json({
            message: 'Registro exitoso',
            user: { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre, email: nuevoUsuario.email, rol: nuevoUsuario.rol }
        });
    } catch (error) {
        console.error('Error en registro:', error);
        res.status(500).json({ error: 'Error del servidor al registrar' });
    }
};

export const googleLogin = async (req: Request, res: Response) => {
    try {
        const { credential } = req.body; // Token enviado por Google One Tap / Login
        if (!credential) {
            res.status(400).json({ error: 'No se recibió la credencial de Google' });
            return;
        }

        // En una implementación real se verificaría el token con google-auth-library
        // https://oauth2.googleapis.com/tokeninfo?id_token=XYZ
        const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        const payload: any = await googleRes.json();

        if (payload.error) {
            res.status(401).json({ error: 'Token de Google inválido' });
            return;
        }

        const { email, name, sub: googleId } = payload;

        // Buscar o crear usuario
        let usuario = await prisma.usuario.findUnique({ where: { email } });

        if (!usuario) {
            usuario = await prisma.usuario.create({
                data: {
                    nombre: name,
                    email: email,
                    googleId: googleId,
                    rol: 'USER' // Por defecto usuarios de Google son USER
                }
            });
        } else if (!usuario.googleId) {
            // Vincular cuenta si ya existía por email manual
            usuario = await prisma.usuario.update({
                where: { email },
                data: { googleId }
            });
        }

        res.json({
            message: 'Login con Google exitoso',
            user: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }
        });

    } catch (error) {
        console.error('Error en googleLogin:', error);
        res.status(500).json({ error: 'Error al procesar login de Google' });
    }
};
