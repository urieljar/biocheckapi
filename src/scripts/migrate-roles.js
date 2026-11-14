import 'dotenv/config';

import sequelize from '../config/database.js';
import { User } from '../models/index.js';
import { ROLES } from '../security/roles.js';

// Migración de roles: USER -> SUPERVISOR y, opcionalmente, promoción a ROOT.
// Uso:
//   npm run migrate-roles                              -> solo convierte USER a SUPERVISOR
//   npm run migrate-roles -- correo@dominio            -> además promueve esa cuenta a ROOT
//   npm run migrate-roles -- uno@dominio dos@dominio   -> promueve varias cuentas a ROOT
const emails = process.argv.slice(2)
  .flatMap((value) => String(value).split(','))
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

const main = async () => {
  await sequelize.authenticate();

  const [, metadata] = await sequelize.query(
    "UPDATE users SET role = 'SUPERVISOR' WHERE role = 'USER'"
  );

  console.log('Cuentas USER convertidas a SUPERVISOR:', metadata?.rowCount ?? 0);

  for (const email of emails) {
    const user = await User.unscoped().findOne({ where: { email } });

    if (!user) {
      throw new Error(`No existe una cuenta con el correo ${email}`);
    }

    await user.update({ role: ROLES.ROOT, active: true });
    console.log(`${email} ahora tiene rol ROOT`);
  }

  const roots = await User.count({ where: { role: ROLES.ROOT, active: true } });

  if (roots === 0) {
    console.log(
      'Aviso: no hay ninguna cuenta ROOT activa. Ejecuta "npm run create-admin" ' +
      'o vuelve a correr este script con el correo de la persona que será propietaria.'
    );
  } else {
    console.log(`Cuentas ROOT activas: ${roots}`);
  }
};

main()
  .catch((error) => {
    console.error('Error:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
