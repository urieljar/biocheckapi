import Device from './device.model.js';
import Employee from './employee.model.js';
import Attendance from './attendance.model.js';
import User from './user.model.js';
import WorkSchedule from './work-schedule.model.js';
import ScheduleDay from './schedule-day.model.js';
import EmployeeSchedule from './employee-schedule.model.js';
import DeviceCommand from './device-command.model.js';
import EmployeeProfile from './employee-profile.model.js';
import Department from './department.model.js';
import Area from './area.model.js';
import Position from './position.model.js';

Device.hasMany(Employee, {
  foreignKey: 'deviceId',
  as: 'employees'
});

Employee.belongsTo(Device, {
  foreignKey: 'deviceId',
  as: 'device'
});

Device.hasMany(Attendance, {
  foreignKey: 'deviceId',
  as: 'attendances'
});

Attendance.belongsTo(Device, {
  foreignKey: 'deviceId',
  as: 'device'
});

Device.hasMany(DeviceCommand, {
  foreignKey: 'deviceId',
  as: 'commands'
});

DeviceCommand.belongsTo(Device, {
  foreignKey: 'deviceId',
  as: 'device'
});

Employee.hasMany(DeviceCommand, {
  foreignKey: 'employeeId',
  as: 'deviceCommands'
});

DeviceCommand.belongsTo(Employee, {
  foreignKey: 'employeeId',
  as: 'employee'
});

Employee.hasMany(Attendance, {
  foreignKey: 'employeeId',
  as: 'attendances'
});

Attendance.belongsTo(Employee, {
  foreignKey: 'employeeId',
  as: 'employee'
});


WorkSchedule.hasMany(ScheduleDay, {
  foreignKey: 'scheduleId',
  as: 'days',
  onDelete: 'CASCADE'
});

ScheduleDay.belongsTo(WorkSchedule, {
  foreignKey: 'scheduleId',
  as: 'schedule'
});

Employee.hasMany(EmployeeSchedule, {
  foreignKey: 'employeeId',
  as: 'scheduleAssignments'
});

EmployeeSchedule.belongsTo(Employee, {
  foreignKey: 'employeeId',
  as: 'employee'
});

Employee.hasOne(EmployeeProfile, {
  foreignKey: 'employeeId',
  as: 'profile',
  onDelete: 'CASCADE'
});

EmployeeProfile.belongsTo(Employee, {
  foreignKey: 'employeeId',
  as: 'employee'
});

Department.hasMany(EmployeeProfile, {
  foreignKey: 'departmentId',
  as: 'employeeProfiles'
});

Department.hasMany(Department, {
  foreignKey: 'parentId',
  as: 'children'
});

Department.belongsTo(Department, {
  foreignKey: 'parentId',
  as: 'parent'
});

EmployeeProfile.belongsTo(Department, {
  foreignKey: 'departmentId',
  as: 'department'
});

Area.hasMany(EmployeeProfile, {
  foreignKey: 'areaId',
  as: 'employeeProfiles'
});

Area.hasMany(Area, {
  foreignKey: 'parentId',
  as: 'children'
});

Area.belongsTo(Area, {
  foreignKey: 'parentId',
  as: 'parent'
});

EmployeeProfile.belongsTo(Area, {
  foreignKey: 'areaId',
  as: 'area'
});

Position.hasMany(EmployeeProfile, {
  foreignKey: 'positionId',
  as: 'employeeProfiles'
});

EmployeeProfile.belongsTo(Position, {
  foreignKey: 'positionId',
  as: 'position'
});

Position.hasMany(Position, {
  foreignKey: 'parentId',
  as: 'children'
});

Position.belongsTo(Position, {
  foreignKey: 'parentId',
  as: 'parent'
});

WorkSchedule.hasMany(EmployeeSchedule, {
  foreignKey: 'scheduleId',
  as: 'employeeAssignments'
});

EmployeeSchedule.belongsTo(WorkSchedule, {
  foreignKey: 'scheduleId',
  as: 'schedule'
});

export {
  Device,
  Employee,
  Attendance,
  User,
  DeviceCommand,
  WorkSchedule,
  ScheduleDay,
  EmployeeSchedule,
  EmployeeProfile,
  Department,
  Area,
  Position
};
