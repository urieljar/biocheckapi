import 'dotenv/config';
import bcrypt from 'bcryptjs';

import sequelize from '../config/database.js';
import { User } from '../models/index.js';

const createAdmin = async () => {
  try {
    const name = process.env.ADMIN_NAME;
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!name || !email || !password) {
      throw new Error(
        'Faltan ADMIN_NAME, ADMIN_EMAIL o ADMIN_PASSWORD en .env'
      );
    }

    if (password.length < 10) {
      throw new Error(
        'La contraseña debe tener al menos 10 caracteres'
      );
    }

    await sequelize.authenticate();
    await sequelize.sync();

    const existingUser = await User.unscoped().findOne({
      where: { email }
    });

    if (existingUser) {
      if (existingUser.role === 'ROOT') {
        console.log('La cuenta ROOT ya existe');
        return;
      }

      // La cuenta existía con otro rol: este script es la vía para crear al propietario.
      await existingUser.update({ role: 'ROOT', active: true });
      console.log(`${email} ya existía y ahora tiene rol ROOT`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await User.create({
      name,
      email,
      passwordHash,
      role: 'ROOT',
      active: true
    });

    console.log('Cuenta ROOT (propietario del sistema) creada correctamente');
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

createAdmin();