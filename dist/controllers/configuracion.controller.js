"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateConfiguracion = exports.getConfiguracion = void 0;
const index_1 = require("../index");
const getConfiguracion = async (req, res) => {
    try {
        let config = await index_1.prisma.configuracion.findFirst();
        if (!config) {
            config = await index_1.prisma.configuracion.create({ data: {} });
        }
        res.json(config);
    }
    catch (error) {
        console.error('Error al obtener configuración:', error);
        res.status(500).json({ error: 'Error del servidor' });
    }
};
exports.getConfiguracion = getConfiguracion;
const updateConfiguracion = async (req, res) => {
    try {
        const { nombreResponsable, email, telefono, nombreTaller, ruc, direccion, passwordActual, nuevaPassword, notifEmail, notifSMS, notifApp } = req.body;
        let config = await index_1.prisma.configuracion.findFirst();
        if (!config) {
            config = await index_1.prisma.configuracion.create({ data: {} });
        }
        const dataToUpdate = {};
        if (nombreResponsable !== undefined)
            dataToUpdate.nombreResponsable = nombreResponsable;
        if (email !== undefined)
            dataToUpdate.email = email;
        if (telefono !== undefined)
            dataToUpdate.telefono = telefono;
        if (nombreTaller !== undefined)
            dataToUpdate.nombreTaller = nombreTaller;
        if (ruc !== undefined)
            dataToUpdate.ruc = ruc;
        if (direccion !== undefined)
            dataToUpdate.direccion = direccion;
        if (notifEmail !== undefined)
            dataToUpdate.notifEmail = Boolean(notifEmail);
        if (notifSMS !== undefined)
            dataToUpdate.notifSMS = Boolean(notifSMS);
        if (notifApp !== undefined)
            dataToUpdate.notifApp = Boolean(notifApp);
        // Si se intentó cambiar contraseña
        if (passwordActual && nuevaPassword) {
            if (passwordActual !== config.password) {
                res.status(400).json({ error: 'La contraseña actual es incorrecta. No se ha guardado.' });
                return;
            }
            dataToUpdate.password = nuevaPassword;
        }
        const updatedConfig = await index_1.prisma.configuracion.update({
            where: { id: config.id },
            data: dataToUpdate
        });
        res.json(updatedConfig);
    }
    catch (error) {
        console.error('Error al actualizar configuración:', error);
        res.status(500).json({ error: 'Error del servidor al actualizar configuración' });
    }
};
exports.updateConfiguracion = updateConfiguracion;
