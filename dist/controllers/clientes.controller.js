"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCliente = exports.getClientes = void 0;
const index_1 = require("../index");
const getClientes = async (req, res) => {
    try {
        const clientes = await index_1.prisma.cliente.findMany({
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
        const { nombre, apellidos, documento, email, telefono, direccion } = req.body;
        if (!nombre) {
            res.status(400).json({ error: 'El nombre es obligatorio.' });
        }
        const nuevoCliente = await index_1.prisma.cliente.create({
            data: { nombre, apellidos, documento, email, telefono, direccion }
        });
        res.status(201).json(nuevoCliente);
    }
    catch (error) {
        console.error('Error al crear cliente:', error);
        res.status(500).json({ error: 'Error del servidor al crear cliente.' });
    }
};
exports.createCliente = createCliente;
