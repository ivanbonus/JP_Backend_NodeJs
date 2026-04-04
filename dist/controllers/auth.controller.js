"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = void 0;
const index_1 = require("../index");
const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            res.status(400).json({ error: 'Debes enviar usuario/email y contraseña' });
            return;
        }
        // Busca la unica configuración de la BD (si no existe, la crea)
        let config = await index_1.prisma.configuracion.findFirst();
        if (!config) {
            config = await index_1.prisma.configuracion.create({ data: {} });
        }
        // Validar contraseña
        if (email === config.usuario && password === config.password) {
            res.json({
                message: 'Login exitoso',
                user: { nombre: config.nombreResponsable, email: config.email, rol: 'Super Admin' }
            });
        }
        else {
            res.status(401).json({ error: 'Credenciales inválidas' });
        }
    }
    catch (error) {
        console.error('Error en login:', error);
        res.status(500).json({ error: 'Error del servidor al intentar iniciar sesión' });
    }
};
exports.login = login;
