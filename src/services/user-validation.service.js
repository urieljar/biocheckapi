import { DEFAULT_ROLE, ROLE_LIST, normalizeRole } from '../security/roles.js';

export const USER_ROLES = ROLE_LIST;
export const PUBLIC_USER_FIELDS = [
  'id', 'name', 'email', 'role', 'active', 'lastLoginAt', 'createdAt', 'updatedAt'
];

export class UserInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const publicUser = (user) => Object.fromEntries(
  PUBLIC_USER_FIELDS.map((field) => [field, user[field]])
);

export const validateBody = (body, allowedFields) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new UserInputError('Envía un objeto JSON');
  }
  const unknown = Object.keys(body).filter((key) => !allowedFields.includes(key));
  if (unknown.length) throw new UserInputError(`Campos no permitidos: ${unknown.join(', ')}`);
};

export const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < 10 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new UserInputError('La contraseña debe tener al menos 10 caracteres y máximo 72 bytes UTF-8');
  }
  return password;
};

export const validateUserFields = (body, creating = false) => {
  const data = {};
  for (const field of ['name', 'email']) {
    if (creating || Object.hasOwn(body, field)) {
      if (typeof body[field] !== 'string' || !body[field].trim() || body[field].trim().length > 255) {
        throw new UserInputError(`${field} es obligatorio y debe tener máximo 255 caracteres`);
      }
      data[field] = body[field].trim();
    }
  }
  if (data.email !== undefined) {
    data.email = data.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new UserInputError('Correo inválido');
  }
  if (creating || Object.hasOwn(body, 'role')) {
    const requested = creating && body.role === undefined ? DEFAULT_ROLE : body.role;
    const role = normalizeRole(requested);
    if (!USER_ROLES.includes(role)) {
      throw new UserInputError(`role debe ser uno de: ${USER_ROLES.join(', ')}`);
    }
    data.role = role;
  }
  return data;
};

export const handleUserError = (res, error) => {
  if (error instanceof UserInputError) return res.status(error.status).json({ ok: false, message: error.message });
  if (error.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ ok: false, message: 'El correo ya está registrado' });
  }
  console.error('Error en usuarios del sistema:', error.message);
  return res.status(500).json({ ok: false, message: 'No fue posible completar la operación de usuario' });
};
