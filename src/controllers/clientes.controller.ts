import { Request, Response } from 'express';
import { prisma } from '../index';

export const getClientes = async (req: Request, res: Response) => {
  try {
    const clientes = await prisma.cliente.findMany({
      include: {
        vehiculos: true
      },
      orderBy: { nombre: 'asc' }
    });
    res.json(clientes);
  } catch (error) {
    console.error('Error al obtener clientes:', error);
    res.status(500).json({ error: 'Error del servidor al obtener clientes.' });
  }
};

export const createCliente = async (req: Request, res: Response) => {
  try {
    const { nombre, apellidos, documento, email, telefono, direccion } = req.body;
    
    if (!nombre) {
      res.status(400).json({ error: 'El nombre es obligatorio.' });
    }

    const nuevoCliente = await prisma.cliente.create({
      data: { nombre, apellidos, documento, email, telefono, direccion }
    });

    res.status(201).json(nuevoCliente);
  } catch (error) {
    console.error('Error al crear cliente:', error);
    res.status(500).json({ error: 'Error del servidor al crear cliente.' });
  }
};
