"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCliente = exports.updateCliente = exports.createCliente = exports.getClientes = void 0;
const prisma_1 = require("../prisma");
const getClientes = async (req, res) => {
    try {
        const clientes = await prisma_1.prisma.cliente.findMany({
            include: {
                vehiculos: true
            },
            orderBy: { nombre: 'asc' }
        });
        res.json(clientes);
    }
    catch (error) {
        console.error('Error al obtener clientes:', error);
        res.status(500).json({ error: 'Error del servidor al obtener clientes.' });
    }
};
exports.getClientes = getClientes;
const createCliente = async (req, res) => {
    try {
        const { nombre, apellidos, documento, email, telefono, direccion, vehiculo } = req.body;
        if (!nombre) {
            res.status(400).json({ error: 'El nombre es obligatorio.' });
            return;
        }
        const nuevoCliente = await prisma_1.prisma.cliente.create({
            data: {
                nombre, apellidos, documento, email, telefono, direccion,
                vehiculos: vehiculo && vehiculo.placa && vehiculo.marca && vehiculo.modelo ? {
                    create: [
                        {
                            placa: vehiculo.placa.toUpperCase(),
                            marca: vehiculo.marca.toUpperCase(),
                            modelo: vehiculo.modelo
                        }
                    ]
                } : undefined
            },
            include: {
                vehiculos: true
            }
        });
        res.status(201).json(nuevoCliente);
    }
    catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: 'Error del servidor al crear cliente.' });
    }
};
exports.createCliente = createCliente;
const updateCliente = async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre, apellidos, documento, email, telefono, direccion } = req.body;
        const clienteModificado = await prisma_1.prisma.cliente.update({
            where: { id: parseInt(id) },
            data: { nombre, apellidos, documento, email, telefono, direccion }
        });
        res.json(clienteModificado);
    }
    catch (error) {
        console.error('Error al actualizar cliente:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar cliente.' });
    }
};
exports.updateCliente = updateCliente;
const deleteCliente = async (req, res) => {
    try {
        const { id } = req.params;
        // Prisma usually cascades or needs manual review. Let's delete the client directly.
        // Ensure relations like vehiculos might prevent deletion if no cascade is set in schema.
        await prisma_1.prisma.cliente.delete({
            where: { id: parseInt(id) }
        });
        res.json({ message: 'Cliente eliminado correctamente' });
    }
    catch (error) {
        console.error('Error al eliminar cliente:', error);
        res.status(500).json({ error: 'Error del servidor al eliminar cliente. Puede tener vehículos registrados.' });
    }
};
exports.deleteCliente = deleteCliente;
