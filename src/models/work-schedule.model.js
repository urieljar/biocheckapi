import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';
//Crearemos la estructura de horarios.
const WorkSchedule = sequelize.define(
  'WorkSchedule',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },

    description: {
      type: DataTypes.STRING,
      allowNull: true
    },

    timeZone: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'America/Mazatlan'
    },

    toleranceMinutes: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 10,
      validate: {
        min: 0,
        max: 180
      }
    },

    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  },
  {
    tableName: 'work_schedules',
    timestamps: true
  }
);

export default WorkSchedule;