import {
  Area,
  Department,
  Position,
  EmployeeProfile,
  Employee
} from '../models/index.js';

const CATALOGS = {
  departments: Department,
  areas: Area,
  positions: Position
};

const getCatalogModel = (catalog) => CATALOGS[catalog];

const validateDepartmentParent = async (id, parentId) => {
  if (parentId === undefined || parentId === null || parentId === '') {
    return null;
  }

  if (id && id === parentId) {
    return 'Un departamento no puede ser su propio departamento superior';
  }

  const parent = await Department.findByPk(parentId);

  return parent ? null : 'parentId no corresponde a un departamento existente';
};

const validatePositionParent = async (id, parentId) => {
  if (parentId === undefined || parentId === null || parentId === '') {
    return null;
  }

  if (id && id === parentId) {
    return 'Un puesto no puede ser su propio puesto superior';
  }

  const parent = await Position.findByPk(parentId);

  return parent ? null : 'parentId no corresponde a un puesto existente';
};

const validateAreaParent = async (id, parentId) => {
  if (parentId === undefined || parentId === null || parentId === '') return null;
  if (id && id === parentId) return 'Un área no puede ser su propia área superior';
  const parent = await Area.findByPk(parentId);
  return parent ? null : 'parentId no corresponde a un área existente';
};

const getDepartmentIncludes = () => [
  {
    model: Department,
    as: 'parent',
    attributes: ['id', 'code', 'name']
  },
  {
    model: EmployeeProfile,
    as: 'employeeProfiles',
    attributes: ['id'],
    include: [
      {
        model: Employee,
        as: 'employee',
        attributes: ['id', 'active']
      }
    ]
  }
];

const serializeDepartment = (department) => {
  const data = department.toJSON();
  const profiles = data.employeeProfiles || [];

  return {
    ...data,
    employeeProfiles: undefined,
    employeeCount: profiles.length,
    resignedCount: profiles.filter(
      (profile) => profile.employee?.active === false
    ).length
  };
};

const getPositionIncludes = () => [
  {
    model: Position,
    as: 'parent',
    attributes: ['id', 'code', 'name']
  },
  {
    model: EmployeeProfile,
    as: 'employeeProfiles',
    attributes: ['id'],
    include: [
      {
        model: Employee,
        as: 'employee',
        attributes: ['id', 'active']
      }
    ]
  }
];

const serializePosition = (position) => {
  const data = position.toJSON();
  const profiles = data.employeeProfiles || [];

  return {
    ...data,
    employeeProfiles: undefined,
    employeeCount: profiles.length,
    resignedCount: profiles.filter(
      (profile) => profile.employee?.active === false
    ).length
  };
};

const getAreaIncludes = () => [
  { model: Area, as: 'parent', attributes: ['id', 'code', 'name'] },
  {
    model: EmployeeProfile,
    as: 'employeeProfiles',
    attributes: ['id'],
    include: [{ model: Employee, as: 'employee', attributes: ['id', 'active', 'deviceId'] }]
  }
];

const serializeArea = (area) => {
  const data = area.toJSON();
  const profiles = data.employeeProfiles || [];
  const deviceIds = new Set(profiles.map((p) => p.employee?.deviceId).filter(Boolean));

  return {
    ...data,
    employeeProfiles: undefined,
    deviceCount: deviceIds.size,
    employeeCount: profiles.length,
    resignedCount: profiles.filter((p) => p.employee?.active === false).length
  };
};

const getCatalogIncludes = (Model) => {
  if (Model === Department) return getDepartmentIncludes();
  if (Model === Position) return getPositionIncludes();
  if (Model === Area) return getAreaIncludes();
  return undefined;
};

const serializeCatalogItem = (Model, item) => {
  if (Model === Department) return serializeDepartment(item);
  if (Model === Position) return serializePosition(item);
  if (Model === Area) return serializeArea(item);
  return item;
};

export const getCatalogItems = async (req, res) => {
  try {
    const Model = getCatalogModel(req.params.catalog);

    if (!Model) {
      return res.status(404).json({
        ok: false,
        message: 'Catálogo no encontrado'
      });
    }

    const items = await Model.findAll({
      where: { active: true },
      order: [['name', 'ASC']],
      ...(getCatalogIncludes(Model)
        ? { include: getCatalogIncludes(Model) }
        : {})
    });

    res.json({
      ok: true,
      data: items.map((item) => serializeCatalogItem(Model, item))
    });
  } catch (error) {
    console.error('Error al consultar catálogo:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el catálogo'
    });
  }
};

