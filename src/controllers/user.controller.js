import bcrypt from 'bcryptjs';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import { User } from '../models/index.js';
import {
  PUBLIC_USER_FIELDS, UserInputError, publicUser, validateBody,
  validatePassword, validateUserFields, handleUserError
} from '../services/user-validation.service.js';
import { ROLES, hasCapability, isPrivilegedRole, normalizeRole } from '../security/roles.js';

// Serializa cambios administrativos, incluso entre procesos, para proteger al último ROOT.
const asManager = (req, action) => sequelize.transaction(async (transaction) => {
  await sequelize.query('SELECT pg_advisory_xact_lock(729104221)', { transaction });
  const actor = await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!actor || !actor.active || !hasCapability(actor.role, 'user.manage')) {
    throw new UserInputError('Se requiere un administrador activo', 403);
  }
  return action(actor, transaction);
});

const findTarget = async (id, transaction) => {
  const user = await User.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!user) throw new UserInputError('Usuario no encontrado', 404);
  return user;
};

// Un ADMIN gestiona SUPERVISOR y CONSULTA; solo ROOT toca cuentas ADMIN o ROOT.
const assertCanManageRole = (actor, targetRole, newRole) => {
  const actorRole = normalizeRole(actor.role);
  if (actorRole === ROLES.ROOT) return;
  if (isPrivilegedRole(targetRole) || isPrivilegedRole(newRole)) {
    throw new UserInputError('Solo ROOT puede administrar cuentas ADMIN o ROOT', 403);
  }
};

const protectLastRoot = async (target, updates, transaction) => {
  if (!target.active || normalizeRole(target.role) !== ROLES.ROOT) return;
  const demoting = updates.active === false
    || (updates.role !== undefined && normalizeRole(updates.role) !== ROLES.ROOT);
  if (!demoting) return;

  const activeRoots = await User.count({
    where: { active: true, role: ROLES.ROOT },
    transaction
  });

  if (activeRoots <= 1) {
    throw new UserInputError('No puedes desactivar ni quitar el rol al último ROOT activo', 409);
  }
};

const isRootActor = (req) => normalizeRole(req.user.role) === ROLES.ROOT;

export const createUser = async (req, res) => {
  try {
    validateBody(req.body, ['name', 'email', 'password', 'role']);
    const data = validateUserFields(req.body, true);
    const passwordHash = await bcrypt.hash(validatePassword(req.body.password), 12);
    const user = await asManager(req, async (actor, transaction) => {
      assertCanManageRole(actor, data.role, data.role);
      return User.create({ ...data, passwordHash, active: true }, { transaction });
    });
    return res.status(201).json({ ok: true, message: 'Usuario creado correctamente', data: publicUser(user) });
  } catch (error) { return handleUserError(res, error); }
};

export const getUsers = async (req, res) => {
  try {
    const positiveInteger = (value, fallback, max) => {
      if (value === undefined) return fallback;
      if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
        throw new UserInputError('page y limit deben ser enteros positivos; limit máximo 100');
      }
      return Number(value);
    };
    const page = positiveInteger(req.query.page, 1, 1000000);
    const limit = positiveInteger(req.query.limit, 20, 100);
    const where = {};
    if (req.query.search !== undefined) {
      if (typeof req.query.search !== 'string' || req.query.search.length > 255) throw new UserInputError('search debe ser texto de máximo 255 caracteres');
      const search = req.query.search.trim().replace(/[\\%_]/g, '\\$&');
      where[Op.or] = [{ name: { [Op.iLike]: `%${search}%` } }, { email: { [Op.iLike]: `%${search}%` } }];
    }
    if (req.query.role !== undefined) {
      const role = validateUserFields({ role: req.query.role }).role;
      if (isPrivilegedRole(role) && !isRootActor(req)) {
        throw new UserInputError('Solo ROOT puede consultar cuentas ADMIN o ROOT', 403);
      }
      // Las cuentas anteriores al catálogo conservan "USER" hasta ejecutar migrate-roles.
      where.role = role === ROLES.SUPERVISOR ? { [Op.in]: [ROLES.SUPERVISOR, 'USER'] } : role;
    } else if (!isRootActor(req)) {
      // Un ADMIN no ve la cuenta ROOT ni sus datos de contacto.
      where.role = { [Op.ne]: ROLES.ROOT };
    }
    if (req.query.active !== undefined) {
      if (!['true', 'false'].includes(req.query.active)) throw new UserInputError('active debe ser true o false');
      where.active = req.query.active === 'true';
    }
    const { rows, count } = await User.findAndCountAll({
      attributes: PUBLIC_USER_FIELDS, where, limit, offset: (page - 1) * limit,
      order: [['createdAt', 'DESC'], ['id', 'ASC']]
    });
    return res.json({ ok: true, data: rows.map(publicUser), pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } });
  } catch (error) { return handleUserError(res, error); }
};

export const getUser = async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id, { attributes: PUBLIC_USER_FIELDS });
    if (!user || (!isRootActor(req) && normalizeRole(user.role) === ROLES.ROOT)) {
      throw new UserInputError('Usuario no encontrado', 404);
    }
    return res.json({ ok: true, data: publicUser(user) });
  } catch (error) { return handleUserError(res, error); }
};

const updateAccount = async (req, res, statusOnly) => {
  try {
    validateBody(req.body, statusOnly ? ['active'] : ['name', 'email', 'role']);
    let updates;
    if (statusOnly) {
      if (typeof req.body.active !== 'boolean') throw new UserInputError('active debe ser un booleano true o false');
      updates = { active: req.body.active };
    } else {
      updates = validateUserFields(req.body);
      if (!Object.keys(updates).length) throw new UserInputError('Envía name, email o role para actualizar');
    }
    const user = await asManager(req, async (actor, transaction) => {
      const target = await findTarget(req.params.id, transaction);
      assertCanManageRole(actor, target.role, updates.role);
      await protectLastRoot(target, updates, transaction);
      await target.update(updates, { transaction });
      return publicUser(target);
    });
    return res.json({ ok: true, message: 'Usuario actualizado correctamente', data: user });
  } catch (error) { return handleUserError(res, error); }
};

export const updateUser = (req, res) => updateAccount(req, res, false);
export const updateUserStatus = (req, res) => updateAccount(req, res, true);

export const resetUserPassword = async (req, res) => {
  try {
    validateBody(req.body, ['password']);
    const passwordHash = await bcrypt.hash(validatePassword(req.body.password), 12);
    await asManager(req, async (actor, transaction) => {
      const target = await findTarget(req.params.id, transaction);
      assertCanManageRole(actor, target.role);
      await target.update({ passwordHash }, { transaction });
    });
    return res.json({ ok: true, message: 'Contraseña restablecida correctamente' });
  } catch (error) { return handleUserError(res, error); }
};
