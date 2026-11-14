export const validateEmploymentProfile = (changes, current = {}) => {
  const data = { ...current, ...changes };
  for (const field of ['hireDate', 'birthDate', 'terminationDate']) {
    const value = data[field];
    if (value == null) continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${field} debe usar YYYY-MM-DD`;
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return `${field} no es una fecha válida`;
  }
  if (data.employmentStatus != null && !['ACTIVE', 'TERMINATED'].includes(data.employmentStatus)) return 'Estado laboral inválido';
  if (data.terminationDate && data.hireDate && data.terminationDate < data.hireDate) return 'La baja no puede ser anterior al ingreso';
  if (data.employmentStatus === 'TERMINATED' && (!data.terminationDate || !data.terminationReason)) return 'Registra fecha y motivo de baja';
  if (data.employmentStatus !== 'TERMINATED' && (data.terminationDate || data.terminationReason)) return 'Los datos de baja requieren estado laboral Baja';
  return null;
};
