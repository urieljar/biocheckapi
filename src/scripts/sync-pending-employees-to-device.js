import 'dotenv/config';

import sequelize from '../config/database.js';

import {
  Employee,
  Device
} from '../models/index.js';

import {
  writeEmployeeToDevice
} from '../services/device-user-write.service.js';

const limit = Number(process.argv[2]) || 1;

const main = async () => {
  await sequelize.authenticate();

  const employees = await Employee.findAll({
    where: {
      deviceSyncStatus: 'PENDING'
    },
    include: [
      {
        model: Device,
        as: 'device',
        attributes: ['id', 'name', 'ip']
      }
    ],
    order: [['updatedAt', 'ASC']],
    limit
  });

  if (employees.length === 0) {
    console.log('No hay empleados PENDING para sincronizar');
    return;
  }

  console.log(`Sincronizando ${employees.length} empleado(s)`);

  for (const employee of employees) {
    console.log(
      `Enviando ${employee.deviceUserId} - ${employee.name}`
    );

    try {
      const result = await writeEmployeeToDevice(employee);

      await employee.update({
        deviceSyncStatus: 'SYNCED',
        deviceSyncError: null,
        deviceSyncedAt: new Date()
      });

      console.log('Sincronizado:', result);
    } catch (error) {
      await employee.update({
        deviceSyncStatus: 'ERROR',
        deviceSyncError: error.message,
        deviceSyncedAt: null
      });

      console.error(
        `Error sincronizando ${employee.deviceUserId}:`,
        error.message
      );
    }
  }
};

main()
  .catch((error) => {
    console.error('Error general:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });