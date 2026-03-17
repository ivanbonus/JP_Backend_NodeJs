import { Request, Response } from 'express';
import { prisma } from '../index';

export const createCotizacion = async (req: Request, res: Response) => {
  try {
    const { nombre, email, telefono, vehiculo, servicio, mensaje } = req.body;

    if (!nombre || !email || !telefono || !vehiculo || !servicio || !mensaje) {
        res.status(400).json({ error: 'Faltan campos requeridos en el formulario.' });
        return;
    }

    const nuevaCotizacion = await prisma.cotizacion.create({
      data: {
        nombre,
        email,
        telefono,
        vehiculo,
        servicio,
        mensaje,
      }
    });

    res.status(201).json(nuevaCotizacion);
  } catch (error) {
    console.error('Error al crear cotización:', error);
    res.status(500).json({ error: 'Error del servidor al enviar cotización.' });
  }
};

export const getCotizaciones = async (req: Request, res: Response) => {
  try {
    const cotizaciones = await prisma.cotizacion.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(cotizaciones);
  } catch (error) {
    console.error('Error al obtener cotizaciones:', error);
    res.status(500).json({ error: 'Error al cargar las cotizaciones.' });
  }
};

export const updateCotizacionStatus = async (req: Request, res: Response) => {
  try {
      const { id } = req.params;
      const { estado } = req.body;

      if (!estado) {
          res.status(400).json({ error: 'Falta proveer el nuevo estado.' });
          return;
      }

      const updated = await prisma.cotizacion.update({
          where: { id: parseInt(id as string) },
          data: { estado }
      });

      res.json(updated);
  } catch (error) {
      console.error('Error al actualizar estado:', error);
      res.status(500).json({ error: 'No se pudo actualizar la cotización.' });
  }
};
