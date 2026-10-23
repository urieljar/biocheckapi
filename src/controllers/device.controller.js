import { testZktecoConnection } from '../services/zkteco.service.js';
import { synchronizeEmployees } from '../services/employee-sync.service.js';
import { synchronizeAttendances } from '../services/attendance-sync.service.js';

//tester de conexion con el reloj
export const testConnection = async (req, res) => {
  try {
    const result = await testZktecoConnection();

    res.json({
      ok: true,
      message: 'Conexión con el reloj establecida correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error de conexión con ZKTeco:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible conectar con el reloj ZKTeco',
      error: error.message
    });
  }
};

//sincronizacion de empleados
export const syncEmployees = async (req, res) => {
  try {
    const result = await synchronizeEmployees();

    res.json({
      ok: true,
      message: 'Empleados sincronizados correctamente',
      data: result
    });
  } catch (error) {
    console.error('Error al sincronizar empleados:', error.message);

    res.status(500).json({
      ok: false,
      message: 'No fue posible sincronizar los empleados',
      error: error.message
    });
  }
};

//sincronizacion de checadas
export const syncAttendances = async (req, res) => {
  try {
    const result = await synchronizeAttendances();

    res.json({
      ok: true,
      message: 'Checadas sincronizadas correctamente',
      data: result
    });
  } catch (error) {
    console.error(
      'Error al sincronizar checadas:',
      error.message
    );

    res.status(500).json({
      ok: false,
      message: 'No fue posible sincronizar las checadas',
      error: error.message
    });
  }
};
