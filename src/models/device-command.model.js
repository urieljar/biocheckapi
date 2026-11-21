import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const DeviceCommand = sequelize.define(
  'DeviceCommand',
  {
    commandId: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },

    deviceId: {
      type: DataTypes.UUID,
      allowNull: true
    },

    employeeId: {
      type: DataTypes.UUID,
      allowNull: true
    },

    serialNumber: {
      type: DataTypes.STRING,
      allowNull: false
    },

    command: {
      type: DataTypes.TEXT,
      allowNull: false
    },

    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'PENDING',
      validate: {
        isIn: [['PENDING', 'SENT', 'CONFIRMED', 'ERROR']]
      }
    },

    attemptCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },

    maxAttempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3
    },

    nextAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    lastAttemptAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    lastError: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    returnCode: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    responseBody: {
      type: DataTypes.TEXT,
      allowNull: true
    },

    sentAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    returnedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: 'device_commands',
    timestamps: true,
    indexes: [
      {
        fields: ['serialNumber', 'status']
      }
    ]
  }
);

export default DeviceCommand;
