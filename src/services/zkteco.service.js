import ZKLib from 'node-zklib';

//crear cliente de conexion con el reloj
const createZktecoClient = () => {
  return new ZKLib(
    process.env.ZK_IP,
    Number(process.env.ZK_PORT),
    10000,
    4000,
    Number(process.env.ZK_COMM_KEY),
    'tcp'
  );
};

//registrar el dispositivo en la base de datos
export const testZktecoConnection = async () => {
  const device = createZktecoClient();

  try {
    await device.createSocket();

    const deviceTime = await device.getTime();

    return {
      connected: true,
      ip: process.env.ZK_IP,
      port: Number(process.env.ZK_PORT),
      deviceTime
    };
  } finally {
    try {
      await device.disconnect();
    } catch {
      // La conexión ya estaba cerrada.
    }
  }
};

//obtener los usuarios del reloj

export const getZktecoUsers = async () => {
  const device = createZktecoClient();

  try {
    await device.createSocket();

    const result = await device.getUsers();
    const users = result?.data ?? result;

    if (!Array.isArray(users)) {
      throw new Error('El reloj respondió con un formato de usuarios desconocido');
    }

    return users;
  } finally {
    try {
      await device.disconnect();
    } catch {
      // La conexión ya estaba cerrada.
    }
  }
};

//obtener las checadas del reloj

export const getZktecoAttendances = async () => {
  const device = createZktecoClient();

  try {
    await device.createSocket();

    const result = await device.getAttendances();
    const attendances = result?.data ?? result;

    if (!Array.isArray(attendances)) {
      throw new Error('El reloj respondió con un formato de checadas desconocido');
    }

    return attendances;
  } finally {
    try {
      await device.disconnect();
    } catch {
      // La conexión ya estaba cerrada.
    }
  }
};


// import ZKLib from 'node-zklib';

// const createDevice = () => {
//   return new ZKLib(
//     process.env.ZK_IP,
//     Number(process.env.ZK_PORT),
//     10000,
//     4000,
//     Number(process.env.ZK_COMM_KEY),
//     'tcp'
//   );
// };

// export const getDeviceTime = async () => {
//   const device = createDevice();

//   try {
//     await device.createSocket();
//     return await device.getTime();
//   } finally {
//     await device.disconnect().catch(() => {});
//   }
// };