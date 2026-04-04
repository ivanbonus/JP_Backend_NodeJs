import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Crear un bloqueo de horario
export const crearBloqueo = async (req: Request, res: Response) => {
    try {
        const { fecha, todoElDia, horaInicio, horaFin, motivo } = req.body;
        
        const nuevoBloqueo = await prisma.bloqueoCita.create({
            data: {
                fecha: new Date(fecha),
                todoElDia,
                horaInicio,
                horaFin,
                motivo
            }
        });

        res.status(201).json(nuevoBloqueo);
    } catch (error) {
        console.error("Error al crear bloqueo:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// Obtener todos los bloqueos
export const obtenerBloqueos = async (_req: Request, res: Response) => {
    try {
        const bloqueos = await prisma.bloqueoCita.findMany({
            orderBy: { fecha: "asc" }
        });
        res.json(bloqueos);
    } catch (error) {
        console.error("Error al obtener bloqueos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

// Eliminar un bloqueo
export const eliminarBloqueo = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        await prisma.bloqueoCita.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Bloqueo eliminado correctamente" });
    } catch (error) {
        console.error("Error al eliminar bloqueo:", error);
        res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
    }
};
