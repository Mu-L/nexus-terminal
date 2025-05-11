
<template>
  <div class="p-4 bg-background text-foreground min-h-screen"> <!-- Outer container -->
    <div class="max-w-7xl mx-auto"> <!-- Inner container for max-width -->
      <h1 class="text-2xl font-semibold text-foreground mb-6 pb-3 border-b border-border"> <!-- Main Title -->
        {{ $t('settings.title') }}
      </h1>

      <!-- Error state (Show first if error exists) -->
      <div v-if="settingsError" class="p-4 mb-4 border-l-4 border-error bg-error/10 text-error rounded">
        {{ settingsError }}
      </div>

      <!-- Settings Sections Grid (Render grid structure always if no error) -->
      <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6"> <!-- Changed to 2 columns on large screens -->
        <!-- Removed global loading state, content will show/hide based on individual loading states -->

          <!-- Column 1: Security -->
          <div class="space-y-6"> <!-- Removed col-span -->
          <!-- Security Sections: Only show if settings data is loaded -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.category.security') }}</h2>
            <div class="p-6 space-y-6">
              <!-- Change Password -->
              <ChangePasswordForm />
              <hr class="border-border/50">
              <!-- Passkey Management -->
              <PasskeyManagement />
              <hr class="border-border/50">
              <!-- 2FA -->
              <TwoFactorAuthSettings />
              <hr class="border-border/50"> <!-- Separator -->
              <!-- CAPTCHA Settings -->
              <CaptchaSettingsForm />
            </div>
          </div>

          <!-- IP Whitelist Section: Only show if settings data is loaded -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.ipWhitelist.title') }}</h2>
            <div class="p-6 space-y-6">
               <IpWhitelistSettings />
            </div>
          </div>

          <!-- IP Blacklist Section: Only show if settings data is loaded (as config depends on it) -->
          <IpBlacklistSettings v-if="settings" />

           <!-- About Section -->
           <AboutSection />
         </div>
 
         <!-- Column 2: Appearance, Workspace, System -->
        <div class="space-y-6"> <!-- Removed col-span -->

          <!-- Workspace Section: Only show if settings data is loaded -->
          <WorkspaceSettingsSection />

          <!-- System Section: Only show if settings data is loaded -->
          <SystemSettingsSection />
          <!-- Data Management Section (including Export) -->
          <DataManagementSection />
          
          <!-- Appearance Section: Only show if settings data is loaded -->
          <AppearanceSection />

        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'; // Simplified Vue imports
import { useAuthStore } from '../stores/auth.store';
import { useSettingsStore } from '../stores/settings.store';
import { useAppearanceStore } from '../stores/appearance.store'; // 导入外观 store
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import ChangePasswordForm from '../components/settings/ChangePasswordForm.vue'; // 导入新组件
import PasskeyManagement from '../components/settings/PasskeyManagement.vue'; // 导入新组件
import TwoFactorAuthSettings from '../components/settings/TwoFactorAuthSettings.vue'; // 导入新组件
import CaptchaSettingsForm from '../components/settings/CaptchaSettingsForm.vue'; // 导入新组件
import IpWhitelistSettings from '../components/settings/IpWhitelistSettings.vue'; // 导入新组件
import IpBlacklistSettings from '../components/settings/IpBlacklistSettings.vue'; // 导入新组件
import AboutSection from '../components/settings/AboutSection.vue'; // 导入新组件
import WorkspaceSettingsSection from '../components/settings/WorkspaceSettingsSection.vue'; // 导入新组件
import SystemSettingsSection from '../components/settings/SystemSettingsSection.vue'; // 导入新组件
import DataManagementSection from '../components/settings/DataManagementSection.vue'; // 导入新组件
import AppearanceSection from '../components/settings/AppearanceSection.vue'; // 导入新组件

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const appearanceStore = useAppearanceStore(); // 实例化外观 store
const { t } = useI18n();

// --- Reactive state from store ---
// 使用 storeToRefs 获取响应式 getter，包括 language
const {
    settings,
    isLoading: settingsLoading,
    error: settingsError,
    language: storeLanguage,
    captchaSettings, // <-- Import CAPTCHA settings state
} = storeToRefs(settingsStore);



onMounted(async () => {
  // await fetchIpBlacklist(); // REMOVED - Handled by useIpBlacklist.ts onMounted
  await settingsStore.loadCaptchaSettings(); // <-- Load CAPTCHA settings
});

</script>

<style scoped>
/* Remove all scoped styles as they are now handled by Tailwind utility classes */
</style>

