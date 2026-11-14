import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const CalendarException = sequelize.define(
  'CalendarException',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    type: {
      type: DataTypes.STRING(30),
      allowNull: false,
      validate: {
        isIn: [[
          'HOLIDAY',
          'VACATION',
          'PERMISSION',
          'SICK_LEAVE',
          'SPECIAL_REST',
          'REDUCED_DAY',
          'SCHEDULE_CHANGE'
        ]]
      }
    },
    scope: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'GLOBAL',
      validate: {
        isIn: [['GLOBAL', 'EMPLOYEE', 'DEPARTMENT', 'AREA']]
      }
    },
    description: DataTypes.STRING,
    employeeId: DataTypes.UUID,
    departmentId: DataTypes.UUID,
    areaId: DataTypes.UUID,
    scheduleId: DataTypes.UUID,
    isWorkDay: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    entryTime: DataTypes.TIME,
    exitTime: DataTypes.TIME,
    workMinutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: { min: 1, max: 1440 }
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  },
  {
    tableName: 'calendar_exceptions',
    timestamps: true,
    indexes: [
      { fields: ['date'] },
      { fields: ['employeeId', 'date'] },
      { fields: ['departmentId', 'date'] },
      { fields: ['areaId', 'date'] }
    ]
  }
);

export default CalendarException;
