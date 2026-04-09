"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eliminarBloqueo = exports.obtenerBloqueos = exports.crearBloqueo = void 0;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
// Crear un bloqueo de horario
const crearBloqueo = async (req, res) => {
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
    }
    catch (error) {
        console.error("Error al crear bloqueo:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};
exports.crearBloqueo = crearBloqueo;
// Obtener todos los bloqueos
const obtenerBloqueos = async (_req, res) => {
    try {
        const bloqueos = await prisma.bloqueoCita.findMany({
            orderBy: { fecha: "asc" }
        });
        res.json(bloqueos);
    }
    catch (error) {
        console.error("Error al obtener bloqueos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};
exports.obtenerBloqueos = obtenerBloqueos;
// Eliminar un bloqueo
const eliminarBloqueo = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.bloqueoCita.delete({
            where: { id: Number(id) }
        });
        res.json({ message: "Bloqueo eliminado correctamente" });
    }
    catch (error) {
        console.error("Error al eliminar bloqueo:", error);
        res.status(500).json({ error: "No se pudo eliminar el bloqueo" });
    }
};
exports.eliminarBloqueo = eliminarBloqueo;
