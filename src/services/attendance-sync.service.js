import {
  Device,
  Employee,
  Attendance
} from '../models/index.js';

import {
  getZktecoAttendances
} from './zkteco.service.js';

export const synchronizeAttendances = async () => {
  const device = await Device.findOne({
    where: {
      ip: process.env.ZK_IP
    }
  });

  if (!device) {
    throw new Error(
      'El dispositivo no está registrado. Sincroniza primero los empleados'
    );
  }

  const deviceAttendances = await getZktecoAttendances();

  const employees = await Employee.findAll({
    where: {
      deviceId: device.id
    }
  });

  const employeeMap = new Map(
    employees.map((employee) => [
      String(employee.deviceUserId),
      employee
    ])
  );

  let invalid = 0;

  const attendanceRows = deviceAttendances
    .map((record) => {
      const deviceUserId = String(record.deviceUserId ?? '');
      const recordTime = new Date(record.recordTime);
      const deviceUserSn = Number(record.userSn);

      if (
        !deviceUserId ||
        Number.isNaN(recordTime.getTime())
      ) {
        invalid++;
        return null;
      }

      const employee = employeeMap.get(deviceUserId);

      return {
        deviceId: device.id,
        employeeId: employee?.id ?? null,
        deviceUserId,
        deviceUserSn: Number.isFinite(deviceUserSn)
          ? deviceUserSn
          : null,
        recordTime,
        deviceIp: record.ip || device.ip,
        source: 'DEVICE'
      };
    })
    .filter(Boolean);

  let insertedAttendances = [];

  if (attendanceRows.length > 0) {
    insertedAttendances = await Attendance.bulkCreate(
      attendanceRows,
      {
        ignoreDuplicates: true,
        returning: true
      }
    );
  }

  await device.update({
    active: true,
    lastConnectionAt: new Date()
  });

  return {
    received: deviceAttendances.length,
    valid: attendanceRows.length,
    created: insertedAttendances.length,
    duplicates:
      attendanceRows.length - insertedAttendances.length,
    invalid
  };
};
