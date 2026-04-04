import { Request, Response } from 'express';
import { prisma } from '../index';

export const crearCitaWeb = async (req: Request, res: Response) => {
  try {
    const { nombre, email, telefono, vehiculo, mensaje, fechaCita } = req.body;

    if (!nombre || !telefono || !fechaCita) {
      res.status(400).json({ error: 'Nombre, teléfono y fecha de cita son obligatorios.' });
      return;
    }

    const nuevaCita = await prisma.citaWeb.create({
      data: {
        nombre,
        email: email || '',
        telefono,
        vehiculo,
        mensaje: mensaje || '',
        fechaCita: new Date(fechaCita),
        estado: 'PENDIENTE'
      }
    });

    res.status(201).json(nuevaCita);
  } catch (error) {
    console.error('Error al crear cita web:', error);
    res.status(500).json({ error: 'Error del servidor al agendar la cita.' });
  }
};

export const obtenerCitasWeb = async (req: Request, res: Response) => {
  try {
    const citas = await prisma.citaWeb.findMany({
      orderBy: { fechaSolicitud: 'desc' }
    });
    res.json(citas);
  } catch (error) {
    console.error('Error al obtener citas web:', error);
    res.status(500).json({ error: 'Error al cargar las citas.' });
  }
};

export const actualizarEstadoCitaWeb = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    const citaActualizada = await prisma.citaWeb.update({
      where: { id: parseInt(id as string) },
      data: { estado }
    });

    res.json(citaActualizada);
  } catch (error) {
    console.error('Error al actualizar estado de cita web:', error);
    res.status(500).json({ error: 'Error al actualizar la cita.' });
  }
};
