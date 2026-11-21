import Device from './device.model.js';
import Employee from './employee.model.js';
import Attendance from './attendance.model.js';
import User from './user.model.js';
import WorkSchedule from './work-schedule.model.js';
import ScheduleDay from './schedule-day.model.js';
import EmployeeSchedule from './employee-schedule.model.js';
import DeviceCommand from './device-command.model.js';
import DeviceAdmsEvent from './device-adms-event.model.js';
import EmployeeProfile from './employee-profile.model.js';
import Department from './department.model.js';
import Area from './area.model.js';
import Position from './position.model.js';
import CalendarException from './calendar-exception.model.js';
import SystemSetting from './system-setting.model.js';
import EmploymentPeriod from './employment-period.model.js';
import AuditLog from './audit-log.model.js';
import PayrollClosure from './payroll-closure.model.js';

Employee.hasMany(EmploymentPeriod, { foreignKey: 'employeeId', as: 'employmentPeriods' });
EmploymentPeriod.belongsTo(Employee, { foreignKey: 'employeeId', as: 'employee' });

Device.hasMany(Employee, {
  foreignKey: 'deviceId',
  as: 'employees'
});

Employee.belongsTo(Device, {
  foreignKey: 'deviceId',
  as: 'device'
});

AuditLog.belongsTo(User, { foreignKey: 'actorId', as: 'actor' });

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

Device.hasMany(DeviceAdmsEvent, { foreignKey: 'deviceId', as: 'admsEvents' });
DeviceAdmsEvent.belongsTo(Device, { foreignKey: 'deviceId', as: 'device' });

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

Employee.hasMany(CalendarException, {
  foreignKey: 'employeeId',
  as: 'calendarExceptions'
});

CalendarException.belongsTo(Employee, {
  foreignKey: 'employeeId',
  as: 'employee'
});

Department.hasMany(CalendarException, {
  foreignKey: 'departmentId',
  as: 'calendarExceptions'
});

CalendarException.belongsTo(Department, {
  foreignKey: 'departmentId',
  as: 'department'
});

Area.hasMany(CalendarException, {
  foreignKey: 'areaId',
  as: 'calendarExceptions'
});

CalendarException.belongsTo(Area, {
  foreignKey: 'areaId',
  as: 'area'
});

WorkSchedule.hasMany(CalendarException, {
  foreignKey: 'scheduleId',
  as: 'calendarExceptions'
});

CalendarException.belongsTo(WorkSchedule, {
  foreignKey: 'scheduleId',
  as: 'schedule'
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
  DeviceAdmsEvent,
  WorkSchedule,
  ScheduleDay,
  EmployeeSchedule,
  EmployeeProfile,
  Department,
  Area,
  Position,
  CalendarException,
  SystemSetting,
  EmploymentPeriod,
  AuditLog,
  PayrollClosure
};
