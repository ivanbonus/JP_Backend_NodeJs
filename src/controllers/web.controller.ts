import { Request, Response } from 'express';
import { prisma } from '../index';

export const crearResena = async (req: Request, res: Response) => {
  try {
    const { nombre, email, vehiculo, servicio, calificacion, comentario } = req.body;

    if (!nombre || calificacion === undefined || !comentario) {
        res.status(400).json({ error: 'Nombre, calificación y comentario son obligatorios.' });
        return;
    }

    const nuevaResena = await prisma.resena.create({
      data: {
        nombre,
        email,
        vehiculo,
        servicio,
        calificacion: parseFloat(calificacion),
        comentario,
        estado: 'Pendiente'
      }
    });

    res.status(201).json(nuevaResena);
  } catch (error) {
    console.error('Error al crear reseña:', error);
    res.status(500).json({ error: 'Error del servidor al guardar reseña.' });
  }
};

export const obtenerResenasPublicadas = async (req: Request, res: Response) => {
  try {
    const resenas = await prisma.resena.findMany({
        where: { estado: 'Publicada' },
        orderBy: { fecha: 'desc' }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error al obtener reseñas publicadas:', error);
    res.status(500).json({ error: 'Error al cargar reseñas.' });
  }
};

export const obtenerTodasResenas = async (req: Request, res: Response) => {
  try {
    const resenas = await prisma.resena.findMany({
        orderBy: { fecha: 'desc' }
    });
    res.json(resenas);
  } catch (error) {
    console.error('Error al obtener todas las reseñas:', error);
    res.status(500).json({ error: 'Error al cargar reseñas.' });
  }
};

export const actualizarEstadoResena = async (req: Request, res: Response) => {
  try {
      const { id } = req.params;
      const { estado, respuesta } = req.body;

      const dataToUpdate: any = {};
      if (estado !== undefined) dataToUpdate.estado = estado;
      if (respuesta !== undefined) dataToUpdate.respuesta = respuesta;

      const resenaActualizada = await prisma.resena.update({
          where: { id: parseInt(id as string) },
          data: dataToUpdate
      });

      res.json(resenaActualizada);
  } catch (error) {
      console.error('Error al actualizar reseña:', error);
      res.status(500).json({ error: 'Error al actualizar reseña.' });
  }
};

export const eliminarResena = async (req: Request, res: Response) => {
  try {
      const { id } = req.params;
      await prisma.resena.delete({
          where: { id: parseInt(id as string) }
      });
      res.json({ message: 'Reseña eliminada correctamente' });
  } catch (error) {
      console.error('Error al eliminar reseña:', error);
      res.status(500).json({ error: 'Error al eliminar reseña.' });
  }
};
