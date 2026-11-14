import { Router } from 'express';
import {
  getCatalogItems,
  getCatalogItem,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem
} from '../controllers/catalog.controller.js';
import { requireCapability } from '../middlewares/auth.middleware.js';

const router = Router();

// Los catálogos (departamentos, áreas, puestos) se consultan con cualquier rol.
router.get('/:catalog', getCatalogItems);
router.get('/:catalog/:id', getCatalogItem);
router.post('/:catalog', requireCapability('catalog.write'), createCatalogItem);
router.patch('/:catalog/:id', requireCapability('catalog.write'), updateCatalogItem);
router.delete('/:catalog/:id', requireCapability('catalog.write'), deleteCatalogItem);

export default router;
