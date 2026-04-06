import { Request, Response } from 'express';
import { prisma } from '../prisma';

export const getPersonal = async (req: Request, res: Response) => {
  try {
    const personal = await prisma.trabajador.findMany({
      orderBy: { nombre: 'asc' }
    });
    res.json(personal);
  } catch (error) {
    console.error('Error al obtener personal:', error);
    res.status(500).json({ error: 'Error del servidor al obtener el personal.' });
  }
};

export const createTrabajador = async (req: Request, res: Response) => {
  try {
    const { 
      nombre, apellidos, dni, rol, telefono, estado,
      sueldoBase, porcentajeAfp, porcentajeSeguro,
      email, direccion, observaciones, fechaIngreso, proximoPago 
    } = req.body;
    
    if (!nombre || !apellidos || !dni) {
      res.status(400).json({ error: 'Faltan campos obligatorios para el trabajador.' });
      return;
    }

    const nuevoPersonal = await prisma.trabajador.create({
      data: { 
        nombre, 
        apellidos, 
        dni, 
        rol, 
        telefono,
        estado: estado !== undefined ? Boolean(estado) : true,
        sueldoBase: sueldoBase ? Number(sueldoBase) : 0,
        porcentajeAfp: porcentajeAfp ? Number(porcentajeAfp) : 0,
        porcentajeSeguro: porcentajeSeguro ? Number(porcentajeSeguro) : 0,
        email,
        direccion,
        observaciones,
        fechaIngreso,
        proximoPago
      }
    });

    res.status(201).json(nuevoPersonal);
  } catch (error: any) {
    console.error('Error al crear trabajador:', error);
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'El DNI ingresado ya está registrado en el sistema.' });
      return;
    }
    res.status(500).json({ error: 'Error del servidor al crear trabajador.', details: error.message, stack: error.stack });
  }
};

export const updateTrabajador = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      nombre, apellidos, dni, rol, telefono, estado, 
      sueldoBase, porcentajeAfp, porcentajeSeguro,
      email, direccion, observaciones, fechaIngreso, proximoPago 
    } = req.body;

    const dataToUpdate: any = {};
    if (nombre !== undefined) dataToUpdate.nombre = nombre;
    if (apellidos !== undefined) dataToUpdate.apellidos = apellidos;
    if (dni !== undefined) dataToUpdate.dni = dni;
    if (rol !== undefined) dataToUpdate.rol = rol;
    if (telefono !== undefined) dataToUpdate.telefono = telefono;
    if (estado !== undefined) dataToUpdate.estado = Boolean(estado);
    if (sueldoBase !== undefined) dataToUpdate.sueldoBase = Number(sueldoBase);
    if (porcentajeAfp !== undefined) dataToUpdate.porcentajeAfp = Number(porcentajeAfp);
    if (porcentajeSeguro !== undefined) dataToUpdate.porcentajeSeguro = Number(porcentajeSeguro);
    if (email !== undefined) dataToUpdate.email = email;
    if (direccion !== undefined) dataToUpdate.direccion = direccion;
    if (observaciones !== undefined) dataToUpdate.observaciones = observaciones;
    if (fechaIngreso !== undefined) dataToUpdate.fechaIngreso = fechaIngreso;
    if (proximoPago !== undefined) dataToUpdate.proximoPago = proximoPago;

    const trabajadorActualizado = await prisma.trabajador.update({
      where: { id: Number(id) },
      data: dataToUpdate
    });

    res.json(trabajadorActualizado);
  } catch (error) {
    console.error('Error al actualizar trabajador:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar trabajador.' });
  }
};

export const deleteTrabajador = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    // Primero, si el trabajador tiene asistencias asociadas hay que eliminarlas
    await prisma.asistencia.deleteMany({
      where: { trabajadorId: Number(id) }
    });

    await prisma.trabajador.delete({
      where: { id: Number(id) }
    });

    res.json({ message: 'Trabajador eliminado exitosamente.' });
  } catch (error: any) {
    console.error('Error al eliminar trabajador:', error);
    res.status(500).json({ error: 'Error del servidor al eliminar trabajador.', details: error.message });
  }
};
