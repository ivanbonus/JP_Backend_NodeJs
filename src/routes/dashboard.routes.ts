import { Router } from 'express';
import { getDashboardData, getIndicadores } from '../controllers/dashboard.controller';

const router = Router();

router.get('/', getDashboardData);
router.get('/indicadores', getIndicadores);

export default router;
