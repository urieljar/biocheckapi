import { isEmployedOn, overlapsEmployment } from './employment-period.service.js';
import { EmploymentPeriod } from '../models/index.js';
import { Op } from 'sequelize';
import {
  Attendance,
  Employee,
  EmployeeProfile,
  EmployeeSchedule,
  CalendarException,
  Department,
  Area,
  WorkSchedule,
  ScheduleDay,
  Position
} from '../models/index.js';

const TIME_ZONE = 'America/Mazatlan';
const DAY_MS = 24 * 60 * 60 * 1000;

const localDateParts = (date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(date));

  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
};

const dateKey = (date) => {
  const parts = localDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const dayOfWeek = (dateString) => new Date(`${dateString}T12:00:00Z`).getUTCDay();

const addDays = (dateString, amount) => {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const dayStart = (dateString) => new Date(`${dateString}T00:00:00-07:00`);
const dayEnd = (dateString) => new Date(`${dateString}T23:59:59.999-07:00`);

const minutesBetweenTimes = (from, to) => {
  if (!from || !to) return null;
  const parse = (value) => {
    const [hours, minutes, seconds = 0] = value.split(':').map(Number);
    return hours * 60 + minutes + seconds / 60;
  };
  let result = parse(to) - parse(from);
  if (result < 0) result += 1440;
  return result;
};

const signedMinutesBetweenTimes = (from, to) => {
  if (!from || !to) return null;
  const parse = (value) => {
    const [hours, minutes, seconds = 0] = value.split(':').map(Number);
    return hours * 60 + minutes + seconds / 60;
  };
  return parse(to) - parse(from);
};

// Filtra checadas duplicadas o accidentales realizadas con menos de minGapSeconds (default 60s) de diferencia
const deduplicatePunches = (punches, minGapSeconds = 60) => {
  if (!punches || punches.length <= 1) return punches || [];
  const sorted = [...punches].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const clean = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(clean[clean.length - 1]).getTime();
    const curr = new Date(sorted[i]).getTime();
    if ((curr - prev) / 1000 >= minGapSeconds) {
      clean.push(sorted[i]);
    }
  }
  return clean;
};

// Calcula los minutos trabajados de forma inteligente evitando desfasar horas por checadas intermedias
const calculateWorkedMinutes = (cleanPunches) => {
  if (!cleanPunches || cleanPunches.length < 2) return 0;
  // Si son 4 checadas con un receso claro de comida (entre 15 y 180 min):
  if (cleanPunches.length === 4) {
    const p0 = new Date(cleanPunches[0]).getTime();
    const p1 = new Date(cleanPunches[1]).getTime();
    const p2 = new Date(cleanPunches[2]).getTime();
    const p3 = new Date(cleanPunches[3]).getTime();
    const shift1 = (p1 - p0) / 60000;
    const shift2 = (p3 - p2) / 60000;
    const lunchBreak = (p2 - p1) / 60000;
    if (lunchBreak >= 15 && lunchBreak <= 180 && shift1 >= 30 && shift2 >= 30) {
      return Math.round(shift1 + shift2);
    }
  }
  // Para jornadas continuas o cuando hay múltiples checadas: tiempo entre primera entrada y última salida
  const first = new Date(cleanPunches[0]).getTime();
  const last = new Date(cleanPunches[cleanPunches.length - 1]).getTime();
  return Math.round((last - first) / 60000);
};

const localTime = (date) => new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
}).format(new Date(date));

const findException = (exceptions, employee) => {
  const profile = employee.profile;
  const priorities = [
    (item) => item.scope === 'EMPLOYEE' && item.employeeId === employee.id,
    (item) => item.scope === 'AREA' && item.areaId === profile?.areaId,
    (item) => item.scope === 'DEPARTMENT' && item.departmentId === profile?.departmentId,
    (item) => item.scope === 'GLOBAL'
  ];

  for (const match of priorities) {
    const selected = exceptions.find(match);
    if (selected) return selected;
  }

  return null;
};