export const createCatalogItem = async (req, res) => {
  try {
    const Model = getCatalogModel(req.params.catalog);
    const name = String(req.body.name || '').trim();

    if (!Model) {
      return res.status(404).json({
        ok: false,
        message: 'Catálogo no encontrado'
      });
    }

    if (!name) {
      return res.status(400).json({
        ok: false,
        message: 'name es obligatorio'
      });
    }

    if (Model === Department || Model === Position || Model === Area) {
      const code = String(req.body.code || '').trim();

      if (!code) {
        return res.status(400).json({
          ok: false,
          message: `code es obligatorio para ${Model === Department ? 'un departamento' : Model === Position ? 'un puesto' : 'un área'}`
        });
      }

      const parentValidator = Model === Department
        ? validateDepartmentParent
        : Model === Position
          ? validatePositionParent
          : validateAreaParent;
      const parentError = await parentValidator(
        null,
        req.body.parentId
      );

      if (parentError) {
        return res.status(400).json({ ok: false, message: parentError });
      }

      const item = await Model.create({
        code,
        name,
        parentId: req.body.parentId || null,
        active: true
      });

      return res.status(201).json({
        ok: true,
        message: `${Model === Department ? 'Departamento' : Model === Position ? 'Puesto' : 'Área'} creado correctamente`,
        data: item
      });
    }

    const item = await Model.create({ name, active: true });

    res.status(201).json({
      ok: true,
      message: 'Elemento del catálogo creado correctamente',
      data: item
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        ok: false,
        message: 'Ya existe un elemento con ese nombre'
      });
    }

    console.error('Error al crear elemento de catálogo:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible crear el elemento del catálogo'
    });
  }
};

export const updateCatalogItem = async (req, res) => {
  try {
    const Model = getCatalogModel(req.params.catalog);

    if (!Model) {
      return res.status(404).json({
        ok: false,
        message: 'Catálogo no encontrado'
      });
    }

    const item = await Model.findByPk(req.params.id);

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: 'Elemento del catálogo no encontrado'
      });
    }

    const updates = {};

    if (Model === Department || Model === Position || Model === Area) {
      const parentValidator = Model === Department
        ? validateDepartmentParent
        : Model === Position
          ? validatePositionParent
          : validateAreaParent;
      const parentError = await parentValidator(
        item.id,
        req.body.parentId
      );

      if (parentError) {
        return res.status(400).json({ ok: false, message: parentError });
      }

      if (req.body.code !== undefined) {
        const code = String(req.body.code || '').trim();

        if (!code) {
          return res.status(400).json({
            ok: false,
            message: 'code no puede estar vacío'
          });
        }

        updates.code = code;
      }

      if (req.body.parentId !== undefined) {
        updates.parentId = req.body.parentId || null;
      }
    }

    if (req.body.name !== undefined) {
      const name = String(req.body.name || '').trim();

      if (!name) {
        return res.status(400).json({
          ok: false,
          message: 'name no puede estar vacío'
        });
      }

      updates.name = name;
    }

    if (req.body.active !== undefined) {
      if (typeof req.body.active !== 'boolean') {
        return res.status(400).json({
          ok: false,
          message: 'active debe ser booleano'
        });
      }

      updates.active = req.body.active;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Envía name, code, parentId o active para actualizar'
      });
    }

    await item.update(updates);

    res.json({
      ok: true,
      message: 'Elemento del catálogo actualizado correctamente',
      data: item
    });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        ok: false,
        message: 'Ya existe un elemento con ese nombre'
      });
    }

    console.error('Error al actualizar elemento de catálogo:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el elemento del catálogo'
    });
  }
};

export const getCatalogItem = async (req, res) => {
  try {
    const Model = getCatalogModel(req.params.catalog);

    if (!Model) {
      return res.status(404).json({ ok: false, message: 'Catálogo no encontrado' });
    }

    const item = await Model.findByPk(req.params.id, {
      ...(getCatalogIncludes(Model)
        ? { include: getCatalogIncludes(Model) }
        : {})
    });

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: 'Elemento del catálogo no encontrado'
      });
    }

    res.json({
      ok: true,
      data: serializeCatalogItem(Model, item)
    });
  } catch (error) {
    console.error('Error al consultar elemento de catálogo:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible consultar el elemento del catálogo'
    });
  }
};

export const deleteCatalogItem = async (req, res) => {
  try {
    const Model = getCatalogModel(req.params.catalog);

    if (!Model) {
      return res.status(404).json({ ok: false, message: 'Catálogo no encontrado' });
    }

    const item = await Model.findByPk(req.params.id);

    if (!item) {
      return res.status(404).json({
        ok: false,
        message: 'Elemento del catálogo no encontrado'
      });
    }

    const profileField = Model === Department
      ? 'departmentId'
      : Model === Position
        ? 'positionId'
        : 'areaId';

    const assignedEmployees = await EmployeeProfile.count({
      where: { [profileField]: item.id }
    });

    if (assignedEmployees > 0) {
      return res.status(409).json({
        ok: false,
        message: 'No se puede eliminar porque tiene empleados asignados',
        data: {
          assignedEmployees
        }
      });
    }

    const childItems = await Model.count({
      where: { parentId: item.id }
    });

    if (childItems > 0) {
      return res.status(409).json({
        ok: false,
        message: 'No se puede eliminar porque tiene elementos dependientes asignados',
        data: {
          childItems
        }
      });
    }

    await item.update({ active: false });

    res.json({
      ok: true,
      message: 'Elemento del catálogo desactivado correctamente',
      data: item
    });
  } catch (error) {
    console.error('Error al eliminar elemento de catálogo:', error.message);
    res.status(500).json({
      ok: false,
      message: 'No fue posible eliminar el elemento del catálogo'
    });
  }
};
