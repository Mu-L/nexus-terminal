import express, { Router } from 'express';
import { captchaController } from './captcha.controller';
// import { requireAuth } from '../auth/auth.middleware'; // 假设的认证中间件

const router: Router = express.Router();

// POST /api/v1/settings/captcha/verify (路径将由 index.ts 中的 app.use 指定)
// 如果需要认证，可以在这里添加中间件: router.post('/verify', requireAuth, captchaController.verifyCredentials);
router.post('/verify', captchaController.verifyCredentials);

export default router;