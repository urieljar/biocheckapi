import 'dotenv/config';
import { Op } from 'sequelize';
import sequelize from '../config/database.js';
import {
  Employee,
  EmployeeProfile,
  EmploymentPeriod,
  Attendance,
  EmployeeSchedule,
  CalendarException,
  DeviceCommand
} from '../models/index.js';

const deviceUserId = process.argv[2]?.trim();
if (!deviceUserId) {
  console.error('Uso: node src/scripts/purge-test-employee.js <deviceUserId>');
  process.exit(1);
}

const run = async () => {
  await sequelize.authenticate();

  const employee = await Employee.findOne({
    where: { deviceUserId },
    paranoid: false
  });

  if (!employee) {
    console.log(`Empleado con ID/número ${deviceUserId} no encontrado.`);
    process.exit(0);
  }

  console.log(`Purgando empleado de pruebas: ${employee.name} (${employee.deviceUserId}, UUID: ${employee.id})...`);

  await sequelize.transaction(async (transaction) => {
    const att = await Attendance.destroy({
      where: {
        [Op.or]: [
          { employeeId: employee.id },
          { employeeId: null, deviceId: employee.deviceId, deviceUserId: employee.deviceUserId }
        ]
      },
      transaction
    });
    const sch = await EmployeeSchedule.destroy({ where: { employeeId: employee.id }, transaction });
    const exc = await CalendarException.destroy({ where: { employeeId: employee.id }, transaction });
    const cmd = await DeviceCommand.destroy({ where: { employeeId: employee.id }, transaction });
    const per = await EmploymentPeriod.destroy({ where: { employeeId: employee.id }, transaction });
    const prof = await EmployeeProfile.destroy({ where: { employeeId: employee.id }, transaction });
    await employee.destroy({ force: true, transaction });

    console.log(`✓ Checadas eliminadas: ${att}`);
    console.log(`✓ Horarios eliminados: ${sch}`);
    console.log(`✓ Excepciones eliminadas: ${exc}`);
    console.log(`✓ Comandos eliminados: ${cmd}`);
    console.log(`✓ Períodos laborales eliminados: ${per}`);
    console.log(`✓ Perfil de empleado eliminado: ${prof}`);
    console.log(`✓ Empleado "${employee.name}" eliminado por completo.`);
  });

  process.exit(0);
};

run().catch((err) => {
  console.error('Error al purgar empleado:', err.message);
  process.exit(1);
});
