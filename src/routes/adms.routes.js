import { Router } from 'express';

import {
  admsDeviceCommandResult,
  admsGetRequest,
  admsHandshake,
  admsPing
} from '../controllers/adms.controller.js';

const router = Router();

router.get('/cdata', admsHandshake);
router.post('/cdata', admsHandshake);
router.get('/ping', admsPing);
router.post('/ping', admsPing);
router.get('/getrequest', admsGetRequest);
router.post('/devicecmd', admsDeviceCommandResult);

export default router;
