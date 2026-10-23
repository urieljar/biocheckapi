import { Op } from 'sequelize';
import {
  Device,
  Employee,
  EmployeeProfile,
  Department,
  Area,
  Position
} from '../models/index.js';
import {
  queueUpdateUserInfoCommand
} from '../services/adms-command.service.js';
import { writeEmployeeToDevice } from '../services/device-user-write.service.js';

const DEVICE_ROLES = new Set([0, 2, 8, 12, 14]);

const resolveEmployeeDevice = async ({ deviceId, deviceIp }) => {
  if (deviceId) {
    return Device.findByPk(deviceId);
  }

  const ip = deviceIp || process.env.ZK_IP;

  if (!ip) {
    return null;
  }

  const [device] = await Device.findOrCreate({
    where: { ip },
    defaults: {
      name: process.env.ZK_NAME || 'ZKTeco',
      ip,
      port: Number(process.env.ZK_PORT) || 4370,
      deviceNumber: Number(process.env.ZK_DEVICE_NUMBER) || null,
      serialNumber: process.env.ZK_SERIAL_NUMBER || null,
      active: true,
      lastConnectionAt: null
    }
  });

  return device;
};

const normalizeOptionalString = (value) => {
  if (value === undefined || value === null) return null;

  const trimmed = String(value).trim();

  return trimmed || null;
};

const getEmployeeById = async (id, attributes) => {
  return Employee.findByPk(id, {
    include: [
      {
        model: Device,
        as: 'device',
        attributes: ['id', 'name', 'ip']
      },
      {
        model: EmployeeProfile,
        as: 'profile',
        include: [
          { model: Department, as: 'department' },
          { model: Area, as: 'area' },
          { model: Position, as: 'position' }
        ]
      }
    ],
    ...(attributes ? { attributes } : {})
  });
};

const PROFILE_FIELDS = [
  'firstName',
  'lastName',
  'employeeNumber',
  'departmentId',
  'positionId',
  'areaId',
  'employmentType',
  'hireDate',
  'socialSecurityNumber',
  'passportNumber',
  'driverLicenseVehicle',
  'driverLicenseMotorcycle',
  'phone',
  'officePhone',
  'mobilePhone',
  'nationalId',
  'religion',
  'city',
  'address',
  'postalCode',
  'email',
  'birthDate'
];

const buildProfileData = (body) => {
  const data = {};

  for (const field of PROFILE_FIELDS) {
    if (body[field] !== undefined) {
      data[field] = normalizeOptionalString(body[field]);
    }
  }

  return data;
};

const validateProfileCatalogs = async (data) => {
  const catalogs = [
    ['departmentId', Department],
    ['areaId', Area],
    ['positionId', Position]
  ];

  for (const [field, Model] of catalogs) {
    if (data[field] === undefined || data[field] === null) continue;

    const item = await Model.findByPk(data[field]);

    if (!item) {
      return `${field} no corresponde a un catálogo existente`;
    }
  }

  return null;
};

const getEmployeeWithProfile = async (employeeId) => {
  return Employee.findByPk(employeeId, {
    include: [
      {
        model: EmployeeProfile,
        as: 'profile',
        include: [
          { model: Department, as: 'department' },
          { model: Area, as: 'area' },
          { model: Position, as: 'position' }
        ]
      }
    ]
  });
};

const parseOptionalBoolean = (value) => {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;

  if (value === 'true') return true;
  if (value === 'false') return false;

  return null;
};

const normalizeDeviceUid = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const deviceUid = Number(value);

  if (
    !Number.isInteger(deviceUid) ||
    deviceUid <= 0 ||
    deviceUid > 65535
  ) {
    return null;
  }

  return deviceUid;
};

const findEmployeeByDeviceUid = async (
  deviceId,
  deviceUid,
  excludeEmployeeId = null
) => {
  if (deviceUid === null) return null;

  const where = {
    deviceId,
    deviceUid
  };

  if (excludeEmployeeId) {
    where.id = {
      [Op.ne]: excludeEmployeeId
    };
  }

  return Employee.findOne({ where });
};

const syncEmployeeToDevice = async (employee) => {
  try {
    const result = await writeEmployeeToDevice(employee);

    await employee.update({
      deviceSyncStatus: 'SYNCED',
      deviceSyncError: null,
      deviceSyncedAt: new Date()
    });

    return {
      ok: true,
      result
    };
  } catch (error) {
    await employee.update({
      deviceSyncStatus: 'ERROR',
      deviceSyncError: error.message,
      deviceSyncedAt: null
    });

    return {
      ok: false,
      error
    };
  }
};