const calculateDay = ({ date, employee, assignment, exceptions, punches, punchDetails = [] }) => {
  const exception = findException(exceptions, employee);
  const cleanPunches = deduplicatePunches(punches, 60);
  const worked = calculateWorkedMinutes(cleanPunches);
  const hasPunches = cleanPunches.length > 0;
  const first = hasPunches ? localTime(cleanPunches[0]) : null;
  const last = cleanPunches.length >= 2 ? localTime(cleanPunches[cleanPunches.length - 1]) : null;

  if (exception && !exception.isWorkDay) {
    const scheduleDay = assignment?.schedule?.days?.find(
      (day) => day.dayOfWeek === dayOfWeek(date)
    );
    const rule = scheduleDay?.isWorkDay
      ? {
          dayType: scheduleDay.dayType || assignment.schedule.type,
          entryTime: scheduleDay.entryTime,
          exitTime: scheduleDay.exitTime,
          workMinutes: scheduleDay.workMinutes || assignment.schedule.workMinutes
        }
      : null;

    return {
      date,
      status: 'EXCUSED',
      statuses: ['EXCUSED'],
      reason: exception.type,
      exception: typeof exception.toJSON === 'function' ? exception.toJSON() : exception,
      rule,
      firstEntry: first,
      lastExit: last,
      punches: cleanPunches.map(localTime),
      punchDetails,
      workedMinutes: worked
    };
  }

  const scheduleDay = assignment?.schedule?.days?.find(
    (day) => day.dayOfWeek === dayOfWeek(date)
  );

  if (!assignment) {
    if (hasPunches) {
      return {
        date,
        status: 'PRESENT',
        statuses: ['PRESENT'],
        reason: 'NO_SCHEDULE',
        exception: exception ? (typeof exception.toJSON === 'function' ? exception.toJSON() : exception) : null,
        rule: null,
        firstEntry: first,
        lastExit: last,
        punches: cleanPunches.map(localTime),
        punchDetails,
        workedMinutes: worked
      };
    }
    return {
      date,
      status: 'REST',
      statuses: ['REST'],
      reason: 'NO_SCHEDULE',
      exception: exception ? (typeof exception.toJSON === 'function' ? exception.toJSON() : exception) : null,
      rule: null,
      firstEntry: null,
      lastExit: null,
      punches: [],
      punchDetails: [],
      workedMinutes: 0
    };
  }

  if (!scheduleDay || !scheduleDay.isWorkDay) {
    return {
      date,
      status: 'REST',
      statuses: ['REST'],
      reason: 'SCHEDULE_REST',
      exception: exception ? (typeof exception.toJSON === 'function' ? exception.toJSON() : exception) : null,
      rule: null,
      firstEntry: first,
      lastExit: last,
      punches: cleanPunches.map(localTime),
      punchDetails,
      workedMinutes: worked
    };
  }

  const rule = {
    dayType: scheduleDay.dayType || assignment.schedule.type,
    entryTime: scheduleDay.entryTime,
    exitTime: scheduleDay.exitTime,
    workMinutes: scheduleDay.workMinutes || assignment.schedule.workMinutes
  };

  if (exception) {
    rule.entryTime = exception.entryTime || rule.entryTime;
    rule.exitTime = exception.exitTime || rule.exitTime;
    rule.workMinutes = exception.workMinutes || rule.workMinutes;
  }

  if (cleanPunches.length === 0) {
    return {
      date,
      status: 'ABSENT',
      statuses: ['ABSENT'],
      reason: exception?.type || 'NO_PUNCHES',
      exception: exception ? (typeof exception.toJSON === 'function' ? exception.toJSON() : exception) : null,
      rule,
      punches: [],
      punchDetails: [],
      workedMinutes: 0
    };
  }

  const statuses = [];

  if (rule.dayType === 'FLEXIBLE') {
    if (cleanPunches.length < 2) statuses.push('INCOMPLETE');
    if (rule.workMinutes && worked < rule.workMinutes) statuses.push('INCOMPLETE');
    if (!statuses.length) statuses.push('PRESENT');
  } else {
    const tolerance = assignment.schedule.toleranceMinutes || 0;
    if (rule.entryTime && signedMinutesBetweenTimes(rule.entryTime, first) > tolerance) {
      statuses.push('LATE');
    }
    // Si solo hay 1 checada: Falta salida (Incompleto)
    if (cleanPunches.length < 2) {
      statuses.push('INCOMPLETE');
    } else {
      // Si hay 2 o más checadas, evaluamos si salió antes de tiempo oficial
      if (rule.exitTime && signedMinutesBetweenTimes(last, rule.exitTime) > tolerance) {
        statuses.push('EARLY_DEPARTURE');
      }
    }
    if (!statuses.length) {
      statuses.push('PRESENT');
    }
  }

  return {
    date,
    status: statuses[0] || 'PRESENT',
    statuses: statuses.length ? statuses : ['PRESENT'],
    exception: exception ? (typeof exception.toJSON === 'function' ? exception.toJSON() : exception) : null,
    rule,
    firstEntry: first,
    lastExit: last,
    punches: cleanPunches.map(localTime),
    punchDetails,
    workedMinutes: worked
  };
};

