import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const EmployeeSchedule = sequelize.define(
  'EmployeeSchedule',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    employeeId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    scheduleId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    validFrom: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },

    validTo: {
      type: DataTypes.DATEONLY,
      allowNull: true
    },

    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  },
  {
    tableName: 'employee_schedules',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['employeeId', 'validFrom']
      }
    ]
  }
);

export default EmployeeSchedule;