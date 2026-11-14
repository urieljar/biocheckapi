import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const User = sequelize.define(
  'User',
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

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      set(value) {
        this.setDataValue('email', value.trim().toLowerCase());
      }
    },

    passwordHash: {
      type: DataTypes.STRING,
      allowNull: false
    },

    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'CONSULTA',
      validate: {
        // USER se conserva para que las cuentas anteriores al catálogo sigan
        // pudiendo guardarse hasta ejecutar `npm run migrate-roles`.
        isIn: [['ROOT', 'ADMIN', 'SUPERVISOR', 'CONSULTA', 'USER']]
      }
    },

    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },

    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    tableName: 'users',
    timestamps: true,
    defaultScope: {
      attributes: {
        exclude: ['passwordHash']
      }
    }
  }
);

export default User;
