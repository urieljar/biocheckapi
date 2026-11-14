import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

//turno que tenga horas distintas por día.

const ScheduleDay = sequelize.define(
  'ScheduleDay',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    scheduleId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    dayOfWeek: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      validate: {
        min: 0,
        max: 6
      }
    },

    isWorkDay: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },

    dayType: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'NORMAL',
      validate: {
        isIn: [['NORMAL', 'FLEXIBLE', 'REST']]
      }
    },

    workMinutes: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: {
        min: 1,
        max: 1440
      }
    },

    entryTime: {
      type: DataTypes.TIME,
      allowNull: true
    },

    exitTime: {
      type: DataTypes.TIME,
      allowNull: true
    },

    crossesMidnight: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  },
  {
    tableName: 'schedule_days',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['scheduleId', 'dayOfWeek']
      }
    ]
  }
);

export default ScheduleDay;
