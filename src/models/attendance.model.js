import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Attendance = sequelize.define(
  'Attendance',
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },

    deviceId: {
      type: DataTypes.UUID,
      allowNull: false
    },

    employeeId: {
      type: DataTypes.UUID,
      allowNull: true
    },

    deviceUserId: {
      type: DataTypes.STRING,
      allowNull: false
    },

    deviceUserSn: {
      type: DataTypes.INTEGER,
      allowNull: true
    },

    recordTime: {
      type: DataTypes.DATE,
      allowNull: false
    },

    deviceIp: {
      type: DataTypes.STRING,
      allowNull: true
    },

    source: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'DEVICE'
    },
    reviewedAt: { type: DataTypes.DATE, allowNull: true },
    reviewedBy: { type: DataTypes.UUID, allowNull: true },
    reviewReason: { type: DataTypes.STRING, allowNull: true }
  },
  {
    tableName: 'attendances',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['deviceId', 'deviceUserId', 'recordTime']
      },
      {
        fields: ['recordTime']
      }
    ]
  }
);

export default Attendance;
