import { Request, Response } from 'express';
import { prisma } from '../index';

export const getConfiguracion = async (req: Request, res: Response) => {
  try {
    let config = await prisma.configuracion.findFirst();
    if (!config) {
        config = await prisma.configuracion.create({ data: {} });
    }
    res.json(config);
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
        config = await prisma.configuracion.create({ data: {} });
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

    // Si se intentó cambiar contraseña
    if (passwordActual && nuevaPassword) {
        if (passwordActual !== config.password) {
             res.status(400).json({ error: 'La contraseña actual es incorrecta. No se ha guardado.' });
             return;
        }
        dataToUpdate.password = nuevaPassword;
    }

    const updatedConfig = await prisma.configuracion.update({
      where: { id: config.id },
      data: dataToUpdate
    });

    res.json(updatedConfig);
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar configuración' });
  }
};
