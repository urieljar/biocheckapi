import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const Department = sequelize.define(
  'Department',
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
  { tableName: 'departments', timestamps: true }
);

export default Department;
