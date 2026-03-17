"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteGuia = exports.deleteCita = exports.createCita = exports.getCitas = exports.createVehiculo = exports.updateGuia = exports.createGuia = exports.getGuias = void 0;
const index_1 = require("../index"); // Importar Prisma instanciado en el entrypoint
const getGuias = async (req, res) => {
    try {
        const guias = await index_1.prisma.numeroGuia.findMany({
            include: {
                cliente: true,
                vehiculo: true,
                tecnicos: true,
            },
            orderBy: { fechaRecepcion: 'desc' }
        });
        res.json(guias);
    }
    catch (error) {
        console.error('Error al obtener guías:', error);
        res.status(500).json({ error: 'Error del servidor al obtener las guías.' });
    }
};
exports.getGuias = getGuias;
const createGuia = async (req, res) => {
    try {
        const { clienteId, vehiculoId, diagnostico, observaciones, tecnicosIds } = req.body;
        // Validar Requeridos Básicos
        if (!clienteId || !vehiculoId) {
            res.status(400).json({ error: 'clienteId y vehiculoId son requeridos.' });
        }
        const nuevaGuia = await index_1.prisma.numeroGuia.create({
            data: {
                clienteId,
                vehiculoId,
                diagnostico,
                observaciones,
                tecnicos: tecnicosIds && tecnicosIds.length > 0 ? {
                    connect: tecnicosIds.map((id) => ({ id }))
                } : undefined
            },
            include: { cliente: true, vehiculo: true, tecnicos: true }
        });
        res.status(201).json(nuevaGuia);
    }
    catch (error) {
        console.error('Error al crear guía:', error);
        res.status(500).json({ error: 'Error del servidor al crear la guía.' });
    }
};
exports.createGuia = createGuia;
const updateGuia = async (req, res) => {
    try {
        const { id } = req.params;
        const { estado, diagnostico, observaciones, tecnicosIds } = req.body;
        // Actualizamos la guía
        const guiaActualizada = await index_1.prisma.numeroGuia.update({
            where: { id: Number(id) },
            data: {
                estado,
                diagnostico,
                observaciones,
                tecnicos: tecnicosIds ? {
                    set: [], // Reseteamos la asignación actual
                    connect: tecnicosIds.map((tid) => ({ id: tid })) // Conectamos los nuevos técnicos
                } : undefined
            },
            include: { cliente: true, vehiculo: true, tecnicos: true }
        });
        res.json(guiaActualizada);
    }
    catch (error) {
        console.error('Error al actualizar guía:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar la guía.' });
    }
};
exports.updateGuia = updateGuia;
const createVehiculo = async (req, res) => {
    try {
        const { placa, marca, modelo, anio, color, clienteId } = req.body;
        if (!placa || !marca || !modelo || !clienteId) {
            res.status(400).json({ error: 'placa, marca, modelo y clienteId son requeridos.' });
            return;
        }
        const nuevoVehiculo = await index_1.prisma.vehiculo.create({
            data: { placa, marca, modelo, anio: Number(anio) || null, color, clienteId: Number(clienteId) },
            include: { cliente: true }
        });
        res.status(201).json(nuevoVehiculo);
    }
    catch (error) {
        console.error('Error al registrar vehículo:', error);
        res.status(500).json({ error: 'Error del servidor al registrar el vehículo. Puede que la placa ya exista.' });
    }
};
exports.createVehiculo = createVehiculo;
const getCitas = async (req, res) => {
    try {
        const citas = await index_1.prisma.cita.findMany({
            include: {
                cliente: true,
                vehiculo: true
            },
            orderBy: { fechaHora: 'asc' }
        });
        res.json(citas);
    }
    catch (error) {
        console.error('Error al obtener citas:', error);
        res.status(500).json({ error: 'Error del servidor al obtener las citas.' });
    }
};
exports.getCitas = getCitas;
const createCita = async (req, res) => {
    try {
        const { fechaHora, motivo, clienteId, vehiculoId } = req.body;
        if (!fechaHora || !motivo || !clienteId || !vehiculoId) {
            res.status(400).json({ error: 'Faltan campos obligatorios para agendar la cita.' });
            return;
        }
        const nuevaCita = await index_1.prisma.cita.create({
            data: {
                fechaHora: new Date(fechaHora),
                motivo,
                clienteId: Number(clienteId),
                vehiculoId: Number(vehiculoId)
            },
            include: { cliente: true, vehiculo: true }
        });
        res.status(201).json(nuevaCita);
    }
    catch (error) {
        console.error('Error al agendar cita:', error);
        res.status(500).json({ error: 'Error del servidor al crear cita.' });
    }
};
exports.createCita = createCita;
const deleteCita = async (req, res) => {
    try {
        const { id } = req.params;
        await index_1.prisma.cita.delete({ where: { id: Number(id) } });
        res.json({ message: 'Cita cancelada y eliminada correctamente.' });
    }
    catch (error) {
        console.error('Error al borrar cita:', error);
        res.status(500).json({ error: 'Error del servidor al cancelar la cita.' });
    }
};
exports.deleteCita = deleteCita;
const deleteGuia = async (req, res) => {
    try {
        const { id } = req.params;
        await index_1.prisma.numeroGuia.delete({ where: { id: Number(id) } });
        res.json({ message: 'Guía eliminada correctamente del historial.' });
    }
    catch (error) {
        console.error('Error al borrar guía:', error);
        res.status(500).json({ error: 'Error del servidor al eliminar la guía.' });
    }
};
exports.deleteGuia = deleteGuia;