export const createEmployee = async (req, res) => {
  try {
    const {
      deviceId,
      deviceIp,
      deviceUserId,
      deviceUid,
      name,
      deviceRole = 0,
      devicePin,
      cardNumber,
      active = true
    } = req.body;

    const normalizedDeviceUserId =
      normalizeOptionalString(deviceUserId);

    const normalizedName = normalizeOptionalString(name);

    if (!normalizedDeviceUserId || !normalizedName) {
      return res.status(400).json({
        ok: false,
        message: 'deviceUserId y name son obligatorios'
      });
    }

    const role = Number(deviceRole);

    if (!Number.isInteger(role) || !DEVICE_ROLES.has(role)) {
      return res.status(400).json({
        ok: false,
        message:
          'deviceRole debe ser uno de: 0, 2, 8, 12 o 14'
      });
    }

    const normalizedPin = normalizeOptionalString(devicePin);

    if (normalizedPin && !/^\d{1,20}$/.test(normalizedPin)) {
      return res.status(400).json({
        ok: false,
        message:
          'devicePin debe contener solo números y máximo 20 dígitos'
      });
    }

    const normalizedDeviceUid = normalizeDeviceUid(deviceUid);

    if (
      deviceUid !== undefined &&
      deviceUid !== null &&
      deviceUid !== '' &&
      normalizedDeviceUid === null
    ) {
      return res.status(400).json({
        ok: false,
        message:
          'deviceUid debe ser un número entero entre 1 y 65535'
      });
    }

    const device = await resolveEmployeeDevice({
      deviceId,
      deviceIp
    });

    if (!device) {
      return res.status(400).json({
        ok: false,
        message:
          'No se encontró un dispositivo. Envía deviceId o configura ZK_IP en .env'
      });
    }

    const employeeWithSameUid = await findEmployeeByDeviceUid(
      device.id,
      normalizedDeviceUid
    );

    if (employeeWithSameUid) {
      return res.status(409).json({
        ok: false,
        message:
          'Ya existe un empleado con ese deviceUid para este dispositivo',
        data: {
          id: employeeWithSameUid.id,
          deviceUserId: employeeWithSameUid.deviceUserId,
          name: employeeWithSameUid.name,
          deviceUid: employeeWithSameUid.deviceUid
        }
      });
    }

    const employee = await Employee.create({
      deviceId: device.id,
      deviceUserId: normalizedDeviceUserId,
      deviceUid: normalizedDeviceUid,
      name: normalizedName,
      deviceRole: role,
      devicePin: normalizedPin,
      deviceSyncStatus: 'PENDING',
      deviceSyncError: null,
      deviceSyncedAt: null,
      cardNumber: normalizeOptionalString(cardNumber),
      active: Boolean(active)
    });

    const result = await Employee.findByPk(employee.id, {
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name', 'ip']
        }
      ],
      attributes: {
        exclude: ['devicePin']
      }
    });

    res.status(201).json({
      ok: true,
      message:
        'Empleado guardado correctamente en la base de datos',
      data: result
    });
  } catch (error) {
    console.error('Error al crear empleado:', error.message);

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        ok: false,
        message:
          'Ya existe un empleado con ese deviceUserId para este dispositivo'
      });
    }

    if (error.name === 'SequelizeDatabaseError') {
      return res.status(500).json({
        ok: false,
        message:
          'No fue posible guardar el empleado. Revisa que la tabla employees tenga la columna device_pin'
      });
    }

    res.status(500).json({
      ok: false,
      message: 'No fue posible crear el empleado'
    });
  }
};

export const getEmployee = async (req, res) => {
  try {
    const employee = await getEmployeeById(req.params.id);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    res.json({
      ok: true,
      data: employee
    });
  } catch (error) {
    console.error('Error al consultar empleado:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el empleado'
    });
  }
};

export const getEmployeeProfile = async (req, res) => {
  try {
    const employee = await getEmployeeWithProfile(req.params.id);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    res.json({
      ok: true,
      data: employee.profile
    });
  } catch (error) {
    console.error('Error al consultar perfil del empleado:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el perfil del empleado'
    });
  }
};

