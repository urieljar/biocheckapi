import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const PayrollClosure = sequelize.define('PayrollClosure', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  fromDate: { type: DataTypes.DATEONLY, allowNull: false },
  toDate: { type: DataTypes.DATEONLY, allowNull: false },
  departmentId: { type: DataTypes.UUID, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'CLOSED', validate: { isIn: [['CLOSED', 'REOPENED']] } },
  notes: { type: DataTypes.STRING(500), allowNull: true },
  closedBy: { type: DataTypes.UUID, allowNull: false },
  closedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  reopenedBy: { type: DataTypes.UUID, allowNull: true },
  reopenedAt: { type: DataTypes.DATE, allowNull: true },
  reopenReason: { type: DataTypes.STRING(500), allowNull: true }
}, { tableName: 'payroll_closures', timestamps: true, indexes: [{ fields: ['status', 'fromDate', 'toDate'] }, { fields: ['departmentId', 'status'] }] });

export default PayrollClosure;
