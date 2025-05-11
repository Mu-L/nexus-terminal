import { ref, reactive, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSettingsStore } from '../../stores/settings.store';
import apiClient from '../../utils/apiClient';

// Define necessary types locally if not shared, or import from a shared types file
export type CaptchaProvider = 'hcaptcha' | 'recaptcha' | 'none';

export interface UpdateCaptchaSettingsDto {
    enabled?: boolean;
    provider?: CaptchaProvider;
    hcaptchaSiteKey?: string;
    hcaptchaSecretKey?: string;
    recaptchaSiteKey?: string;
    recaptchaSecretKey?: string;
}

export function useCaptchaSettings() {
    const settingsStore = useSettingsStore();
    const { t } = useI18n();
    const { captchaSettings } = storeToRefs(settingsStore);

    const captchaForm = reactive<UpdateCaptchaSettingsDto>({
        enabled: false,
        provider: 'none',
        hcaptchaSiteKey: '',
        hcaptchaSecretKey: '',
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
    });

    const captchaLoading = ref(false);
    const captchaMessage = ref('');
    const captchaSuccess = ref(false);

    watch(captchaSettings, (newCaptchaSettings) => {
        if (newCaptchaSettings) {
            captchaForm.enabled = newCaptchaSettings.enabled;
            captchaForm.provider = newCaptchaSettings.provider;
            captchaForm.hcaptchaSiteKey = newCaptchaSettings.hcaptchaSiteKey || '';
            // Secret keys are not pre-filled from store for security; form will only send if user inputs a new one
            captchaForm.hcaptchaSecretKey = ''; 
            captchaForm.recaptchaSiteKey = newCaptchaSettings.recaptchaSiteKey || '';
            captchaForm.recaptchaSecretKey = '';
        } else {
            // Reset form if settings are null (e.g., on error or initial load without data)
            captchaForm.enabled = false;
            captchaForm.provider = 'none';
            captchaForm.hcaptchaSiteKey = '';
            captchaForm.hcaptchaSecretKey = '';
            captchaForm.recaptchaSiteKey = '';
            captchaForm.recaptchaSecretKey = '';
        }
    }, { immediate: true, deep: true }); // deep: true might be useful if captchaSettings structure is complex

    const handleUpdateCaptchaSettings = async () => {
        captchaLoading.value = true;
        captchaMessage.value = '';
        captchaSuccess.value = false;
        try {
            let needsVerification = false;
            let providerForVerification: CaptchaProvider | null = null;
            let siteKeyForVerification: string | undefined = undefined;
            let secretKeyForVerification: string | undefined = undefined;

            // Step 1: Determine if verification is needed
            if (captchaForm.enabled && captchaForm.provider && captchaForm.provider !== 'none') {
                const originalSettings = captchaSettings.value; // Persisted settings from store

                if (captchaForm.provider === 'hcaptcha') {
                    const originalSiteKeyValue = originalSettings?.hcaptchaSiteKey || '';
                    const currentSiteKeyValue = captchaForm.hcaptchaSiteKey || '';
                    const currentSecretKeyValue = captchaForm.hcaptchaSecretKey || '';

                    if (currentSiteKeyValue !== originalSiteKeyValue) {
                        if (!currentSiteKeyValue || !currentSecretKeyValue) {
                            throw new Error(t('settings.captcha.error.hcaptchaKeysRequired'));
                        }
                        needsVerification = true;
                        providerForVerification = 'hcaptcha';
                        siteKeyForVerification = currentSiteKeyValue;
                        secretKeyForVerification = currentSecretKeyValue;
                    } else if (currentSecretKeyValue) {
                         if (!currentSiteKeyValue) {
                            throw new Error(t('settings.captcha.error.hcaptchaKeysRequired'));
                        }
                        needsVerification = true;
                        providerForVerification = 'hcaptcha';
                        siteKeyForVerification = currentSiteKeyValue;
                        secretKeyForVerification = currentSecretKeyValue;
                    }
                } else if (captchaForm.provider === 'recaptcha') {
                    const originalSiteKeyValue = originalSettings?.recaptchaSiteKey || '';
                    const currentSiteKeyValue = captchaForm.recaptchaSiteKey || '';
                    const currentSecretKeyValue = captchaForm.recaptchaSecretKey || '';

                    if (currentSiteKeyValue !== originalSiteKeyValue) {
                        if (!currentSiteKeyValue || !currentSecretKeyValue) {
                            throw new Error(t('settings.captcha.error.recaptchaKeysRequired'));
                        }
                        needsVerification = true;
                        providerForVerification = 'recaptcha';
                        siteKeyForVerification = currentSiteKeyValue;
                        secretKeyForVerification = currentSecretKeyValue;
                    } else if (currentSecretKeyValue) {
                        if (!currentSiteKeyValue) {
                            throw new Error(t('settings.captcha.error.recaptchaKeysRequired'));
                        }
                        needsVerification = true;
                        providerForVerification = 'recaptcha';
                        siteKeyForVerification = currentSiteKeyValue;
                        secretKeyForVerification = currentSecretKeyValue;
                    }
                }
            }

            // Step 2: Perform verification if needed
            if (needsVerification && providerForVerification && siteKeyForVerification && secretKeyForVerification) {
                try {
                    await apiClient.post('/settings/captcha/verify', {
                        provider: providerForVerification,
                        siteKey: siteKeyForVerification,
                        secretKey: secretKeyForVerification,
                    });
                } catch (verifyError: any) {
                    console.error('CAPTCHA verification failed:', verifyError);
                    throw new Error(verifyError.response?.data?.message || verifyError.message || t('settings.captcha.error.verificationFailed'));
                }
            }

            // Step 3: Prepare DTO for saving
            const dtoToSave: UpdateCaptchaSettingsDto = {
                enabled: captchaForm.enabled,
                provider: captchaForm.provider,
                hcaptchaSiteKey: captchaForm.hcaptchaSiteKey || undefined,
                recaptchaSiteKey: captchaForm.recaptchaSiteKey || undefined,
                hcaptchaSecretKey: captchaForm.hcaptchaSecretKey || undefined,
                recaptchaSecretKey: captchaForm.recaptchaSecretKey || undefined,
            };

            // Step 4: Call save operation
            await settingsStore.updateCaptchaSettings(dtoToSave);
            captchaMessage.value = t('settings.captcha.success.saved');
            captchaSuccess.value = true;
            // Clear secret key fields from the form after successful save
            captchaForm.hcaptchaSecretKey = '';
            captchaForm.recaptchaSecretKey = '';

        } catch (error: any) {
            captchaMessage.value = error.message || t('settings.captcha.error.saveFailed');
            captchaSuccess.value = false;
        } finally {
            captchaLoading.value = false;
        }
    };

    // Load initial CAPTCHA settings when the composable is used
    // settingsStore.loadCaptchaSettings(); // This is called in SettingsView onMounted, might be redundant here unless SettingsView stops calling it.
                                        // For now, assume SettingsView still handles initial load on its onMounted.

    return {
        captchaForm,
        captchaLoading,
        captchaMessage,
        captchaSuccess,
        handleUpdateCaptchaSettings,
        // Expose captchaSettings from store if needed by the template directly, though form uses captchaForm
        // captchaSettingsStore: captchaSettings 
    };
}