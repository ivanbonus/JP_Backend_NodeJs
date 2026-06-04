"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const prisma_1 = require("./prisma");
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// (Prisma client moved to src/prisma.ts)
// Importar Rutas Principales
const index_routes_1 = __importDefault(require("./routes/index.routes"));
// Middlewares
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Main API Router
app.use('/api', index_routes_1.default);
// Ruta de prueba
app.get('/', (req, res) => {
    res.send('API Taller Backend Funcionado Correctamente');
});
// Inicialización: crear configuración admin por defecto si no existe
async function initAdmin() {
    try {
        const config = await prisma_1.prisma.configuracion.findFirst();
        if (!config) {
            await prisma_1.prisma.configuracion.create({
                data: {
                    id: 1,
                    nombreResponsable: 'Administrador',
                    email: 'admin@tallerjp.com',
                    telefono: '+51 999 888 777',
                    nombreTaller: 'Frenos y Embragues Juan Pablo',
                    ruc: '20601234567',
                    direccion: 'Av. Los Mecánicos 123, Lima',
                    usuario: 'administrador',
                    password: 'TallerJuanP2026'
                }
            });
            console.log('[INIT] Configuración admin creada exitosamente (administrador / TallerJuanP2026)');
        }
        else {
            // Forzar actualización de credenciales para producción/desarrollo si ya existe configuración
            await prisma_1.prisma.configuracion.update({
                where: { id: config.id },
                data: {
                    usuario: 'administrador',
                    password: 'TallerJuanP2026'
                }
            });
            console.log('[INIT] Configuración admin actualizada a (administrador / TallerJuanP2026)');
        }
    }
    catch (error) {
        console.error('[INIT] Error al crear o actualizar configuración admin:', error);
    }
}
// Inicialización del servidor
const server = app.listen(port, () => {
    console.log(`[server]: Servidor corriendo en http://localhost:${port}`);
    initAdmin();
});
// Manejo de errores en el servidor (ej: EADDRINUSE)
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[PDF-ERROR] El puerto ${port} ya está en uso. Por favor, cierra el proceso anterior.`);
    }
    else {
        console.error(`[PDF-ERROR] Error en el servidor:`, error);
    }
    process.exit(1);
});
// Intervalo de mantenimiento para asegurar que el event loop no se vacíe (especialmente en Windows local)
setInterval(() => {
    // Keep alive
}, 60000);
