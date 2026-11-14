import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const SystemSetting = sequelize.define(
  'SystemSetting',
  {
    key: {
      type: DataTypes.STRING(100),
      primaryKey: true,
      allowNull: false
    },
    value: {
      type: DataTypes.JSONB,
      allowNull: false
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    updatedBy: {
      type: DataTypes.UUID,
      allowNull: true
    }
  },
  {
    tableName: 'system_settings',
    timestamps: true
  }
);

export default SystemSetting;
