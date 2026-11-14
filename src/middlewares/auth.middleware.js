import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { hasCapability } from '../security/roles.js';

export const requireCapability = (capability) => (req, res, next) => {
  if (!req.user?.active || !hasCapability(req.user.role, capability)) {
    return res.status(403).json({ ok: false, message: 'No tienes permisos para esta operación' });
  }
  next();
};

export const authenticate = async (req, res, next) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith('Bearer ')) {
      return res.status(401).json({
        ok: false,
        message: 'Token requerido'
      });
    }

    const token = authorization.substring(7);

    const payload = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const user = await User.findByPk(payload.sub);

    if (!user || !user.active) {
      return res.status(401).json({
        ok: false,
        message: 'Usuario no autorizado'
      });
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({
      ok: false,
      message: 'Token inválido o expirado'
    });
  }
};
