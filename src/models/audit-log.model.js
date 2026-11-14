import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  actorId: { type: DataTypes.UUID, allowNull: true },
  action: { type: DataTypes.STRING(120), allowNull: false },
  category: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'API' },
  resourceType: { type: DataTypes.STRING(80), allowNull: true },
  resourceId: { type: DataTypes.STRING(120), allowNull: true },
  method: { type: DataTypes.STRING(10), allowNull: false },
  path: { type: DataTypes.STRING(500), allowNull: false },
  statusCode: { type: DataTypes.INTEGER, allowNull: false },
  success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  ipAddress: { type: DataTypes.STRING(128), allowNull: true },
  userAgent: { type: DataTypes.STRING(500), allowNull: true },
  beforeData: { type: DataTypes.JSONB, allowNull: true },
  afterData: { type: DataTypes.JSONB, allowNull: true },
  requestData: { type: DataTypes.JSONB, allowNull: true },
  metadata: { type: DataTypes.JSONB, allowNull: true },
  errorMessage: { type: DataTypes.STRING(500), allowNull: true }
}, {
  tableName: 'audit_logs',
  timestamps: true,
  updatedAt: false,
  indexes: [
    { fields: ['createdAt'] },
    { fields: ['actorId', 'createdAt'] },
    { fields: ['action', 'createdAt'] },
    { fields: ['resourceType', 'resourceId'] }
  ]
});

export default AuditLog;