export const calculateEmployeeAttendance = async ({ employeeId, from, to }) => {
  const employee = await Employee.findByPk(employeeId, {
    include: [{
      model: EmployeeProfile,
      as: 'profile',
      attributes: ['id', 'employeeId', 'departmentId', 'areaId', 'hireDate', 'terminationDate'],
      include: [
        { model: Department, as: 'department', attributes: ['id', 'name'] },
        { model: Area, as: 'area', attributes: ['id', 'name'] }
      ]
    }, { model: EmploymentPeriod, as: 'employmentPeriods' }]
  });

  if (!employee) throw Object.assign(new Error('Empleado no encontrado'), { statusCode: 404 });

  const assignments = await EmployeeSchedule.findAll({
    where: {
      employeeId,
      active: true,
      validFrom: { [Op.lte]: to },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: from } }]
    },
    include: [{
      model: WorkSchedule,
      as: 'schedule',
      include: [{ model: ScheduleDay, as: 'days' }]
    }],
    order: [['validFrom', 'DESC']]
  });

  const attendanceRows = await Attendance.findAll({
    where: {
      employeeId,
      recordTime: { [Op.between]: [dayStart(from), dayEnd(to)] }
    },
    order: [['recordTime', 'ASC']]
  });

  const exceptions = await CalendarException.findAll({
    where: {
      date: { [Op.between]: [from, to] },
      active: true,
      [Op.or]: [
        { scope: 'GLOBAL' },
        { scope: 'EMPLOYEE', employeeId },
        { scope: 'AREA', areaId: employee.profile?.areaId || null },
        { scope: 'DEPARTMENT', departmentId: employee.profile?.departmentId || null }
      ]
    }
  });

  const result = [];
  for (let current = from; current <= to; current = addDays(current, 1)) {
    if (!isEmployedOn(employee, current)) continue;
    const assignment = assignments.find((item) => {
      const starts = item.validFrom <= current;
      const ends = !item.validTo || item.validTo >= current;
      return starts && ends;
    });
    const dayPunchRows = attendanceRows
      .filter((row) => dateKey(row.recordTime) === current);
    const dayPunches = dayPunchRows.map((row) => row.recordTime);
    const dayPunchDetails = dayPunchRows.map((row) => ({
      id: row.id,
      time: localTime(row.recordTime),
      recordTime: row.recordTime,
      source: row.source || 'DEVICE'
    }));
    const dayExceptions = exceptions.filter((item) => item.date === current);

    result.push(calculateDay({
      date: current,
      employee,
      assignment,
      exceptions: dayExceptions,
      punches: dayPunches,
      punchDetails: dayPunchDetails
    }));
  }

  const workedMin = result.reduce((acc, curr) => acc + (curr.workedMinutes || 0), 0);

  return {
    employee: {
      id: employee.id,
      deviceUserId: employee.deviceUserId,
      name: employee.name,
      department: employee.profile?.department ? {
        id: employee.profile.department.id,
        code: employee.profile.department.code,
        name: employee.profile.department.name
      } : null,
      area: employee.profile?.area ? {
        id: employee.profile.area.id,
        code: employee.profile.area.code,
        name: employee.profile.area.name
      } : null,
      position: employee.profile?.position ? {
        id: employee.profile.position.id,
        code: employee.profile.position.code,
        name: employee.profile.position.name
      } : null
    },
    from,
    to,
    timeZone: TIME_ZONE,
    summary: {
      totalDays: result.length,
      present: result.filter((day) => day.status === 'PRESENT').length,
      absent: result.filter((day) => day.status === 'ABSENT').length,
      excused: result.filter((day) => day.status === 'EXCUSED').length,
      rest: result.filter((day) => day.status === 'REST').length,
      late: result.filter((day) => day.statuses?.includes('LATE')).length,
      earlyDeparture: result.filter((day) => day.statuses?.includes('EARLY_DEPARTURE')).length,
      incomplete: result.filter((day) => day.statuses?.includes('INCOMPLETE')).length,
      workedMinutes: workedMin,
      workedHoursFormatted: `${Math.floor(workedMin / 60)}h ${Math.round(workedMin % 60)}m`
    },
    days: result
  };
};

