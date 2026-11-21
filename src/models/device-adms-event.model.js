import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const DeviceAdmsEvent = sequelize.define(
  'DeviceAdmsEvent',
  {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    deviceId: { type: DataTypes.UUID, allowNull: true },
    serialNumber: { type: DataTypes.STRING, allowNull: false },
    eventType: { type: DataTypes.STRING(30), allowNull: false },
    commandId: { type: DataTypes.BIGINT, allowNull: true },
    returnCode: { type: DataTypes.INTEGER, allowNull: true },
    requestBody: { type: DataTypes.TEXT, allowNull: true },
    sourceIp: { type: DataTypes.STRING, allowNull: true },
    userAgent: { type: DataTypes.STRING, allowNull: true },
    accepted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    error: { type: DataTypes.TEXT, allowNull: true },
    receivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
  },
  {
    tableName: 'device_adms_events',
    timestamps: true,
    indexes: [
      { fields: ['serialNumber', 'receivedAt'] },
      { fields: ['eventType', 'receivedAt'] }
    ]
  }
);

export default DeviceAdmsEvent;
