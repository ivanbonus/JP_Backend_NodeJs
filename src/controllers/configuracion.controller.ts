import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../prisma';
import { hashPassword, verificarPassword, validarFortalezaPassword, MIN_PASSWORD_PANEL } from '../auth/security';
import { guardarPassword } from '../auth/cuentas';

/** Nunca devolver la contraseña (ni su hash) al navegador */
const sinPassword = <T extends { password?: string | null }>(config: T) => {
    const { password, ...resto } = config;
    return resto;
};

export const getConfiguracion = async (req: Request, res: Response) => {
  try {
    let config = await prisma.configuracion.findFirst();
    if (!config) {
        config = await prisma.configuracion.create({ data: { password: await hashPassword(randomBytes(32).toString('hex')) } });
    }
    res.json(sinPassword(config));
  } catch (error) {
    console.error('Error al obtener configuración:', error);
    res.status(500).json({ error: 'Error del servidor' });
  }
};

export const updateConfiguracion = async (req: Request, res: Response) => {
  try {
    const {
      nombreResponsable, email, telefono, nombreTaller, ruc, direccion,
      passwordActual, nuevaPassword,
      notifEmail, notifSMS, notifApp
    } = req.body;

    let config = await prisma.configuracion.findFirst();
    if (!config) {
        config = await prisma.configuracion.create({ data: { password: await hashPassword(randomBytes(32).toString('hex')) } });
    }

    const dataToUpdate: any = {};
    if (nombreResponsable !== undefined) dataToUpdate.nombreResponsable = nombreResponsable;
    if (email !== undefined) dataToUpdate.email = email;
    if (telefono !== undefined) dataToUpdate.telefono = telefono;
    if (nombreTaller !== undefined) dataToUpdate.nombreTaller = nombreTaller;
    if (ruc !== undefined) dataToUpdate.ruc = ruc;
    if (direccion !== undefined) dataToUpdate.direccion = direccion;

    if (notifEmail !== undefined) dataToUpdate.notifEmail = Boolean(notifEmail);
    if (notifSMS !== undefined) dataToUpdate.notifSMS = Boolean(notifSMS);
    if (notifApp !== undefined) dataToUpdate.notifApp = Boolean(notifApp);

    // Cambio de contraseña del administrador principal
    if (nuevaPassword) {
        if (!passwordActual) {
            res.status(400).json({ error: 'Debes proporcionar la contraseña actual para cambiarla.' });
            return;
        }
        const { ok } = await verificarPassword(String(passwordActual), config.password);
        if (!ok) {
            res.status(400).json({ error: 'La contraseña actual es incorrecta. No se han guardado los cambios de seguridad.' });
            return;
        }
        const debil = validarFortalezaPassword(String(nuevaPassword), MIN_PASSWORD_PANEL);
        if (debil) {
            res.status(400).json({ error: debil });
            return;
        }
        // Guarda cifrada y cierra las demás sesiones (el panel debe usar /auth/cambiar-password para conservar la suya)
        await guardarPassword('config', await hashPassword(String(nuevaPassword)));
    }

    const updatedConfig = await prisma.configuracion.update({
      where: { id: config.id },
      data: dataToUpdate
    });

    res.json(sinPassword(updatedConfig));
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar configuración' });
  }
};
