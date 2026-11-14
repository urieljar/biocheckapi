import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { User } from '../models/index.js';
import sequelize from '../config/database.js';
import {
  publicUser,
  validateBody,
  validatePassword,
  validateUserFields,
  UserInputError,
  handleUserError
} from '../services/user-validation.service.js';

export const login = async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({
        ok: false,
        message: 'Correo y contraseña son obligatorios'
      });
    }

    const user = await User.unscoped().findOne({
      where: { email }
    });

    if (!user || !user.active) {
      return res.status(401).json({
        ok: false,
        message: 'Credenciales incorrectas'
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!validPassword) {
      return res.status(401).json({
        ok: false,
        message: 'Credenciales incorrectas'
      });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h'
      }
    );

    await user.update({
      lastLoginAt: new Date()
    });

    res.json({
      ok: true,
      message: 'Inicio de sesión correcto',
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('Error de autenticación:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible iniciar sesión'
    });
  }
};

export const getMe = (req, res) => res.json({ ok: true, data: publicUser(req.user) });

// Edición de la propia cuenta: solo name y email. La lista blanca de validateBody
// es lo que impide que un USER se envíe role, active o passwordHash y escale privilegios.
export const updateMe = async (req, res) => {
  try {
    validateBody(req.body, ['name', 'email']);
    const updates = validateUserFields(req.body);

    if (!Object.keys(updates).length) {
      throw new UserInputError('Envía name o email para actualizar');
    }

    const user = req.user;
    await user.update(updates);

    return res.json({
      ok: true,
      message: 'Perfil actualizado correctamente',
      data: publicUser(user)
    });
  } catch (error) { return handleUserError(res, error); }
};

export const changePassword = async (req, res) => {
  try {
    validateBody(req.body, ['currentPassword', 'newPassword']);
    if (typeof req.body.currentPassword !== 'string' || !req.body.currentPassword) {
      throw new UserInputError('currentPassword es obligatorio');
    }
    const newPassword = validatePassword(req.body.newPassword);
    await sequelize.transaction(async (transaction) => {
      const user = await User.unscoped().findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || !user.active) throw new UserInputError('Usuario no autorizado', 401);
      if (!await bcrypt.compare(req.body.currentPassword, user.passwordHash)) {
        throw new UserInputError('La contraseña actual es incorrecta', 400);
      }
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        throw new UserInputError('La nueva contraseña debe ser distinta a la actual');
      }
      await user.update({ passwordHash: await bcrypt.hash(newPassword, 12) }, { transaction });
    });
    return res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (error) { return handleUserError(res, error); }
};
