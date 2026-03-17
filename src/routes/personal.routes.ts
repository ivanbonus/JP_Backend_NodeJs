import { Router } from 'express';
import { getPersonal, createTrabajador, updateTrabajador, deleteTrabajador } from '../controllers/personal.controller';

const router = Router();

// =======================
// RUTAS PERSONAL (TRABAJADORES)
// =======================
router.get('/', getPersonal);
router.post('/', createTrabajador);
router.put('/:id', updateTrabajador);
router.delete('/:id', deleteTrabajador);

export default router;
