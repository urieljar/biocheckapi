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
      console.log('El administrador ya existe');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await User.create({
      name,
      email,
      passwordHash,
      role: 'ADMIN',
      active: true
    });

    console.log('Administrador creado correctamente');
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

createAdmin();