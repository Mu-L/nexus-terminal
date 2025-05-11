import { Request, Response } from 'express';
import { captchaService } from '../services/captcha.service';

interface VerifyCaptchaCredentialsBody {
    provider: 'hcaptcha' | 'recaptcha';
    siteKey?: string;
    secretKey?: string;
}

export class CaptchaController {
    async verifyCredentials(
        request: Request<{}, {}, VerifyCaptchaCredentialsBody>, // Express Request type
        reply: Response // Express Response type
    ): Promise<void> {
        const { provider, siteKey, secretKey } = request.body;

        if (!provider || (provider !== 'hcaptcha' && provider !== 'recaptcha')) {
            reply.status(400).json({ message: '无效的 CAPTCHA 提供商。' }); // Use .json for Express
            return;
        }

        if (!siteKey || !secretKey) {
            let missingKeyMessage = `缺少 ${provider} 的 Site Key 或 Secret Key。`;
            if (!siteKey && !secretKey) {
                missingKeyMessage = `缺少 ${provider} 的 Site Key 和 Secret Key。`;
            } else if (!siteKey) {
                missingKeyMessage = `缺少 ${provider} 的 Site Key。`;
            } else if (!secretKey) {
                missingKeyMessage = `缺少 ${provider} 的 Secret Key。`;
            }
            reply.status(400).json({ message: missingKeyMessage }); // Use .json
            return;
        }

        try {
            const isValid = await captchaService.verifyCredentials(provider, siteKey, secretKey);
            if (isValid) {
                reply.status(200).json({ message: 'CAPTCHA 凭据验证成功。' }); // Use .json
            } else {
                reply.status(400).json({ message: 'CAPTCHA 凭据验证失败。请检查您的 Site Key 和 Secret Key 是否正确，并确保服务器可以访问 CAPTCHA 服务提供商。' }); // Use .json
            }
        } catch (error: any) {
            console.error(`[CaptchaController] 凭据验证时发生意外错误: ${error.message}`);
            reply.status(500).json({ message: error.message || 'CAPTCHA 凭据验证时发生服务器内部错误。' }); // Use .json
        }
    }
}

export const captchaController = new CaptchaController();