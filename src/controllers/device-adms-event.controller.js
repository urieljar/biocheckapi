import { Op } from 'sequelize';
import { DeviceAdmsEvent } from '../models/index.js';

export const getAdmsEvents = async (req, res) => {
  const rawLimit = Number(req.query.limit ?? 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;
  const where = {};
  if (req.query.serialNumber) where.serialNumber = String(req.query.serialNumber).trim();
  if (req.query.eventType) where.eventType = String(req.query.eventType).trim().toUpperCase();
  if (req.query.accepted !== undefined) where.accepted = req.query.accepted === 'true';
  if (req.query.since) where.receivedAt = { [Op.gte]: new Date(req.query.since) };

  const rows = await DeviceAdmsEvent.findAll({ where, order: [['receivedAt', 'DESC']], limit });
  res.json({ ok: true, data: rows });
};
