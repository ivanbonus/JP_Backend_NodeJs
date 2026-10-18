import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { hashPassword, validarFortalezaPassword, esRolValido, ROLES_PANEL, ROLES, MIN_PASSWORD_PANEL, MIN_PASSWORD_WEB } from '../auth/security';

const publico = { id: true, nombre: true, email: true, rol: true, fecha: true, googleId: true } as const;

const aRespuesta = (u: { id: number; nombre: string; email: string; rol: string; fecha: Date; googleId: string | null }) => ({
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    fecha: u.fecha,
    conGoogle: !!u.googleId,
});

/** Lista el personal con acceso al panel (y opcionalmente todos los usuarios). */
export const listarUsuarios = async (req: Request, res: Response) => {
    try {
        const todos = req.query.todos === '1';
        const usuarios = await prisma.usuario.findMany({
            where: todos ? undefined : { rol: { in: ROLES_PANEL } },
            select: publico,
            orderBy: { fecha: 'desc' },
        });
        res.json(usuarios.map(aRespuesta));
    } catch (error) {
        console.error('Error al listar usuarios:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
};

export const crearUsuario = async (req: Request, res: Response) => {
    try {
        const nombre = typeof req.body?.nombre === 'string' ? req.body.nombre.trim() : '';
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const rol = req.body?.rol;

        if (!nombre || !email || !password || !rol) {
            res.status(400).json({ error: 'Nombre, correo, contraseña y rol son obligatorios.' });
            return;
        }
        if (!esRolValido(rol)) {
            res.status(400).json({ error: 'Rol no válido.' });
            return;
        }
        // El personal del panel necesita contraseñas más largas que los clientes de la web
        const debil = validarFortalezaPassword(password, ROLES_PANEL.includes(rol) ? MIN_PASSWORD_PANEL : MIN_PASSWORD_WEB);
        if (debil) {
            res.status(400).json({ error: debil });
            return;
        }
        if (await prisma.usuario.findUnique({ where: { email } })) {
            res.status(400).json({ error: 'Ya existe un usuario con ese correo.' });
            return;
        }

        const usuario = await prisma.usuario.create({
            data: { nombre, email, password: await hashPassword(password), rol },
            select: publico,
        });
        res.status(201).json(aRespuesta(usuario));
    } catch (error) {
        console.error('Error al crear usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
};

/** Cambia nombre, rol o contraseña. Para quitar el acceso al panel se asigna el rol USER. */
export const actualizarUsuario = async (req: Request, res: Response) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            res.status(400).json({ error: 'Id no válido.' });
            return;
        }
        const existente = await prisma.usuario.findUnique({ where: { id } });
        if (!existente) {
            res.status(404).json({ error: 'Usuario no encontrado.' });
            return;
        }

        const data: { nombre?: string; rol?: string; password?: string } = {};
        if (typeof req.body?.nombre === 'string' && req.body.nombre.trim()) data.nombre = req.body.nombre.trim();
        if (req.body?.rol !== undefined) {
            if (!esRolValido(req.body.rol)) {
                res.status(400).json({ error: 'Rol no válido.' });
                return;
            }
            // Un administrador no puede quitarse a sí mismo el rol de administrador
            if (req.usuario?.uid === id && req.body.rol !== ROLES.ADMIN) {
                res.status(400).json({ error: 'No puedes quitarte tu propio rol de administrador.' });
                return;
            }
            data.rol = req.body.rol;
        }
        if (req.body?.password) {
            const rolFinal = data.rol ?? existente.rol;
            const debil = validarFortalezaPassword(String(req.body.password), (ROLES_PANEL as string[]).includes(rolFinal) ? MIN_PASSWORD_PANEL : MIN_PASSWORD_WEB);
            if (debil) {
                res.status(400).json({ error: debil });
                return;
            }
            data.password = await hashPassword(String(req.body.password));
        }

        const usuario = await prisma.usuario.update({ where: { id }, data, select: publico });
        res.json(aRespuesta(usuario));
    } catch (error) {
        console.error('Error al actualizar usuario:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
};