export const calculateBatchAttendance = async ({ from, to, departmentId }) => {
  const profileInclude = {
    model: EmployeeProfile,
    as: 'profile',
    attributes: ['id', 'employeeId', 'departmentId', 'areaId', 'positionId', 'hireDate', 'terminationDate'],
    include: [
      { model: Department, as: 'department', attributes: ['id', 'code', 'name'] },
      { model: Area, as: 'area', attributes: ['id', 'code', 'name'] },
      { model: Position, as: 'position', attributes: ['id', 'code', 'name'] }
    ]
  };

  if (departmentId) {
    profileInclude.where = { departmentId };
    profileInclude.required = true;
  }

  const employees = (await Employee.findAll({
    include: [profileInclude, { model: EmploymentPeriod, as: 'employmentPeriods' }],
    order: [['name', 'ASC']]
  })).filter((employee) => overlapsEmployment(employee, from, to));

  let department = null;
  if (departmentId) {
    department = await Department.findByPk(departmentId, {
      attributes: ['id', 'code', 'name']
    });
  }

  const employeeIds = employees.map((e) => e.id);

  if (employeeIds.length === 0) {
    return {
      from,
      to,
      timeZone: TIME_ZONE,
      scope: departmentId ? 'DEPARTMENT' : 'ALL',
      department,
      totalEmployees: 0,
      companySummary: {
        totalEmployees: 0,
        totalDaysEvaluated: 0,
        present: 0,
        absent: 0,
        late: 0,
        earlyDeparture: 0,
        incomplete: 0,
        excused: 0,
        rest: 0,
        totalWorkedMinutes: 0,
        totalWorkedHoursFormatted: '0h 0m'
      },
      employees: []
    };
  }

  const assignments = await EmployeeSchedule.findAll({
    where: {
      employeeId: { [Op.in]: employeeIds },
      active: true,
      validFrom: { [Op.lte]: to },
      [Op.or]: [{ validTo: null }, { validTo: { [Op.gte]: from } }]
    },
    include: [{
      model: WorkSchedule,
      as: 'schedule',
      include: [{ model: ScheduleDay, as: 'days' }]
    }],
    order: [['validFrom', 'DESC']]
  });

  const assignmentsByEmployee = new Map();
  for (const asg of assignments) {
    if (!assignmentsByEmployee.has(asg.employeeId)) {
      assignmentsByEmployee.set(asg.employeeId, []);
    }
    assignmentsByEmployee.get(asg.employeeId).push(asg);
  }

  const attendanceRows = await Attendance.findAll({
    where: {
      employeeId: { [Op.in]: employeeIds },
      recordTime: { [Op.between]: [dayStart(from), dayEnd(to)] }
    },
    order: [['recordTime', 'ASC']]
  });

  const punchesByEmployeeAndDate = new Map();
  for (const row of attendanceRows) {
    const key = `${row.employeeId}_${dateKey(row.recordTime)}`;
    if (!punchesByEmployeeAndDate.has(key)) {
      punchesByEmployeeAndDate.set(key, []);
    }
    punchesByEmployeeAndDate.get(key).push(row);
  }

  const exceptions = await CalendarException.findAll({
    where: {
      date: { [Op.between]: [from, to] },
      active: true
    }
  });

  const exceptionsByDate = new Map();
  for (const exc of exceptions) {
    if (!exceptionsByDate.has(exc.date)) {
      exceptionsByDate.set(exc.date, []);
    }
    exceptionsByDate.get(exc.date).push(exc);
  }

  const employeeResults = [];

  for (const emp of employees) {
    const empAssignments = assignmentsByEmployee.get(emp.id) || [];
    const days = [];

    for (let current = from; current <= to; current = addDays(current, 1)) {
      if (!isEmployedOn(emp, current)) continue;
      const assignment = empAssignments.find((item) => {
        const starts = item.validFrom <= current;
        const ends = !item.validTo || item.validTo >= current;
        return starts && ends;
      });
      const dayPunchRows = punchesByEmployeeAndDate.get(`${emp.id}_${current}`) || [];
      const dayPunches = dayPunchRows.map((r) => r.recordTime);
      const dayPunchDetails = dayPunchRows.map((r) => ({
        id: r.id,
        time: localTime(r.recordTime),
        recordTime: r.recordTime,
        source: r.source || 'DEVICE'
      }));
      const dayExceptions = exceptionsByDate.get(current) || [];

      days.push(calculateDay({
        date: current,
        employee: emp,
        assignment,
        exceptions: dayExceptions,
        punches: dayPunches,
        punchDetails: dayPunchDetails
      }));
    }

    const workedMin = days.reduce((acc, curr) => acc + (curr.workedMinutes || 0), 0);

    const empSummary = {
      totalDays: days.length,
      present: days.filter((d) => d.status === 'PRESENT').length,
      absent: days.filter((d) => d.status === 'ABSENT').length,
      excused: days.filter((d) => d.status === 'EXCUSED').length,
      rest: days.filter((d) => d.status === 'REST').length,
      late: days.filter((d) => d.statuses?.includes('LATE')).length,
      earlyDeparture: days.filter((d) => d.statuses?.includes('EARLY_DEPARTURE')).length,
      incomplete: days.filter((d) => d.statuses?.includes('INCOMPLETE')).length,
      workedMinutes: workedMin,
      workedHoursFormatted: `${Math.floor(workedMin / 60)}h ${Math.round(workedMin % 60)}m`
    };

    employeeResults.push({
      employee: {
        id: emp.id,
        deviceUserId: emp.deviceUserId,
        name: emp.name,
        department: emp.profile?.department ? {
          id: emp.profile.department.id,
          code: emp.profile.department.code,
          name: emp.profile.department.name
        } : null,
        area: emp.profile?.area ? {
          id: emp.profile.area.id,
          code: emp.profile.area.code,
          name: emp.profile.area.name
        } : null,
        position: emp.profile?.position ? {
          id: emp.profile.position.id,
          code: emp.profile.position.code,
          name: emp.profile.position.name
        } : null
      },
      summary: empSummary,
      days
    });
  }

  const totalWorked = employeeResults.reduce((acc, e) => acc + e.summary.workedMinutes, 0);

  const companySummary = {
    totalEmployees: employeeResults.length,
    totalDaysEvaluated: employeeResults.reduce((acc, e) => acc + e.summary.totalDays, 0),
    present: employeeResults.reduce((acc, e) => acc + e.summary.present, 0),
    absent: employeeResults.reduce((acc, e) => acc + e.summary.absent, 0),
    late: employeeResults.reduce((acc, e) => acc + e.summary.late, 0),
    earlyDeparture: employeeResults.reduce((acc, e) => acc + e.summary.earlyDeparture, 0),
    incomplete: employeeResults.reduce((acc, e) => acc + e.summary.incomplete, 0),
    excused: employeeResults.reduce((acc, e) => acc + e.summary.excused, 0),
    rest: employeeResults.reduce((acc, e) => acc + e.summary.rest, 0),
    totalWorkedMinutes: totalWorked,
    totalWorkedHoursFormatted: `${Math.floor(totalWorked / 60)}h ${Math.round(totalWorked % 60)}m`
  };

  return {
    from,
    to,
    timeZone: TIME_ZONE,
    scope: departmentId ? 'DEPARTMENT' : 'ALL',
    department,
    totalEmployees: employeeResults.length,
    companySummary,
    employees: employeeResults
  };
};
