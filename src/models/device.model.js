import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Device = sequelize.define(
  'Device',
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

    ip: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isIP: true
      }
    },

    port: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 4370
    },

    deviceNumber: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    serialNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },

    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },

    lastConnectionAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    admsStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'UNKNOWN',
      validate: {
        isIn: [['UNKNOWN', 'ONLINE', 'OFFLINE']]
      }
    },

    lastAdmsAt: {
      type: DataTypes.DATE,
      allowNull: true
    },

    admsLastError: {
      type: DataTypes.TEXT,
      allowNull: true
    }
  },
  {
    tableName: 'devices',
    timestamps: true
  }
);

export default Device;
