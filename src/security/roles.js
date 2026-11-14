// Catálogo único de roles y capacidades de BioCheck.
// Escalera de privilegios: CONSULTA < SUPERVISOR < ADMIN < ROOT.
// Cualquier cambio de permisos se hace en este archivo y no en las rutas.
export const ROLES = Object.freeze({
  ROOT: 'ROOT',
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  CONSULTA: 'CONSULTA'
});

export const ROLE_LIST = ['ROOT', 'ADMIN', 'SUPERVISOR', 'CONSULTA'];
export const DEFAULT_ROLE = ROLES.CONSULTA;

// Roles con acceso a la administración de cuentas.
export const MANAGEMENT_ROLES = [ROLES.ROOT, ROLES.ADMIN];
// Roles que solo puede gestionar ROOT (nunca un ADMIN).
export const PRIVILEGED_ROLES = [ROLES.ROOT, ROLES.ADMIN];

const OPERATIONAL_ROLES = [ROLES.ROOT, ROLES.ADMIN, ROLES.SUPERVISOR];

export const CAPABILITIES = Object.freeze({
  'employee.write': OPERATIONAL_ROLES,
  'employee.pin.read': MANAGEMENT_ROLES,
  'employee.status': OPERATIONAL_ROLES,
  'employee.delete': MANAGEMENT_ROLES,
  'attendance.sync': OPERATIONAL_ROLES,
  // Solo ROOT puede registrar o borrar checadas manuales por defecto
  'attendance.write': [ROLES.ROOT],
  'schedule.write': OPERATIONAL_ROLES,
  'catalog.write': OPERATIONAL_ROLES,
  'exception.write': OPERATIONAL_ROLES,
  // Importar usuarios del reloj puede desactivar empleados en masa.
  'device.import': MANAGEMENT_ROLES,
  // Alta, edición, estado y contraseña de otras cuentas.
  'user.manage': MANAGEMENT_ROLES,
  // Crear, editar o degradar cuentas ADMIN y ROOT. Exclusivo de ROOT.
  'user.managePrivileged': [ROLES.ROOT],
  // Módulo exclusivo de ROOT para control maestro, permisos y acciones del sistema.
  'system.rootControl': [ROLES.ROOT],
  'audit.read': MANAGEMENT_ROLES,
  'payroll.close': MANAGEMENT_ROLES,
  'payroll.reopen': [ROLES.ROOT]
});

export const CAPABILITY_METADATA = Object.freeze({
  'employee.delete': { name: 'Eliminar y recuperar empleados', category: 'Personal', description: 'Eliminar de forma recuperable registros sin historial y restaurarlos.' },
  'attendance.write': {
    name: 'Checadas Manuales',
    category: 'Asistencias',
    description: 'Registrar y eliminar checadas de colaboradores manualmente por olvido.'
  },
  'attendance.sync': {
    name: 'Sincronización de Asistencias',
    category: 'Asistencias',
    description: 'Forzar sincronización inmediata de marcas con los relojes checadores.'
  },
  'employee.write': {
    name: 'Gestión de Empleados',
    category: 'Personal',
    description: 'Crear, editar perfiles y actualizar información general de colaboradores.'
  },
  'employee.pin.read': {
    name: 'Consulta de PINs',
    category: 'Personal',
    description: 'Visualizar contraseñas o PINs asignados en el reloj a cada empleado.'
  },
  'employee.status': {
    name: 'Estado de Empleados',
    category: 'Personal',
    description: 'Activar o desactivar colaboradores (afecta sincronización en reloj).'
  },
  'schedule.write': {
    name: 'Gestión de Horarios',
    category: 'Horarios',
    description: 'Crear, editar y asignar turnos semanales y rotativos a colaboradores.'
  },
  'exception.write': {
    name: 'Justificaciones e Incidencias',
    category: 'Horarios',
    description: 'Autorizar permisos, vacaciones, incapacidades y justificar faltas.'
  },
  'catalog.write': {
    name: 'Catálogos de Empresa',
    category: 'Estructura',
    description: 'Administrar áreas, departamentos y puestos de trabajo.'
  },
  'device.import': {
    name: 'Importación desde Reloj',
    category: 'Dispositivos',
    description: 'Importar usuarios directamente desde el dispositivo ZKTeco MB160.'
  },
  'user.manage': {
    name: 'Administración de Cuentas',
    category: 'Sistema',
    description: 'Crear usuarios, restablecer contraseñas y desactivar cuentas operativas.'
  },
  'user.managePrivileged': {
    name: 'Gestión de Cuentas Privilegiadas',
    category: 'Seguridad',
    description: 'Crear o editar administradores (ADMIN) y propietarios (ROOT). Exclusivo de ROOT.',
    readOnly: true
  },
  'system.rootControl': {
    name: 'Control Maestro ROOT',
    category: 'Seguridad',
    description: 'Acceso total al panel de administración de permisos y funciones del sistema.',
    readOnly: true
  },
  'audit.read': {
    name: 'Consulta de auditoría',
    category: 'Seguridad',
    description: 'Consultar quién realizó cambios, acciones sensibles y errores del API.'
  },
  'payroll.close': { name: 'Cerrar pre-nómina', category: 'Asistencias', description: 'Cerrar un periodo para impedir cambios manuales.' },
  'payroll.reopen': { name: 'Reabrir pre-nómina', category: 'Seguridad', description: 'Reabrir un periodo cerrado con motivo obligatorio.' }
});

// Cache dinámico en memoria de capacidades configuradas por ROOT
let dynamicCapabilities = null;

export const getCapabilities = () => {
  if (dynamicCapabilities) {
    return { ...dynamicCapabilities };
  }
  return { ...CAPABILITIES };
};

export const setDynamicCapabilities = (newMap = {}) => {
  const sanitized = {};
  for (const cap of Object.keys(CAPABILITIES)) {
    // Estas capacidades son intocables por seguridad
    if (cap === 'user.managePrivileged' || cap === 'system.rootControl') {
      sanitized[cap] = [ROLES.ROOT];
      continue;
    }
    const incomingRoles = Array.isArray(newMap[cap]) ? newMap[cap] : (CAPABILITIES[cap] || []);
    const validRoles = Array.from(
      new Set(incomingRoles.map(normalizeRole).filter((r) => ROLE_LIST.includes(r)))
    );
    // ROOT siempre debe conservar todos los permisos
    if (!validRoles.includes(ROLES.ROOT)) {
      validRoles.unshift(ROLES.ROOT);
    }
    sanitized[cap] = validRoles;
  }
  dynamicCapabilities = sanitized;
  return { ...dynamicCapabilities };
};

export const resetDynamicCapabilities = () => {
  dynamicCapabilities = null;
  return { ...CAPABILITIES };
};

// Compatibilidad: las cuentas creadas antes del catálogo de cuatro roles
// conservan la columna "USER" en PostgreSQL hasta ejecutar migrate-roles.
export const normalizeRole = (role) =>
  role === 'USER' ? ROLES.SUPERVISOR : role;

export const isKnownRole = (role) => ROLE_LIST.includes(normalizeRole(role));

export const hasCapability = (role, capability) => {
  const active = dynamicCapabilities || CAPABILITIES;
  return (active[capability] || []).includes(normalizeRole(role));
};

export const isPrivilegedRole = (role) =>
  PRIVILEGED_ROLES.includes(normalizeRole(role));
