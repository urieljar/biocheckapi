import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Employee = sequelize.define(
  'Employee',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    deviceId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    deviceUserId: {
      type: DataTypes.STRING,
      allowNull: false
    },

    deviceUid: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    deviceRole: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'role'
    },

    deviceRoleName: {
      type: DataTypes.VIRTUAL,
      get() {
        const roles = {
          0: 'Empleado',
          2: 'Registrar',
          8: 'Rol personalizado',
          12: 'Administrador del sistema',
          14: 'Super administrador'
        };

        const code = Number(this.getDataValue('deviceRole'));

        return roles[code] || `Rol desconocido (${code})`;
      }
    },

    devicePin: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'device_pin'
    },
    deviceSyncStatus: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'PENDING',
      field: 'device_sync_status',
      validate: {
        isIn: [['PENDING', 'SYNCED', 'ERROR']]
      }
    },

    deviceSyncError: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'device_sync_error'
    },

    deviceSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'device_synced_at'
    },

    cardNumber: {
      type: DataTypes.STRING,
      allowNull: true
    },

    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  },
  {
    tableName: 'employees',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['deviceId', 'deviceUserId']
      }
    ]
  }
);

export default Employee;
