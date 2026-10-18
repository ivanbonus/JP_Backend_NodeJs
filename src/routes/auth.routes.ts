import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
    login, login2FA, register, googleLogin, me, cambiarPassword,
    estado2FA, iniciar2FA, activar2FA, regenerarCodigos2FA, eliminarDispositivo2FA,
} from '../controllers/auth.controller';
import { requireAuthConPendientes } from '../middlewares/auth.middleware';

const router = Router();

// Límite de intentos para frenar ataques de fuerza bruta.
// RATE_LIMIT_MULTIPLICADOR solo se usa en el entorno de pruebas automáticas.
const multiplicador = Math.max(1, Number(process.env.RATE_LIMIT_MULTIPLICADOR) || 1);
const crearLimite = (limit: number) => rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: limit * multiplicador,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});
const limiteLogin = crearLimite(20);
const limiteCodigos = crearLimite(10);

router.post('/login', limiteLogin, login);
router.post('/login/2fa', limiteCodigos, login2FA);
router.post('/register', limiteLogin, register);
router.post('/google-login', limiteLogin, googleLogin);

// Rutas disponibles aunque haya pasos de seguridad pendientes
router.get('/me', requireAuthConPendientes, me);
router.post('/cambiar-password', limiteLogin, requireAuthConPendientes, cambiarPassword);
router.get('/2fa/estado', requireAuthConPendientes, estado2FA);
router.post('/2fa/iniciar', limiteCodigos, requireAuthConPendientes, iniciar2FA);
router.post('/2fa/activar', limiteCodigos, requireAuthConPendientes, activar2FA);
router.post('/2fa/codigos', limiteCodigos, requireAuthConPendientes, regenerarCodigos2FA);
router.post('/2fa/dispositivos/:id/eliminar', limiteCodigos, requireAuthConPendientes, eliminarDispositivo2FA);

export default router;
