import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Area = sequelize.define(
  'Area',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    parentId: {
      type: DataTypes.UUID,
      allowNull: true
    }
  },
  { tableName: 'areas', timestamps: true }
);

export default Area;
