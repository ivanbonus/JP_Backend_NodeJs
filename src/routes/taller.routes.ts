import { Router } from 'express';
import { getGuias, createGuia, updateGuia, deleteGuia, createVehiculo, deleteVehiculo, getCitas, createCita, deleteCita } from '../controllers/taller.controller';

const router = Router();

// =======================
// RUTAS NUMEROS DE GUIA
// =======================
router.get('/guias', getGuias);
router.post('/guias', createGuia);
router.put('/guias/:id', updateGuia);
router.delete('/guias/:id', deleteGuia);

// =======================
// RUTAS VEHICULOS (TALLER)
// =======================
router.post('/vehiculos', createVehiculo);
router.delete('/vehiculos/:id', deleteVehiculo);

// =======================
// RUTAS CITAS
// =======================
router.get('/citas', getCitas);
router.post('/citas', createCita);
router.delete('/citas/:id', deleteCita);

export default router;
