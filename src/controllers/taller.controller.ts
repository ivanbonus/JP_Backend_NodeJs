import { Request, Response } from 'express';
import { prisma } from '../index'; // Importar Prisma instanciado en el entrypoint

export const getGuias = async (req: Request, res: Response) => {
  try {
    const guias = await prisma.numeroGuia.findMany({
      include: {
        cliente: true,
        vehiculo: true,
        tecnicos: true,
      },
      orderBy: { fechaRecepcion: 'desc' }
    });
    res.json(guias);
  } catch (error) {
    console.error('Error al obtener guías:', error);
    res.status(500).json({ error: 'Error del servidor al obtener las guías.' });
  }
};

export const deleteVehiculo = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.vehiculo.delete({ where: { id: Number(id) } });
    res.json({ message: 'Vehículo eliminado correctamente.' });
  } catch (error) {
    console.error('Error al borrar vehículo:', error);
    res.status(500).json({ error: 'No se pudo eliminar el vehículo. Es posible que tenga órdenes de trabajo asociadas.' });
  }
};

export const createGuia = async (req: Request, res: Response) => {
  try {
    const { clienteId, vehiculoId, diagnostico, observaciones, tecnicosIds } = req.body;
    
    // Validar Requeridos Básicos
    if (!clienteId || !vehiculoId) {
       res.status(400).json({ error: 'clienteId y vehiculoId son requeridos.' });
    }

    const nuevaGuia = await prisma.numeroGuia.create({
      data: {
        clienteId,
        vehiculoId,
        diagnostico,
        observaciones,
        tecnicos: tecnicosIds && tecnicosIds.length > 0 ? {
          connect: tecnicosIds.map((id: number) => ({ id }))
        } : undefined
      },
      include: { cliente: true, vehiculo: true, tecnicos: true }
    });

    res.status(201).json(nuevaGuia);
  } catch (error) {
    console.error('Error al crear guía:', error);
    res.status(500).json({ error: 'Error del servidor al crear la guía.' });
  }
};

export const updateGuia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { estado, diagnostico, observaciones, tecnicosIds } = req.body;

    // Actualizamos la guía
    const guiaActualizada = await prisma.numeroGuia.update({
      where: { id: Number(id) },
      data: {
        estado,
        diagnostico,
        observaciones,
        tecnicos: tecnicosIds ? {
          set: [], // Reseteamos la asignación actual
          connect: tecnicosIds.map((tid: number) => ({ id: tid })) // Conectamos los nuevos técnicos
        } : undefined
      },
      include: { cliente: true, vehiculo: true, tecnicos: true }
    });

    res.json(guiaActualizada);
  } catch (error) {
    console.error('Error al actualizar guía:', error);
    res.status(500).json({ error: 'Error del servidor al actualizar la guía.' });
  }
};

export const createVehiculo = async (req: Request, res: Response) => {
  try {
    const { placa, marca, modelo, anio, color, clienteId } = req.body;

    if (!placa || !marca || !modelo || !clienteId) {
       res.status(400).json({ error: 'placa, marca, modelo y clienteId son requeridos.' });
       return;
    }

    const nuevoVehiculo = await prisma.vehiculo.create({
      data: { placa, marca, modelo, anio: Number(anio) || null, color, clienteId: Number(clienteId) },
      include: { cliente: true }
    });

    res.status(201).json(nuevoVehiculo);
  } catch (error) {
    console.error('Error al registrar vehículo:', error);
    res.status(500).json({ error: 'Error del servidor al registrar el vehículo. Puede que la placa ya exista.' });
  }
};

export const getCitas = async (req: Request, res: Response) => {
  try {
    const citas = await prisma.cita.findMany({
      include: {
        cliente: true,
        vehiculo: true
      },
      orderBy: { fechaHora: 'asc' }
    });
    res.json(citas);
  } catch (error) {
    console.error('Error al obtener citas:', error);
    res.status(500).json({ error: 'Error del servidor al obtener las citas.' });
  }
};

export const createCita = async (req: Request, res: Response) => {
  try {
    const { fechaHora, motivo, clienteId, vehiculoId } = req.body;

    if (!fechaHora || !motivo || !clienteId || !vehiculoId) {
      res.status(400).json({ error: 'Faltan campos obligatorios para agendar la cita.' });
      return;
    }

    const nuevaCita = await prisma.cita.create({
      data: {
        fechaHora: new Date(fechaHora),
        motivo,
        clienteId: Number(clienteId),
        vehiculoId: Number(vehiculoId)
      },
      include: { cliente: true, vehiculo: true }
    });

    res.status(201).json(nuevaCita);
  } catch (error) {
    console.error('Error al agendar cita:', error);
    res.status(500).json({ error: 'Error del servidor al crear cita.' });
  }
};

export const deleteCita = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.cita.delete({ where: { id: Number(id) } });
    res.json({ message: 'Cita cancelada y eliminada correctamente.' });
  } catch (error) {
    console.error('Error al borrar cita:', error);
    res.status(500).json({ error: 'Error del servidor al cancelar la cita.' });
  }
};

export const deleteGuia = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.numeroGuia.delete({ where: { id: Number(id) } });
    res.json({ message: 'Guía eliminada correctamente del historial.' });
  } catch (error) {
    console.error('Error al borrar guía:', error);
    res.status(500).json({ error: 'Error del servidor al eliminar la guía.' });
  }
};
