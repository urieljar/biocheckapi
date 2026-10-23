import { Router } from 'express';
import {
  getCatalogItems,
  getCatalogItem,
  createCatalogItem,
  updateCatalogItem,
  deleteCatalogItem
} from '../controllers/catalog.controller.js';

const router = Router();

router.get('/:catalog', getCatalogItems);
router.get('/:catalog/:id', getCatalogItem);
router.post('/:catalog', createCatalogItem);
router.patch('/:catalog/:id', updateCatalogItem);
router.delete('/:catalog/:id', deleteCatalogItem);

export default router;
