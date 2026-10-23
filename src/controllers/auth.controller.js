import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { User } from '../models/index.js';

export const login = async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
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