export const createEmployeeProfile = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    const existingProfile = await EmployeeProfile.findOne({
      where: { employeeId: employee.id }
    });

    if (existingProfile) {
      return res.status(409).json({
        ok: false,
        message: 'El empleado ya tiene un perfil creado',
        data: existingProfile
      });
    }

    const profileData = buildProfileData(req.body);
    const catalogError = await validateProfileCatalogs(profileData);

    if (catalogError) {
      return res.status(400).json({
        ok: false,
        message: catalogError
      });
    }

    const profile = await EmployeeProfile.create({
      employeeId: employee.id,
      ...profileData
    });

    res.status(201).json({
      ok: true,
      message: 'Perfil del empleado creado correctamente',
      data: profile
    });
  } catch (error) {
    console.error('Error al crear perfil del empleado:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible crear el perfil del empleado'
    });
  }
};

export const updateEmployeeProfile = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    const profile = await EmployeeProfile.findOne({
      where: { employeeId: employee.id }
    });

    if (!profile) {
      return res.status(404).json({
        ok: false,
        message: 'El empleado todavía no tiene un perfil creado'
      });
    }

    const updates = buildProfileData(req.body);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Envía al menos un campo del perfil para actualizar'
      });
    }

    const catalogError = await validateProfileCatalogs(updates);

    if (catalogError) {
      return res.status(400).json({
        ok: false,
        message: catalogError
      });
    }

    await profile.update(updates);

    res.json({
      ok: true,
      message: 'Perfil del empleado actualizado correctamente',
      data: profile
    });
  } catch (error) {
    console.error('Error al actualizar perfil del empleado:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el perfil del empleado'
    });
  }
};

export const updateEmployeeDeviceSettings = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id);

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    const updates = {};

    if (req.body.name !== undefined) {
      const name = normalizeOptionalString(req.body.name);

      if (!name) {
        return res.status(400).json({
          ok: false,
          message: 'name no puede estar vacío'
        });
      }

      updates.name = name;
    }

    if (req.body.deviceUid !== undefined) {
      const deviceUid = normalizeDeviceUid(req.body.deviceUid);

      if (
        req.body.deviceUid !== null &&
        req.body.deviceUid !== '' &&
        deviceUid === null
      ) {
        return res.status(400).json({
          ok: false,
          message:
            'deviceUid debe ser un número entero entre 1 y 65535'
        });
      }

      updates.deviceUid = deviceUid;
    }

    if (req.body.deviceRole !== undefined) {
      const role = Number(req.body.deviceRole);

      if (!Number.isInteger(role) || !DEVICE_ROLES.has(role)) {
        return res.status(400).json({
          ok: false,
          message:
            'deviceRole debe ser uno de: 0, 2, 8, 12 o 14'
        });
      }

      updates.deviceRole = role;
    }

    if (req.body.devicePin !== undefined) {
      const normalizedPin =
        normalizeOptionalString(req.body.devicePin);

      if (normalizedPin && !/^\d{1,20}$/.test(normalizedPin)) {
        return res.status(400).json({
          ok: false,
          message:
            'devicePin debe contener solo números y máximo 20 dígitos'
        });
      }

      updates.devicePin = normalizedPin;
    }

    if (req.body.cardNumber !== undefined) {
      updates.cardNumber = normalizeOptionalString(
        req.body.cardNumber
      );
    }

    if (req.body.active !== undefined) {
      const active = parseOptionalBoolean(req.body.active);

      if (active === null) {
        return res.status(400).json({
          ok: false,
          message: 'active debe ser true o false'
        });
      }

      updates.active = active;
    }

    if (updates.deviceUid !== undefined) {
      const employeeWithSameUid = await findEmployeeByDeviceUid(
        employee.deviceId,
        updates.deviceUid,
        employee.id
      );

      if (employeeWithSameUid) {
        return res.status(409).json({
          ok: false,
          message:
            'Ya existe un empleado con ese deviceUid para este dispositivo',
          data: {
            id: employeeWithSameUid.id,
            deviceUserId: employeeWithSameUid.deviceUserId,
            name: employeeWithSameUid.name,
            deviceUid: employeeWithSameUid.deviceUid
          }
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        message:
          'Envía al menos un campo: name, deviceUid, deviceRole, devicePin, cardNumber o active'
      });
    }

    await employee.update({
      ...updates,
      deviceSyncStatus: 'PENDING',
      deviceSyncError: null,
      deviceSyncedAt: null
    });

    const result = await getEmployeeById(employee.id);

    res.json({
      ok: true,
      message:
        'Ajustes del dispositivo actualizados en PostgreSQL. El empleado quedó pendiente de sincronizar al checador',
      data: result
    });
  } catch (error) {
    console.error(
      'Error al actualizar ajustes del empleado:',
      error.message
    );

    if (error.name === 'SequelizeDatabaseError') {
      return res.status(500).json({
        ok: false,
        message:
          'No fue posible actualizar los ajustes. Revisa que existan las columnas device_sync_status, device_sync_error y device_synced_at'
      });
    }

    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        ok: false,
        message:
          'Ya existe otro empleado con ese identificador en este dispositivo'
      });
    }

    res.status(500).json({
      ok: false,
      message:
        'No fue posible actualizar los ajustes del dispositivo'
    });
  }
};

