// Una fecha de baja es el último día laboral, inclusive.
export const isEmployedOn = (employee, date) => {
  const periods = employee.employmentPeriods || [];
  if (periods.length) return periods.some((period) => (!period.validFrom || period.validFrom <= date) && (!period.validTo || period.validTo >= date));
  const profile = employee.profile;
  if (profile?.hireDate && date < profile.hireDate) return false;
  if (profile?.terminationDate && date > profile.terminationDate) return false;
  return true; // Fechas históricas desconocidas no se inventan a partir del alta técnica.
};

export const overlapsEmployment = (employee, from, to) => {
  const periods = employee.employmentPeriods || [];
  if (periods.length) return periods.some((period) => (!period.validFrom || period.validFrom <= to) && (!period.validTo || period.validTo >= from));
  return (!employee.profile?.hireDate || employee.profile.hireDate <= to) &&
    (!employee.profile?.terminationDate || employee.profile.terminationDate >= from);
};
