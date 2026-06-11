"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generarPdfGuia = exports.deleteGuia = exports.deleteCita = exports.createCita = exports.getCitas = exports.createVehiculo = exports.updateGuia = exports.createGuia = exports.deleteVehiculo = exports.getGuias = void 0;
const prisma_1 = require("../prisma"); // Importar Prisma instanciado en el entrypoint
const pdfKitGenerator_1 = require("../utils/pdfKitGenerator");
const getGuias = async (req, res) => {
    try {
        const guias = await prisma_1.prisma.numeroGuia.findMany({
            include: {
                cliente: true,
                vehiculo: true,
                tecnicos: true,
                detalles: true
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
const deleteVehiculo = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma_1.prisma.vehiculo.delete({ where: { id: Number(id) } });
        res.json({ message: 'Vehículo eliminado correctamente.' });
    }
    catch (error) {
        console.error('Error al borrar vehículo:', error);
        res.status(500).json({ error: 'No se pudo eliminar el vehículo. Es posible que tenga órdenes de trabajo asociadas.' });
    }
};
exports.deleteVehiculo = deleteVehiculo;
const createGuia = async (req, res) => {
    try {
        const { clienteId, vehiculoId, diagnostico, observaciones, tecnicosIds, detalles } = req.body;
        // Validar Requeridos Básicos
        if (!clienteId || !vehiculoId) {
            res.status(400).json({ error: 'clienteId y vehiculoId son requeridos.' });
            return;
        }
        const nuevaGuia = await prisma_1.prisma.numeroGuia.create({
            data: {
                clienteId,
                vehiculoId,
                diagnostico,
                observaciones,
                tecnicos: tecnicosIds && tecnicosIds.length > 0 ? {
                    connect: tecnicosIds.map((id) => ({ id }))
                } : undefined,
                detalles: detalles && detalles.length > 0 ? {
                    create: detalles.map((d) => ({
                        descripcion: d.descripcion,
                        cantidad: Number(d.cantidad) || 1,
                        precioUnit: Number(d.precioUnit) || 0
                    }))
                } : undefined
            },
            include: { cliente: true, vehiculo: true, tecnicos: true, detalles: true }
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
        const { estado, diagnostico, observaciones, tecnicosIds, detalles } = req.body;
        // Actualizamos la guía
        const guiaActualizada = await prisma_1.prisma.numeroGuia.update({
            where: { id: Number(id) },
            data: {
                estado,
                diagnostico,
                observaciones,
                tecnicos: tecnicosIds ? {
                    set: [], // Reseteamos la asignación actual
                    connect: tecnicosIds.map((tid) => ({ id: tid })) // Conectamos los nuevos técnicos
                } : undefined,
                detalles: detalles ? {
                    deleteMany: {}, // Borramos actuales
                    create: detalles.map((d) => ({
                        descripcion: d.descripcion,
                        cantidad: Number(d.cantidad) || 1,
                        precioUnit: Number(d.precioUnit) || 0
                    }))
                } : undefined
            },
            include: { cliente: true, vehiculo: true, tecnicos: true, detalles: true }
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
        const nuevoVehiculo = await prisma_1.prisma.vehiculo.create({
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
        const citas = await prisma_1.prisma.cita.findMany({
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
        const nuevaCita = await prisma_1.prisma.cita.create({
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
        await prisma_1.prisma.cita.delete({ where: { id: Number(id) } });
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
        await prisma_1.prisma.numeroGuia.delete({ where: { id: Number(id) } });
        res.json({ message: 'Guía eliminada correctamente del historial.' });
    }
    catch (error) {
        console.error('Error al borrar guía:', error);
        res.status(500).json({ error: 'Error del servidor al eliminar la guía.' });
    }
};
exports.deleteGuia = deleteGuia;
const generarPdfGuia = async (req, res) => {
    try {
        const { id } = req.params;
        const guia = await prisma_1.prisma.numeroGuia.findUnique({
            where: { id: Number(id) },
            include: {
                cliente: true,
                vehiculo: true,
                detalles: true
            }
        });
        if (!guia) {
            res.status(404).json({ error: 'Guía no encontrada.' });
            return;
        }
        const nroGuiaC = `NG-${String(guia.id).padStart(3, '0')}`;
        const vehiculoFullName = guia.vehiculo ? `${guia.vehiculo.marca} ${guia.vehiculo.modelo} (${guia.vehiculo.placa})` : '';
        const productos = (guia.detalles || []).map((det) => ({
            codigo: '-',
            cantidad: det.cantidad,
            descripcion: det.descripcion,
            precioUnitario: det.precioUnit,
            importe: det.cantidad * det.precioUnit
        }));
        const totalImporte = productos.reduce((sum, p) => sum + p.importe, 0);
        // Generar PDF mediante PDFKit
        const pdfBuffer = await (0, pdfKitGenerator_1.generarGuiaPdfKit)({
            empresaRuc: '20554702270',
            cotizacionNumero: nroGuiaC,
            clienteNombre: guia.cliente && guia.cliente.nombre ? (guia.cliente.nombre + ' ' + (guia.cliente.apellidos || '')).trim() : 'Cliente mostrador',
            clienteDocumento: guia.cliente?.documento || '',
            clienteAtencion: vehiculoFullName,
            clienteDireccion: guia.cliente?.direccion || '',
            clienteEmail: guia.cliente?.email || '',
            clienteTelefono: guia.cliente?.telefono || '',
            clienteCelular: guia.cliente?.telefono || '',
            placa: guia.vehiculo?.placa || '',
            fecha: new Date().toLocaleDateString('es-PE'),
            vendedorNombre: 'Frenos y Embragues Juan Pablo',
            moneda: 'Soles',
            productos,
            formaPago: '-',
            plazoEntrega: '-',
            diagnostico: guia.diagnostico || '',
            observacion: guia.observaciones || 'Servicio realizado en el taller. Garantía por defecto de fábrica.',
            totalImporte
        });
        // Enviar PDF al cliente
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="Guia_${nroGuiaC}.pdf"`);
        res.send(pdfBuffer);
    }
    catch (error) {
        console.error('Error al generar PDF Guia:', error);
        res.status(500).json({ error: 'No se pudo generar el PDF de la Guía.' });
    }
};
exports.generarPdfGuia = generarPdfGuia;