export const syncEmployeeToDeviceById = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id, {
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name', 'ip']
        }
      ]
    });

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    const syncResult = await syncEmployeeToDevice(employee);
    const result = await getEmployeeById(employee.id);

    if (!syncResult.ok) {
      return res.status(502).json({
        ok: false,
        message:
          'No fue posible sincronizar el empleado al checador',
        error: syncResult.error.message,
        data: result
      });
    }

    res.json({
      ok: true,
      message: 'Empleado sincronizado correctamente al checador',
      data: result,
      deviceResult: syncResult.result
    });
  } catch (error) {
    console.error(
      'Error al sincronizar empleado al checador:',
      error.message
    );

    res.status(500).json({
      ok: false,
      message: 'No fue posible sincronizar el empleado al checador'
    });
  }
};

export const syncPendingEmployeesToDevice = async (req, res) => {
  try {
    const rawLimit = Number(req.body.limit ?? req.query.limit ?? 1);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 10)
        : 1;

    const employees = await Employee.findAll({
      where: {
        deviceSyncStatus: 'PENDING'
      },
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name', 'ip']
        }
      ],
      order: [['updatedAt', 'ASC']],
      limit
    });

    const results = [];

    for (const employee of employees) {
      const syncResult = await syncEmployeeToDevice(employee);
      const updatedEmployee = await getEmployeeById(employee.id);

      results.push({
        employeeId: employee.id,
        deviceUserId: employee.deviceUserId,
        ok: syncResult.ok,
        error: syncResult.ok
          ? null
          : syncResult.error.message,
        data: updatedEmployee
      });
    }

    res.json({
      ok: true,
      message:
        employees.length === 0
          ? 'No hay empleados pendientes de sincronizar'
          : 'Sincronización de empleados pendientes finalizada',
      processed: employees.length,
      data: results
    });
  } catch (error) {
    console.error(
      'Error al sincronizar empleados pendientes:',
      error.message
    );

    res.status(500).json({
      ok: false,
      message:
        'No fue posible sincronizar empleados pendientes al checador'
    });
  }
};

export const queueEmployeeAdmsSync = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id, {
      include: [
        {
          model: Device,
          as: 'device',
          attributes: [
            'id',
            'name',
            'ip',
            'serialNumber'
          ]
        }
      ]
    });

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }

    const command = await queueUpdateUserInfoCommand({
      device: employee.device,
      employee,
      serialNumber: normalizeOptionalString(
        req.body.serialNumber
      )
    });

    await employee.update({
      deviceSyncStatus: 'PENDING',
      deviceSyncError: null,
      deviceSyncedAt: null
    });

    res.status(201).json({
      ok: true,
      message:
        'Comando ADMS encolado. El checador lo recibirá cuando consulte /iclock/getrequest',
      data: {
        commandId: command.commandId,
        serialNumber: command.serialNumber,
        command: command.command,
        status: command.status
      }
    });
  } catch (error) {
    console.error(
      'Error al encolar comando ADMS:',
      error.message
    );

    res.status(500).json({
      ok: false,
      message: 'No fue posible encolar el comando ADMS',
      error: error.message
    });
  }
};

export const getEmployees = async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(
      Math.max(Number(req.query.limit) || 20, 1),
      100
    );

    const offset = (page - 1) * limit;
    const search = req.query.search?.trim();

    const where = search
      ? {
          [Op.or]: [
            {
              name: {
                [Op.iLike]: `%${search}%`
              }
            },
            {
              deviceUserId: {
                [Op.iLike]: `%${search}%`
              }
            }
          ]
        }
      : {};

    const { count, rows } = await Employee.findAndCountAll({
      where,
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name', 'ip']
        }
      ],
      attributes: {
        exclude: ['password']
      },
      order: [['name', 'ASC']],
      limit,
      offset,
      distinct: true
    });

    res.json({
      ok: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Error al consultar empleados:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar los empleados'
    });
  }
};
