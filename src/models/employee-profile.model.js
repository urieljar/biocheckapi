import { DataTypes } from 'sequelize';
import sequelize from '../config/database.js';

const EmployeeProfile = sequelize.define(
  'EmployeeProfile',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },

    employeeId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true
    },

    firstName: DataTypes.STRING,
    lastName: DataTypes.STRING,
    employeeNumber: DataTypes.STRING,
    departmentId: DataTypes.UUID,
    positionId: DataTypes.UUID,
    areaId: DataTypes.UUID,
    employmentType: DataTypes.STRING,
    hireDate: DataTypes.DATEONLY,
    employmentStatus: { type: DataTypes.STRING, validate: { isIn: [['ACTIVE', 'TERMINATED']] } },
    terminationDate: DataTypes.DATEONLY,
    terminationReason: DataTypes.STRING,
    socialSecurityNumber: DataTypes.STRING,
    passportNumber: DataTypes.STRING,
    driverLicenseVehicle: DataTypes.STRING,
    driverLicenseMotorcycle: DataTypes.STRING,
    phone: DataTypes.STRING,
    officePhone: DataTypes.STRING,
    mobilePhone: DataTypes.STRING,
    nationalId: DataTypes.STRING,
    religion: DataTypes.STRING,
    city: DataTypes.STRING,
    address: DataTypes.STRING,
    postalCode: DataTypes.STRING,
    email: DataTypes.STRING,
    birthDate: DataTypes.DATEONLY
  },
  {
    tableName: 'employee_profiles',
    timestamps: true
  }
);

export default EmployeeProfile;
