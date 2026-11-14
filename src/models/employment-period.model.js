import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const EmploymentPeriod = sequelize.define('EmploymentPeriod', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  employeeId: { type: DataTypes.UUID, allowNull: false },
  validFrom: DataTypes.DATEONLY,
  validTo: DataTypes.DATEONLY,
  terminationReason: DataTypes.STRING,
  notes: DataTypes.TEXT,
  createdBy: DataTypes.UUID,
  endedBy: DataTypes.UUID,
  endedAt: DataTypes.DATE
}, { tableName: 'employment_periods', timestamps: true });

export default EmploymentPeriod;
