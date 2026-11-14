import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.middleware.js';
import {
  createUser, getUsers, getUser, updateUser, updateUserStatus, resetUserPassword
} from '../controllers/user.controller.js';

const router = Router();
router.use(requireCapability('user.manage'));
router.param('id', (req, res, next, id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ ok: false, message: 'id debe ser un UUID válido' });
  }
  next();
});
router.post('/', createUser);
router.get('/', getUsers);
router.get('/:id', getUser);
router.patch('/:id', updateUser);
router.patch('/:id/status', updateUserStatus);
router.patch('/:id/password', resetUserPassword);

export default router;
