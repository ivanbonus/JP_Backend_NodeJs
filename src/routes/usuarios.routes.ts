import { Router } from 'express';
import { listarUsuarios, crearUsuario, actualizarUsuario } from '../controllers/usuarios.controller';
import { soloAdmin } from '../middlewares/auth.middleware';

const router = Router();

router.use(soloAdmin);

router.get('/', listarUsuarios);
router.post('/', crearUsuario);
router.put('/:id', actualizarUsuario);

export default router;
