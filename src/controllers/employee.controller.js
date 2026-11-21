import { validateProfileClockName, saveProfileWithClockName, sendProfileClockName, profileClockNameMessage } from '../services/profile-name-sync.service.js';
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
  queueUpdateUserInfoCommand,
  queueDeleteUserCommand
} from '../services/adms-command.service.js';
import { writeEmployeeToDevice, deleteEmployeeFromDevice } from '../services/device-user-write.service.js';
import { hasCapability } from '../security/roles.js';
import { EmploymentPeriod } from '../models/index.js';
import { validateEmploymentProfile } from '../services/profile-validation.service.js';

const DEVICE_ROLES = new Set([0, 2, 8, 12, 14]);
const ADMS_DEVICE_USER_ID_LIMIT = 8;
const requiresAdmsForEmployee = (employee) => String(employee.deviceUserId || '').length > ADMS_DEVICE_USER_ID_LIMIT;

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
  'employmentStatus',
  'terminationDate',
  'terminationReason',
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
    const laborProfile = await EmployeeProfile.findOne({ where: { employeeId: employee.id } });
    if (laborProfile?.employmentStatus === 'TERMINATED') {
      return { ok: false, error: new Error('Empleado dado de baja; no se envió al reloj') };
    }
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

    let sync = {
      transport: requiresAdmsForEmployee(employee) ? 'ADMS' : 'TCP',
      status: 'PENDING',
      commandId: null,
      error: null
    };

    try {
      if (requiresAdmsForEmployee(employee)) {
        const command = await queueUpdateUserInfoCommand({
          device,
          employee,
          serialNumber: device.serialNumber || normalizeOptionalString(req.body.serialNumber)
        });
        await employee.update({ deviceSyncStatus: 'PENDING', deviceSyncError: null, deviceSyncedAt: null });
        sync = { transport: 'ADMS', status: command.status, commandId: command.commandId, error: null };
      } else {
        const tcpResult = await syncEmployeeToDevice(employee);
        sync = {
          transport: 'TCP',
          status: tcpResult.ok ? 'SYNCED' : 'ERROR',
          commandId: null,
          error: tcpResult.ok ? null : tcpResult.error.message
        };
      }
    } catch (syncError) {
      await employee.update({ deviceSyncStatus: 'ERROR', deviceSyncError: syncError.message, deviceSyncedAt: null });
      sync = { ...sync, status: 'ERROR', error: syncError.message };
    }

    const result = await Employee.findByPk(employee.id, {
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name', 'ip', 'serialNumber']
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
      data: result,
      sync
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
    const clockNameError = validateProfileClockName(profileData);
    if (clockNameError) return res.status(400).json({ ok: false, message: clockNameError });
    if (profileData.employmentStatus && !hasCapability(req.user?.role, 'employee.status')) {
      return res.status(403).json({ ok: false, message: 'No tienes permiso para registrar el estado laboral' });
    }
    const employmentError = validateEmploymentProfile(profileData);
    if (employmentError) return res.status(400).json({ ok: false, message: employmentError });
    const catalogError = await validateProfileCatalogs(profileData);

    if (catalogError) {
      return res.status(400).json({
        ok: false,
        message: catalogError
      });
    }

    const saved = await saveProfileWithClockName({ employeeId: employee.id, values: profileData });
    const profile = saved.profile;
    const sync = await sendProfileClockName({ ...saved, syncDirect: syncEmployeeToDevice });

    res.status(201).json({
      ok: true,
      message: profileClockNameMessage('Perfil del empleado creado correctamente', sync),
      sync,
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

    const auditBefore = profile.get({ plain: true });

    const updates = buildProfileData(req.body);
    const clockNameError = validateProfileClockName(updates);
    if (clockNameError) return res.status(400).json({ ok: false, message: clockNameError });
    if (['employmentStatus', 'terminationDate', 'terminationReason'].some((key) => updates[key] !== undefined && updates[key] !== (profile[key] ?? null)) && !hasCapability(req.user?.role, 'employee.status')) {
      return res.status(403).json({ ok: false, message: 'No tienes permiso para cambiar el estado laboral' });
    }
    const laborFields = ['employmentStatus', 'hireDate', 'terminationDate', 'terminationReason'];
    if (laborFields.some((key) => updates[key] !== undefined && updates[key] !== (profile[key] ?? null)) &&
        await EmploymentPeriod.count({ where: { employeeId: employee.id } })) {
      return res.status(409).json({ ok: false, message: 'El empleado tiene historial laboral. Utiliza las acciones de baja o reingreso para conservarlo.' });
    }
    const employmentError = validateEmploymentProfile(updates, profile.get({ plain: true }));
    if (employmentError) return res.status(400).json({ ok: false, message: employmentError });

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

    const saved = await saveProfileWithClockName({ employeeId: employee.id, profile, values: updates });
    const sync = await sendProfileClockName({ ...saved, syncDirect: syncEmployeeToDevice });
    req.auditBefore = auditBefore;
    req.auditAfter = profile.get({ plain: true });

    res.json({
      ok: true,
      message: profileClockNameMessage('Perfil del empleado actualizado correctamente', sync),
      sync,
      data: saved.profile
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

    const auditBefore = employee.get({ plain: true });

    // Activar o desactivar a una persona es una decisión de supervisión, no de captura.
    if (req.body.active !== undefined && !hasCapability(req.user?.role, 'employee.status')) {
      return res.status(403).json({
        ok: false,
        message:
          'Solo un administrador o supervisor puede activar o desactivar empleados'
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

    // El nombre del checador es el dato editable en esta ventana; mantener
    // Nombre(s) del expediente alineado evita que ambos módulos diverjan.
    if (updates.name !== undefined) {
      await EmployeeProfile.update(
        { firstName: updates.name },
        { where: { employeeId: employee.id } }
      );
    }

    // Guardar los cambios locales y enviarlos al reloj siguiendo el mismo
    // flujo que el alta: ADMS para IDs largos y TCP para IDs cortos.
    let sync = { transport: null, status: 'PENDING', commandId: null, error: null };
    const device = await Device.findByPk(employee.deviceId);
    try {
      if (requiresAdmsForEmployee(employee)) {
        const command = await queueUpdateUserInfoCommand({ device, employee });
        sync = { transport: 'ADMS', status: command.status, commandId: command.commandId, error: null };
      } else {
        const tcpResult = await syncEmployeeToDevice(employee);
        sync = {
          transport: 'TCP',
          status: tcpResult.ok ? 'SYNCED' : 'ERROR',
          commandId: null,
          error: tcpResult.ok ? null : tcpResult.error.message
        };
      }
    } catch (syncError) {
      await employee.update({ deviceSyncStatus: 'ERROR', deviceSyncError: syncError.message, deviceSyncedAt: null });
      sync = { transport: requiresAdmsForEmployee(employee) ? 'ADMS' : 'TCP', status: 'ERROR', commandId: null, error: syncError.message };
    }

    const result = await getEmployeeById(employee.id);
    req.auditBefore = auditBefore;
    req.auditAfter = result;

    res.json({
      ok: true,
      message: sync.status === 'SYNCED'
        ? 'Ajustes actualizados y sincronizados con el checador'
        : sync.status === 'ERROR'
          ? 'Ajustes guardados en PostgreSQL, pero no fue posible sincronizarlos con el checador'
          : 'Ajustes actualizados; el comando quedó pendiente de confirmación del checador',
      data: result,
      sync
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
          attributes: ['id', 'name', 'ip', 'serialNumber']
        }
      ]
    });

    if (!employee) {
      return res.status(404).json({
        ok: false,
        message: 'Empleado no encontrado'
      });
    }
    const laborProfile = await EmployeeProfile.findOne({ where: { employeeId: employee.id } });
    if (laborProfile?.employmentStatus === 'TERMINATED') return res.status(409).json({ ok: false, message: 'El empleado está dado de baja. Registra su reingreso antes de enviarlo al reloj.' });


    if (requiresAdmsForEmployee(employee)) {
      const command = await queueUpdateUserInfoCommand({
        device: employee.device,
        employee,
        serialNumber: normalizeOptionalString(req.body?.serialNumber || req.query?.serialNumber)
      });
      await employee.update({ deviceSyncStatus: 'PENDING', deviceSyncError: null, deviceSyncedAt: null });
      const result = await getEmployeeById(employee.id);
      return res.status(202).json({
        ok: true,
        message: 'ID mayor de 8 caracteres: comando ADMS encolado; el reloj confirmará la sincronización',
        data: result,
        deviceResult: { transport: 'ADMS', commandId: command.commandId, status: command.status }
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
      deviceResult: { transport: 'TCP', result: syncResult.result }
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

export const removeEmployeeFromDevice = async (req, res) => {
  try {
    const employee = await Employee.findByPk(req.params.id, { include: [{ model: Device, as: 'device' }] });
    if (!employee) return res.status(404).json({ ok: false, message: 'Empleado no encontrado' });
    if (String(req.body?.confirmation || '').trim() !== String(employee.deviceUserId)) {
      return res.status(400).json({
        ok: false,
        message: 'Escribe el ID del checador para confirmar el retiro y la eliminación de sus biométricos'
      });
    }
    if (requiresAdmsForEmployee(employee)) {
      const command = await queueDeleteUserCommand({ device: employee.device, employee, serialNumber: normalizeOptionalString(req.body?.serialNumber || req.query?.serialNumber) });
      return res.status(202).json({ ok: true, message: 'Retiro encolado por ADMS; el reloj confirmará la eliminación', deviceResult: { transport: 'ADMS', commandId: command.commandId, status: command.status } });
    }
    const result = await deleteEmployeeFromDevice(employee);
    res.json({ ok: true, message: 'Empleado retirado del checador', deviceResult: { transport: 'TCP', result } });
  } catch (error) {
    res.status(502).json({ ok: false, message: 'No fue posible retirar al empleado del checador', error: error.message });
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
          attributes: ['id', 'name', 'ip', 'serialNumber']
        }
      ],
      order: [['updatedAt', 'ASC']],
      limit
    });

    const results = [];

    for (const employee of employees) {
      try {
        if (requiresAdmsForEmployee(employee)) {
          const command = await queueUpdateUserInfoCommand({
            device: employee.device,
            employee,
            serialNumber: normalizeOptionalString(req.body.serialNumber || req.query.serialNumber)
          });
          await employee.update({ deviceSyncStatus: 'PENDING', deviceSyncError: null, deviceSyncedAt: null });
          results.push({ employeeId: employee.id, deviceUserId: employee.deviceUserId, transport: 'ADMS', ok: true, status: command.status, commandId: command.commandId });
        } else {
          const syncResult = await syncEmployeeToDevice(employee);
          results.push({ employeeId: employee.id, deviceUserId: employee.deviceUserId, transport: 'TCP', ok: syncResult.ok, status: syncResult.ok ? 'SYNCED' : 'ERROR', error: syncResult.ok ? null : syncResult.error.message });
        }
      } catch (error) {
        await employee.update({ deviceSyncStatus: 'ERROR', deviceSyncError: error.message, deviceSyncedAt: null });
        results.push({ employeeId: employee.id, deviceUserId: employee.deviceUserId, ok: false, status: 'ERROR', error: error.message });
      }
    }

    res.json({
      ok: true,
      message:
        employees.length === 0
          ? 'No hay empleados pendientes de sincronizar'
        : 'Empleados pendientes procesados usando TCP o ADMS según el tamaño del ID',
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
    const laborProfile = await EmployeeProfile.findOne({ where: { employeeId: employee.id } });
    if (laborProfile?.employmentStatus === 'TERMINATED') return res.status(409).json({ ok: false, message: 'El empleado está dado de baja. Registra su reingreso antes de enviarlo al reloj.' });


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

    const laborStatus = req.query.laborStatus || 'ALL';
    if (!['ALL', 'ACTIVE', 'TERMINATED', 'DELETED'].includes(laborStatus)) return res.status(400).json({ ok: false, message: 'Filtro laboral inválido' });
    if (laborStatus === 'DELETED' && !hasCapability(req.user?.role, 'employee.delete')) return res.status(403).json({ ok: false, message: 'No tienes permiso para consultar registros eliminados' });
    if (laborStatus === 'TERMINATED') where['$profile.employmentStatus$'] = 'TERMINATED';
    if (laborStatus === 'ACTIVE') where[Op.and] = [{ [Op.or]: [{ '$profile.employmentStatus$': null }, { '$profile.employmentStatus$': { [Op.ne]: 'TERMINATED' } }] }];
    if (laborStatus === 'DELETED') where.deletedAt = { [Op.ne]: null };

    const { count, rows } = await Employee.findAndCountAll({
      where,
      paranoid: laborStatus !== 'DELETED',
      include: [
        { model: EmployeeProfile, as: 'profile', attributes: ['employmentStatus', 'hireDate', 'terminationDate', 'terminationReason'] },
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
