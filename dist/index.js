"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
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
// Inicialización del servidor
app.listen(port, () => {
    console.log(`[server]: Servidor corriendo en http://localhost:${port}`);
});
