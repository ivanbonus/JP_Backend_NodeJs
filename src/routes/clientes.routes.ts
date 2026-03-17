import { Router } from 'express';
import { getClientes, createCliente } from '../controllers/clientes.controller';

const router = Router();

// =======================
// RUTAS CLIENTES
// =======================
router.get('/', getClientes);
router.post('/', createCliente);

export default router;
