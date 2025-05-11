
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
              <div class="settings-section-content">
                <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.changePassword.title') }}</h3>
                <form @submit.prevent="handleChangePassword" class="space-y-4">
                  <div>
                    <label for="currentPassword" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.changePassword.currentPassword') }}</label>
                    <input type="password" id="currentPassword" v-model="currentPassword" required
                           class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                  </div>
                  <div>
                    <label for="newPassword" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.changePassword.newPassword') }}</label>
                    <input type="password" id="newPassword" v-model="newPassword" required
                           class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                  </div>
                  <div>
                    <label for="confirmPassword" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.changePassword.confirmPassword') }}</label>
                    <input type="password" id="confirmPassword" v-model="confirmPassword" required
                           class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                  </div>
                  <div class="flex items-center justify-between">
                    <button type="submit" :disabled="changePasswordLoading"
                            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                      {{ changePasswordLoading ? $t('common.loading') : $t('settings.changePassword.submit') }}
                    </button>
                    <p v-if="changePasswordMessage" :class="['text-sm', changePasswordSuccess ? 'text-success' : 'text-error']">{{ changePasswordMessage }}</p>
                  </div>
                </form>
              </div>
              <hr class="border-border/50">
              <!-- Passkey Management -->
              <div class="settings-section-content">
                <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.passkey.title') }}</h3>
                <p class="text-sm text-text-secondary mb-4">{{ $t('settings.passkey.description') }}</p>
                <button @click="handleRegisterNewPasskey" :disabled="passkeyLoading"
                        class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                  {{ passkeyLoading ? $t('common.loading') : $t('settings.passkey.registerNewButton') }}
                </button>
                <p v-if="passkeyMessage" :class="['mt-3 text-sm', passkeySuccess ? 'text-success' : 'text-error']">{{ passkeyMessage }}</p>

                <!-- Display list of registered passkeys -->
                <div class="mt-6">
                  <h4 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.passkey.registeredKeysTitle') }}</h4>
                  <div v-if="authStorePasskeysLoading" class="p-4 text-center text-text-secondary italic">
                    {{ $t('common.loading') }}
                  </div>
                  <div v-else-if="passkeys && passkeys.length > 0">
                    <ul class="space-y-3">
                      <li v-for="key in passkeys" :key="key.credentialID" class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 border border-border rounded-md bg-header/20 hover:bg-header/40 transition-colors duration-150">
                        <div class="flex-grow mb-2 sm:mb-0">
                          <div class="flex items-center">
                            <span v-if="!editingPasskeyId || editingPasskeyId !== key.credentialID" class="block font-medium text-foreground text-sm">
                              {{ key.name || $t('settings.passkey.unnamedKey') }}
                              <span class="text-xs text-text-tertiary ml-1">(ID: ...{{ typeof key.credentialID === 'string' && key.credentialID ? key.credentialID.slice(-8) : 'N/A' }})</span>
                            </span>
                            <div v-else class="flex items-center flex-grow">
                              <input type="text" v-model="editingPasskeyName" @keyup.enter="savePasskeyName(key.credentialID)" @keyup.esc="cancelEditPasskeyName" class="w-48 px-2 py-1 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm" :placeholder="$t('settings.passkey.enterNamePlaceholder', '输入 Passkey 名称')" />
                              <button @click="savePasskeyName(key.credentialID)" :disabled="passkeyEditLoadingStates[key.credentialID]" class="ml-2 px-2 py-1 bg-success text-success-text rounded-md text-xs font-medium hover:bg-success/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out">
                                {{ passkeyEditLoadingStates[key.credentialID] ? $t('common.saving') : $t('common.save') }}
                              </button>
                              <button @click="cancelEditPasskeyName" :disabled="passkeyEditLoadingStates[key.credentialID]" class="ml-1 px-2 py-1 bg-transparent text-text-secondary border border-border rounded-md text-xs font-medium hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out">
                                {{ $t('common.cancel') }}
                              </button>
                            </div>
                            <button v-if="!editingPasskeyId || editingPasskeyId !== key.credentialID" @click="startEditPasskeyName(key.credentialID, key.name || '')" class="ml-2 p-1 text-text-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out" :title="$t('settings.passkey.editNameTooltip', '编辑名称')">
                              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" class="bi bi-pencil-square">
                                <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>
                                <path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/>
                              </svg>
                            </button>
                          </div>
                          <div class="text-xs text-text-secondary mt-1 space-x-2">
                            <span>{{ $t('settings.passkey.createdDate') }}: {{ formatDate(key.creationDate) }}</span>
                            <span v-if="key.lastUsedDate">{{ $t('settings.passkey.lastUsedDate') }}: {{ formatDate(key.lastUsedDate) }}</span>
                            <span v-if="key.transports && key.transports.length > 0" class="capitalize">({{ key.transports.join(', ') }})</span>
                          </div>
                        </div>
                        <button @click="handleDeletePasskey(key.credentialID)"
                                :disabled="passkeyDeleteLoadingStates[key.credentialID] || (editingPasskeyId === key.credentialID)"
                                class="px-3 py-1.5 bg-error text-error-text rounded-md text-xs font-medium hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out self-start sm:self-center">
                          {{ passkeyDeleteLoadingStates[key.credentialID] ? $t('common.loading') : $t('common.delete') }}
                        </button>
                      </li>
                    </ul>
                  </div>
                  <p v-else class="text-sm text-text-secondary italic">{{ $t('settings.passkey.noKeysRegistered') }}</p>
                  <p v-if="passkeyDeleteError" class="mt-3 text-sm text-error">{{ passkeyDeleteError }}</p>
                </div>
              </div>
              <hr class="border-border/50">
              <!-- 2FA -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.twoFactor.title') }}</h3>
                 <div v-if="twoFactorEnabled">
                   <p class="p-3 mb-3 border-l-4 border-success bg-success/10 text-success text-sm rounded">{{ $t('settings.twoFactor.status.enabled') }}</p>
                   <form @submit.prevent="handleDisable2FA" class="space-y-4">
                     <div>
                       <label for="disablePassword" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.twoFactor.disable.passwordPrompt') }}</label>
                       <input type="password" id="disablePassword" v-model="disablePassword" required
                              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                     </div>
                     <div class="flex items-center justify-between">
                        <button type="submit" :disabled="twoFactorLoading"
                                class="px-4 py-2 bg-error text-error-text rounded-md shadow-sm hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                          {{ twoFactorLoading ? $t('common.loading') : $t('settings.twoFactor.disable.button') }}
                        </button>
                     </div>
                   </form>
                 </div>
                 <div v-else>
                   <p class="text-sm text-text-secondary mb-4">{{ $t('settings.twoFactor.status.disabled') }}</p>
                   <button v-if="!isSettingUp2FA" @click="handleSetup2FA" :disabled="twoFactorLoading"
                           class="px-4 py-2 bg-success text-success-text rounded-md shadow-sm hover:bg-success/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                     {{ twoFactorLoading ? $t('common.loading') : $t('settings.twoFactor.enable.button') }}
                   </button>
                   <div v-if="isSettingUp2FA && setupData" class="mt-4 space-y-4 p-4 border border-border rounded-md bg-header/30">
                     <p class="text-sm text-text-secondary">{{ $t('settings.twoFactor.setup.scanQrCode') }}</p>
                     <img :src="setupData.qrCodeUrl" alt="QR Code" class="block mx-auto max-w-[180px] border border-border p-1 bg-white rounded">
                     <p class="text-sm text-text-secondary">{{ $t('settings.twoFactor.setup.orEnterSecret') }} <code class="bg-header/50 p-1 px-2 border border-border/50 rounded font-mono text-sm">{{ setupData.secret }}</code></p>
                     <form @submit.prevent="handleVerifyAndActivate2FA" class="space-y-4">
                       <div>
                         <label for="verificationCode" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.twoFactor.setup.enterCode') }}</label>
                         <input type="text" id="verificationCode" v-model="verificationCode" required pattern="\d{6}" title="请输入 6 位数字验证码"
                                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                       </div>
                       <div class="flex items-center space-x-3">
                         <button type="submit" :disabled="twoFactorLoading"
                                 class="px-4 py-2 bg-success text-success-text rounded-md shadow-sm hover:bg-success/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-success disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                           {{ twoFactorLoading ? $t('common.loading') : $t('settings.twoFactor.setup.verifyButton') }}
                         </button>
                         <button type="button" @click="cancelSetup" :disabled="twoFactorLoading"
                                 class="px-4 py-2 bg-transparent text-text-secondary border border-border rounded-md shadow-sm hover:bg-border hover:text-foreground focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                           {{ $t('common.cancel') }}
                         </button>
                       </div>
                     </form>
                   </div>
                 </div>
                 <p v-if="twoFactorMessage" :class="['mt-3 text-sm', twoFactorSuccess ? 'text-success' : 'text-error']">{{ twoFactorMessage }}</p>
              </div>
              <hr class="border-border/50"> <!-- Separator -->
              <!-- CAPTCHA Settings -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.captcha.title') }}</h3>
                 <p class="text-sm text-text-secondary mb-4">{{ $t('settings.captcha.description') }}</p>
                 <div v-if="!captchaSettings" class="p-4 text-center text-text-secondary italic">
                    {{ $t('common.loading') }}
                 </div>
                 <form v-else @submit.prevent="handleUpdateCaptchaSettings" class="space-y-4">
                    <!-- Enable Switch -->
                    <div class="flex items-center">
                        <input type="checkbox" id="captchaEnabled" v-model="captchaForm.enabled"
                               class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                        <label for="captchaEnabled" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.captcha.enableLabel') }}</label>
                    </div>

                    <!-- Provider Select (Only show if enabled) -->
                    <div v-if="captchaForm.enabled">
                      <label for="captchaProvider" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.captcha.providerLabel') }}</label>
                      <select id="captchaProvider" v-model="captchaForm.provider"
                              class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
                              style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-size: 16px 12px;">
                        <option value="none">{{ $t('settings.captcha.providerNone') }}</option>
                        <option value="hcaptcha">hCaptcha</option>
                        <option value="recaptcha">Google reCAPTCHA v2</option>
                      </select>
                    </div>

                    <!-- hCaptcha Settings (Only show if enabled and provider is hcaptcha) -->
                    <div v-if="captchaForm.enabled && captchaForm.provider === 'hcaptcha'" class="space-y-4 pl-4 border-l-2 border-border/50 ml-1 pt-2">
                       <p class="text-xs text-text-secondary">{{ $t('settings.captcha.hcaptchaHint') }} <a href="https://www.hcaptcha.com/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">hCaptcha.com</a></p>
                       <div>
                         <label for="hcaptchaSiteKey" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.captcha.siteKeyLabel') }}</label>
                         <input type="text" id="hcaptchaSiteKey" v-model="captchaForm.hcaptchaSiteKey"
                                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                       </div>
                       <div>
                         <label for="hcaptchaSecretKey" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.captcha.secretKeyLabel') }}</label>
                         <input type="password" id="hcaptchaSecretKey" v-model="captchaForm.hcaptchaSecretKey" placeholder="••••••••••••" autocomplete="new-password"
                                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                         <small class="block mt-1 text-xs text-text-secondary">{{ $t('settings.captcha.secretKeyHint') }}</small>
                       </div>
                    </div>

                    <!-- reCAPTCHA Settings (Only show if enabled and provider is recaptcha) -->
                    <div v-if="captchaForm.enabled && captchaForm.provider === 'recaptcha'" class="space-y-4 pl-4 border-l-2 border-border/50 ml-1 pt-2">
                       <p class="text-xs text-text-secondary">{{ $t('settings.captcha.recaptchaHint') }} <a href="https://www.google.com/recaptcha/" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">Google reCAPTCHA</a></p>
                       <div>
                         <label for="recaptchaSiteKey" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.captcha.siteKeyLabel') }}</label>
                         <input type="text" id="recaptchaSiteKey" v-model="captchaForm.recaptchaSiteKey"
                                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                       </div>
                       <div>
                         <label for="recaptchaSecretKey" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.captcha.secretKeyLabel') }}</label>
                         <input type="password" id="recaptchaSecretKey" v-model="captchaForm.recaptchaSecretKey" placeholder="••••••••••••" autocomplete="new-password"
                                class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                         <small class="block mt-1 text-xs text-text-secondary">{{ $t('settings.captcha.secretKeyHint') }}</small>
                       </div>
                    </div>

                    <!-- Save Button & Message -->
                    <div class="flex items-center justify-between pt-2">
                       <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                         {{ $t('settings.captcha.saveButton') }}
                       </button>
                       <p v-if="captchaMessage" :class="['text-sm', captchaSuccess ? 'text-success' : 'text-error']">{{ captchaMessage }}</p>
                    </div>
                 </form>
              </div>
            </div>
          </div>

          <!-- IP Whitelist Section: Only show if settings data is loaded -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.ipWhitelist.title') }}</h2>
            <div class="p-6 space-y-6">
               <p class="text-sm text-text-secondary mb-4">{{ $t('settings.ipWhitelist.description') }}</p>
               <form @submit.prevent="handleUpdateIpWhitelist" class="space-y-4">
                 <div>
                   <label for="ipWhitelist" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.ipWhitelist.label') }}</label>
                   <textarea id="ipWhitelist" v-model="ipWhitelistInput" rows="4"
                             class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary font-mono text-sm"></textarea>
                   <small class="block mt-1 text-xs text-text-secondary">{{ $t('settings.ipWhitelist.hint') }}</small>
                 </div>
                 <div class="flex items-center justify-between">
                    <button type="submit" :disabled="ipWhitelistLoading"
                            class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                      {{ ipWhitelistLoading ? $t('common.loading') : $t('settings.ipWhitelist.saveButton') }}
                    </button>
                    <p v-if="ipWhitelistMessage" :class="['text-sm', ipWhitelistSuccess ? 'text-success' : 'text-error']">{{ ipWhitelistMessage }}</p>
                 </div>
               </form>
            </div>
          </div>

          <!-- IP Blacklist Section: Only show if settings data is loaded (as config depends on it) -->
           <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
             <div class="flex items-center justify-between px-6 py-4 border-b border-border bg-header/50">
               <h2 class="text-lg font-semibold text-foreground">{{ $t('settings.ipBlacklist.title') }}</h2>
               <!-- IP Blacklist Enable/Disable Switch -->
               <button
                 type="button"
                 @click="handleUpdateIpBlacklistEnabled"
                 :class="[
                   'relative inline-flex flex-shrink-0 h-6 w-11 border-2 border-transparent rounded-full cursor-pointer transition-colors ease-in-out duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary',
                   ipBlacklistEnabled ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                 ]"
                 role="switch"
                 :aria-checked="ipBlacklistEnabled"
               >
                 <span
                   aria-hidden="true"
                   :class="[
                     'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform ring-0 transition ease-in-out duration-200',
                     ipBlacklistEnabled ? 'translate-x-5' : 'translate-x-0'
                   ]"
                 ></span>
               </button>
             </div>
             <div class="p-6 space-y-6">
                 <!-- Description moved below -->

                 <!-- Existing Blacklist Content (Conditional Rendering) -->
                <div v-if="ipBlacklistEnabled" class="space-y-6 pt-4">
                  <p class="text-sm text-text-secondary">{{ $t('settings.ipBlacklist.description') }}</p>
                  <!-- Blacklist config form -->
                  <form @submit.prevent="handleUpdateBlacklistSettings" class="flex flex-wrap items-end gap-4">
                     <div class="flex-grow min-w-[150px]">
                       <label for="maxLoginAttempts" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.ipBlacklist.maxAttemptsLabel') }}</label>
                     <input type="number" id="maxLoginAttempts" v-model="blacklistSettingsForm.maxLoginAttempts" min="1" required
                            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                   </div>
                   <div class="flex-grow min-w-[150px]">
                     <label for="loginBanDuration" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.ipBlacklist.banDurationLabel') }}</label>
                     <input type="number" id="loginBanDuration" v-model="blacklistSettingsForm.loginBanDuration" min="1" required
                            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                   </div>
                   <div class="flex-shrink-0">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ $t('settings.ipBlacklist.saveConfigButton') }}
                      </button>
                   </div>
                     <p v-if="blacklistSettingsMessage" :class="['w-full mt-2 text-sm', blacklistSettingsSuccess ? 'text-success' : 'text-error']">{{ blacklistSettingsMessage }}</p>
                  </form>
                  <hr class="border-border/50">
                  <!-- Blacklist table -->
                  <h3 class="text-base font-semibold text-foreground">{{ $t('settings.ipBlacklist.currentBannedTitle') }}</h3>
                <!-- Error state -->
                <div v-if="ipBlacklist.error" class="p-3 border-l-4 border-error bg-error/10 text-error text-sm rounded">{{ ipBlacklist.error }}</div>
                <!-- Loading state (Only show if loading AND no entries are displayed yet) -->
                <div v-else-if="ipBlacklist.loading && ipBlacklist.entries.length === 0" class="p-4 text-center text-text-secondary italic">{{ $t('settings.ipBlacklist.loadingList') }}</div>
                <!-- Empty state (Show only if not loading, no error, and entries empty) -->
                <p v-else-if="!ipBlacklist.loading && !ipBlacklist.error && ipBlacklist.entries.length === 0" class="p-4 text-center text-text-secondary italic">{{ $t('settings.ipBlacklist.noBannedIps') }}</p>
                <!-- Table (Show if not loading, no error, and has entries) -->
                <div v-else-if="!ipBlacklist.loading && !ipBlacklist.error && ipBlacklist.entries.length > 0" class="overflow-x-auto border border-border rounded-lg shadow-sm bg-background">
                  <table class="min-w-full divide-y divide-border text-sm">
                     <thead class="bg-header">
                       <tr>
                         <th scope="col" class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap">{{ $t('settings.ipBlacklist.table.ipAddress') }}</th>
                         <th scope="col" class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap">{{ $t('settings.ipBlacklist.table.attempts') }}</th>
                         <th scope="col" class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap">{{ $t('settings.ipBlacklist.table.lastAttempt') }}</th>
                         <th scope="col" class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap">{{ $t('settings.ipBlacklist.table.bannedUntil') }}</th>
                         <th scope="col" class="px-4 py-2 text-left font-medium text-text-secondary tracking-wider whitespace-nowrap">{{ $t('settings.ipBlacklist.table.actions') }}</th>
                       </tr>
                     </thead>
                     <tbody class="divide-y divide-border">
                       <tr v-for="entry in ipBlacklist.entries" :key="entry.ip" class="hover:bg-header/50">
                         <td class="px-4 py-2 whitespace-nowrap">{{ entry.ip }}</td>
                         <td class="px-4 py-2 whitespace-nowrap">{{ entry.attempts }}</td>
                         <td class="px-4 py-2 whitespace-nowrap">{{ new Date(entry.last_attempt_at * 1000).toLocaleString() }}</td>
                         <td class="px-4 py-2 whitespace-nowrap">{{ entry.blocked_until ? new Date(entry.blocked_until * 1000).toLocaleString() : $t('statusMonitor.notAvailable') }}</td>
                         <td class="px-4 py-2 whitespace-nowrap">
                           <button
                             @click="handleDeleteIp(entry.ip)"
                             :disabled="blacklistDeleteLoading && blacklistToDeleteIp === entry.ip"
                             class="px-2 py-1 bg-error text-error-text rounded text-xs font-medium hover:bg-error/80 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-error disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out"
                           >
                             {{ (blacklistDeleteLoading && blacklistToDeleteIp === entry.ip) ? $t('settings.ipBlacklist.table.deleting') : $t('settings.ipBlacklist.table.removeButton') }}
                           </button>
                         </td>
                       </tr>
                     </tbody>
                  </table>
                </div>
                <!-- Delete Error (Show regardless of loading state if present) -->
                  <p v-if="blacklistDeleteError" class="mt-3 text-sm text-error">{{ blacklistDeleteError }}</p>
                </div> <!-- End v-if="ipBlacklistEnabled" -->
                <!-- Message when disabled -->
                <div v-else class="p-4 text-center text-text-secondary italic border border-dashed border-border/50 rounded-md">
                   {{ $t('settings.ipBlacklist.disabledMessage', 'IP 黑名单功能当前已禁用。') }}
                </div>
             </div>
           </div>

           <!-- About Section -->
           <div class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
             <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.category.about') }}</h2>
             <div class="p-6 space-y-4"> <!-- Reduced space-y for tighter layout -->
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary"> <!-- Flex container for info items, allow wrap -->
                   <span class="font-medium">{{ $t('settings.about.version') }}: {{ appVersion }}</span>
                   <!-- Version Check Status -->
                   <span v-if="isCheckingVersion" class="inline-block text-xs ml-2 px-2 py-0.5 rounded-full bg-blue-500 text-white italic">
                     {{ $t('settings.about.checkingUpdate') }}
                   </span>
                   <span v-else-if="versionCheckError" class="inline-block text-xs ml-2 px-2 py-0.5 rounded-full bg-error text-white" :title="versionCheckError">
                     {{ $t('settings.about.error.checkFailedShort') }}
                   </span>
                   <span v-else-if="!isUpdateAvailable && latestVersion" class="inline-block text-xs ml-2 px-2 py-0.5 rounded-full bg-success text-white">
                     {{ $t('settings.about.latestVersion') }}
                   </span>
                   <a v-else-if="isUpdateAvailable && latestVersion"
                      :href="`https://github.com/Heavrnl/nexus-terminal/releases/tag/${latestVersion}`"
                      target="_blank" rel="noopener noreferrer"
                      class="inline-flex items-center text-xs ml-2 px-2 py-0.5 rounded-full bg-warning text-white hover:bg-warning/80">
                     <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1 h-3 w-3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                     {{ $t('settings.about.updateAvailable', { version: latestVersion }) }}
                   </a>
                   <span class="opacity-50">|</span>
                   <a href="https://github.com/Heavrnl/nexus-terminal" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline inline-flex items-center">
                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" class="mr-1" viewBox="0 0 16 16"> <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/> </svg>
                     Heavrnl/nexus-terminal
                   </a>
                   <span class="opacity-50">|</span>
                   <a href="https://ko-fi.com/0heavrnl" target="_blank" rel="noopener noreferrer" title="Support me on Ko-fi" class="text-primary hover:underline inline-flex items-center">
                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14" class="mr-1"> <path d="M20.33 6.08c-.28-.4-.7-.68-1.18-.82-.48-.14-.98-.14-1.47-.02-.48.12-.9.38-1.22.75-.32.37-.5.83-.5 1.32 0 .48.18.93.5 1.3.32.37.75.63 1.22.75.48.12.98.12 1.47 0 .48-.12.9-.38 1.18-.75.28-.37.45-.82.45-1.3 0-.48-.17-.95-.45-1.32zm-2.75 1.5c-.14.17-.33.25-.53.25s-.38-.08-.53-.25c-.14-.17-.22-.38-.22-.6s.08-.43.22-.6c.14-.17.33-.25.53-.25s.38.08.53.25c.14.17.22.38.22.6s-.08.43-.22.6zM18 10H6c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-6c0-1.1-.9-2-2-2zm-6 8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/> </svg>
                     Ko-fi
                   </a>
                </div>
             </div>
           </div> <!-- End About Section -->
         </div>
 
         <!-- Column 2: Appearance, Workspace, System -->
        <div class="space-y-6"> <!-- Removed col-span -->

          <!-- Workspace Section: Only show if settings data is loaded -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.workspace.title') }}</h2>
            <div class="p-6 space-y-6">
              <!-- Popup Editor -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.popupEditor.title') }}</h3>
                 <form @submit.prevent="handleUpdatePopupEditorSetting" class="space-y-4">
                     <div class="flex items-center">
                         <input type="checkbox" id="showPopupEditor" v-model="popupEditorEnabled"
                                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                         <label for="showPopupEditor" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.popupEditor.enableLabel') }}</label>
                     </div>
                     <div class="flex items-center justify-between">
                        <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                          {{ $t('settings.popupEditor.saveButton') }}
                        </button>
                        <p v-if="popupEditorMessage" :class="['text-sm', popupEditorSuccess ? 'text-success' : 'text-error']">{{ popupEditorMessage }}</p>
                     </div>
                 </form>
              </div>
              <hr class="border-border/50">
              <!-- Share Tabs -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.shareEditorTabs.title') }}</h3>
                 <form @submit.prevent="handleUpdateShareTabsSetting" class="space-y-4">
                     <div class="flex items-center">
                         <input type="checkbox" id="shareEditorTabs" v-model="shareTabsEnabled"
                                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                         <label for="shareEditorTabs" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.shareEditorTabs.enableLabel') }}</label>
                     </div>
                     <p class="text-xs text-text-secondary mt-1">{{ $t('settings.shareEditorTabs.description') }}</p>
                     <div class="flex items-center justify-between">
                        <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                          {{ $t('settings.shareEditorTabs.saveButton') }}
                        </button>
                        <p v-if="shareTabsMessage" :class="['text-sm', shareTabsSuccess ? 'text-success' : 'text-error']">{{ shareTabsMessage }}</p>
                     </div>
                 </form>
              </div>
              <hr class="border-border/50">
              <!-- Auto Copy -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.autoCopyOnSelect.title') }}</h3>
                 <form @submit.prevent="handleUpdateAutoCopySetting" class="space-y-4">
                     <div class="flex items-center">
                         <input type="checkbox" id="autoCopyOnSelect" v-model="autoCopyEnabled"
                                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                         <label for="autoCopyOnSelect" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.autoCopyOnSelect.enableLabel') }}</label>
                     </div>
                     <div class="flex items-center justify-between">
                        <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                          {{ $t('settings.autoCopyOnSelect.saveButton') }}
                        </button>
                        <p v-if="autoCopyMessage" :class="['text-sm', autoCopySuccess ? 'text-success' : 'text-error']">{{ autoCopyMessage }}</p>
                     </div>
                 </form>
              </div>
              <hr class="border-border/50">
              <!-- Persistent Sidebar -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.workspace.sidebarPersistentTitle') }}</h3>
                 <form @submit.prevent="handleUpdateWorkspaceSidebarSetting" class="space-y-4">
                     <div class="flex items-center">
                         <input type="checkbox" id="workspaceSidebarPersistent" v-model="workspaceSidebarPersistentEnabled"
                                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                         <label for="workspaceSidebarPersistent" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.workspace.sidebarPersistentLabel') }}</label>
                     </div>
                     <p class="text-xs text-text-secondary mt-1">{{ $t('settings.workspace.sidebarPersistentDescription') }}</p>
                     <div class="flex items-center justify-between">
                        <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                          {{ $t('common.save') }}
                        </button>
                        <p v-if="workspaceSidebarPersistentMessage" :class="['text-sm', workspaceSidebarPersistentSuccess ? 'text-success' : 'text-error']">{{ workspaceSidebarPersistentMessage }}</p>
                     </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- NEW: Separator -->
              <!-- Command Input Sync Target -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.commandInputSync.title', '命令输入同步') }}</h3>
                 <form @submit.prevent="handleUpdateCommandInputSyncTarget" class="space-y-4">
                   <div>
                     <label for="commandInputSyncTargetSelect" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.commandInputSync.selectLabel', '同步目标') }}</label>
                     <select id="commandInputSyncTargetSelect" v-model="commandInputSyncTargetLocal"
                             class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
                             style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-size: 16px 12px;">
                       <option value="none">{{ $t('settings.commandInputSync.targetNone', '无') }}</option>
                       <option value="quickCommands">{{ $t('settings.commandInputSync.targetQuickCommands', '快捷指令') }}</option>
                       <option value="commandHistory">{{ $t('settings.commandInputSync.targetCommandHistory', '历史命令') }}</option>
                     </select>
                     <p class="text-xs text-text-secondary mt-1">{{ $t('settings.commandInputSync.description', '将命令输入框的内容实时同步到所选面板的搜索框。') }}</p>
                   </div>
                   <div class="flex items-center justify-between">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ $t('common.save') }}
                      </button>
                      <p v-if="commandInputSyncMessage" :class="['text-sm', commandInputSyncSuccess ? 'text-success' : 'text-error']">{{ commandInputSyncMessage }}</p>
                   </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- NEW: Separator -->
              <!-- Show Connection Tags -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.workspace.showConnectionTagsTitle', '显示连接标签') }}</h3>
                 <form @submit.prevent="handleUpdateShowConnectionTags" class="space-y-4">
                     <div class="flex items-center">
                         <input type="checkbox" id="showConnectionTags" v-model="showConnectionTagsLocal"
                                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                         <label for="showConnectionTags" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.workspace.showConnectionTagsLabel', '在连接列表中显示标签') }}</label>
                     </div>
                     <p class="text-xs text-text-secondary mt-1">{{ $t('settings.workspace.showConnectionTagsDescription', '关闭后将隐藏连接列表中的标签，并从搜索中排除标签。') }}</p>
                     <div class="flex items-center justify-between pt-2">
                        <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                          {{ $t('common.save') }}
                        </button>
                        <p v-if="showConnectionTagsMessage" :class="['text-sm', showConnectionTagsSuccess ? 'text-success' : 'text-error']">{{ showConnectionTagsMessage }}</p>
                     </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- NEW: Separator -->
              <!-- Show Quick Command Tags -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.workspace.showQuickCommandTagsTitle', '显示快捷指令标签') }}</h3>
                 <form @submit.prevent="handleUpdateShowQuickCommandTags" class="space-y-4">
                     <div class="flex items-center">
                         <input type="checkbox" id="showQuickCommandTags" v-model="showQuickCommandTagsLocal"
                                class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                         <label for="showQuickCommandTags" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.workspace.showQuickCommandTagsLabel', '在快捷指令列表中显示标签') }}</label>
                     </div>
                     <p class="text-xs text-text-secondary mt-1">{{ $t('settings.workspace.showQuickCommandTagsDescription', '关闭后将隐藏快捷指令列表中的标签，并从搜索中排除标签。') }}</p>
                     <div class="flex items-center justify-between pt-2">
                        <button type="submit"
                                class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                          {{ $t('common.save') }}
                        </button>
                        <p v-if="showQuickCommandTagsMessage" :class="['text-sm', showQuickCommandTagsSuccess ? 'text-success' : 'text-error']">{{ showQuickCommandTagsMessage }}</p>
                     </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- NEW: Separator -->
              <!-- Terminal Scrollback Limit -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.terminalScrollback.title', '终端回滚行数') }}</h3>
                 <form @submit.prevent="handleUpdateTerminalScrollbackLimit" class="space-y-4">
                   <div>
                     <label for="terminalScrollbackLimitInput" class="block text-sm font-medium text-text-secondary mb-1">{{ t('settings.terminalScrollback.limitLabel', '最大行数') }}</label>
                     <input type="number" id="terminalScrollbackLimitInput" v-model.number="terminalScrollbackLimitLocal" min="0" step="1" placeholder="5000"
                            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                     <small class="block mt-1 text-xs text-text-secondary">{{ t('settings.terminalScrollback.limitHint', '设置终端保留的最大输出行数。0 或留空表示无限制 (使用默认值 5000)。此设置将在下次打开终端时生效。') }}</small>
                   </div>
                   <div class="flex items-center justify-between">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ t('settings.terminalScrollback.saveButton', '保存') }}
                      </button>
                      <p v-if="terminalScrollbackLimitMessage" :class="['text-sm', terminalScrollbackLimitSuccess ? 'text-success' : 'text-error']">{{ terminalScrollbackLimitMessage }}</p>
                   </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- NEW: Separator -->
             <!-- File Manager Delete Confirmation -->
             <div class="settings-section-content">
                <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.workspace.fileManagerDeleteConfirmTitle', '文件管理器删除确认') }}</h3>
                <form @submit.prevent="handleUpdateFileManagerDeleteConfirmation" class="space-y-4">
                    <div class="flex items-center">
                        <input type="checkbox" id="fileManagerShowDeleteConfirmation" v-model="fileManagerShowDeleteConfirmationLocal"
                               class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                        <label for="fileManagerShowDeleteConfirmation" class="text-sm text-foreground cursor-pointer select-none">{{ $t('settings.workspace.fileManagerShowDeleteConfirmationLabel', '删除文件或文件夹时显示确认提示框') }}</label>
                    </div>
                    <div class="flex items-center justify-between pt-2">
                       <button type="submit"
                               class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                         {{ $t('common.save') }}
                       </button>
                       <p v-if="fileManagerShowDeleteConfirmationMessage" :class="['text-sm', fileManagerShowDeleteConfirmationSuccess ? 'text-success' : 'text-error']">{{ fileManagerShowDeleteConfirmationMessage }}</p>
                    </div>
                </form>
             </div>
            </div>
          </div>

          <!-- System Section: Only show if settings data is loaded -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.category.system') }}</h2>
            <div class="p-6 space-y-6">
              <!-- Language -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.language.title') }}</h3>
                 <form @submit.prevent="handleUpdateLanguage" class="space-y-4">
                   <div>
                     <label for="languageSelect" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.language.selectLabel') }}</label>
                     <select id="languageSelect" v-model="selectedLanguage"
                             class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
                             style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-size: 16px 12px;">
                       <option v-for="locale in availableLocales" :key="locale" :value="locale">
                         {{ languageNames[locale] || locale }} <!-- Display mapped name or locale code -->
                       </option>
                     </select>
                   </div>
                   <div class="flex items-center justify-between">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ $t('settings.language.saveButton') }}
                      </button>
                      <p v-if="languageMessage" :class="['text-sm', languageSuccess ? 'text-success' : 'text-error']">{{ languageMessage }}</p>
                   </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- Separator -->
              <!-- Timezone Setting -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.timezone.title') }}</h3>
                 <form @submit.prevent="handleUpdateTimezone" class="space-y-4">
                   <div>
                     <label for="timezoneSelect" class="block text-sm font-medium text-text-secondary mb-1">{{ $t('settings.timezone.selectLabel') }}</label>
                     <select id="timezoneSelect" v-model="selectedTimezone"
                             class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary appearance-none bg-no-repeat bg-right pr-8"
                             style="background-image: url('data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 16\'%3e%3cpath fill=\'none\' stroke=\'%236c757d\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M2 5l6 6 6-6\'/%3e%3c/svg%3e'); background-position: right 0.75rem center; background-size: 16px 12px;">
                       <option v-for="tz in commonTimezones" :key="tz" :value="tz">
                         {{ tz }}
                       </option>
                     </select>
                      <small class="block mt-1 text-xs text-text-secondary">{{ $t('settings.timezone.description') }}</small>
                   </div>
                   <div class="flex items-center justify-between">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ $t('common.save') }}
                      </button>
                      <p v-if="timezoneMessage" :class="['text-sm', timezoneSuccess ? 'text-success' : 'text-error']">{{ timezoneMessage }}</p>
                   </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- Separator -->
              <!-- Status Monitor -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.statusMonitor.title') }}</h3>
                 <form @submit.prevent="handleUpdateStatusMonitorInterval" class="space-y-4">
                   <div>
                     <label for="statusMonitorInterval" class="block text-sm font-medium text-text-secondary mb-1">{{ t('settings.statusMonitor.refreshIntervalLabel') }}</label>
                     <input type="number" id="statusMonitorInterval" v-model.number="statusMonitorIntervalLocal" min="1" step="1" required
                            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                     <small class="block mt-1 text-xs text-text-secondary">{{ t('settings.statusMonitor.refreshIntervalHint') }}</small>
                   </div>
                   <div class="flex items-center justify-between">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ t('settings.statusMonitor.saveButton') }}
                      </button>
                      <p v-if="statusMonitorMessage" :class="['text-sm', statusMonitorSuccess ? 'text-success' : 'text-error']">{{ statusMonitorMessage }}</p>
                   </div>
                 </form>
              </div>
              <hr class="border-border/50"> <!-- Separator -->
              <!-- Docker -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.docker.title') }}</h3>
                 <form @submit.prevent="handleUpdateDockerSettings" class="space-y-4">
                   <div>
                     <label for="dockerInterval" class="block text-sm font-medium text-text-secondary mb-1">{{ t('settings.docker.refreshIntervalLabel') }}</label>
                     <input type="number" id="dockerInterval" v-model.number="dockerInterval" min="1" step="1" required
                            class="w-full px-3 py-2 border border-border rounded-md shadow-sm bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary">
                      <small class="block mt-1 text-xs text-text-secondary">{{ t('settings.docker.refreshIntervalHint') }}</small>
                   </div>
                   <div class="flex items-center">
                     <input type="checkbox" id="dockerExpandDefault" v-model="dockerExpandDefault"
                            class="h-4 w-4 rounded border-border text-primary focus:ring-primary mr-2 cursor-pointer">
                     <label for="dockerExpandDefault" class="text-sm text-foreground cursor-pointer select-none">{{ t('settings.docker.defaultExpandLabel') }}</label>
                   </div>
                   <div class="flex items-center justify-between">
                      <button type="submit"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition duration-150 ease-in-out text-sm font-medium">
                        {{ t('settings.docker.saveButton') }}
                      </button>
                      <p v-if="dockerSettingsMessage" :class="['text-sm', dockerSettingsSuccess ? 'text-success' : 'text-error']">{{ dockerSettingsMessage }}</p>
                   </div>
                 </form>
              </div>
            </div>
          </div>
          <!-- Data Management Section (including Export) -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">
              {{ t('settings.category.dataManagement', '数据管理') }}
            </h2>
            <div class="p-6 space-y-6">
              <!-- Export Connections Section -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ t('settings.exportConnections.title', '导出连接数据') }}</h3>
                 <p class="text-sm text-text-secondary mb-4">
                   <span class="font-semibold text-warning">{{ t('settings.exportConnections.decryptKeyInfo', '解压密码为您的 data/.env 文件中的 ENCRYPTION_KEY。请妥善保管此文件。') }}</span>
                 </p>
                 <form @submit.prevent="handleExportConnections" class="space-y-4">
                   <div class="flex items-center justify-between">
                      <button type="submit" :disabled="exportConnectionsLoading"
                              class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium inline-flex items-center">
                        <svg v-if="exportConnectionsLoading" class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {{ exportConnectionsLoading ? t('common.loading') : t('settings.exportConnections.buttonText', '开始导出') }}
                      </button>
                      <p v-if="exportConnectionsMessage" :class="['text-sm', exportConnectionsSuccess ? 'text-success' : 'text-error']">{{ exportConnectionsMessage }}</p>
                   </div>
                 </form>
              </div>
            </div>
          </div> <!-- End Data Management Section -->
          
          <!-- Appearance Section: Only show if settings data is loaded -->
          <div v-if="settings" class="bg-background border border-border rounded-lg shadow-sm overflow-hidden">
            <h2 class="text-lg font-semibold text-foreground px-6 py-4 border-b border-border bg-header/50">{{ $t('settings.category.appearance') }}</h2>
            <div class="p-6 space-y-6">
              <!-- Style Customizer -->
              <div class="settings-section-content">
                 <h3 class="text-base font-semibold text-foreground mb-3">{{ $t('settings.appearance.title') }}</h3>
                 <p class="text-sm text-text-secondary mb-4">{{ $t('settings.appearance.description') }}</p>
                 <button @click="openStyleCustomizer"
                         class="px-4 py-2 bg-button text-button-text rounded-md shadow-sm hover:bg-button-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out text-sm font-medium">
                   {{ t('settings.appearance.customizeButton') }}
                 </button>
              </div>
            </div>
          </div> 

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
import { useChangePassword } from '../composables/settings/useChangePassword';
import { usePasskeyManagement } from '../composables/settings/usePasskeyManagement';
import { useTwoFactorAuth } from '../composables/settings/useTwoFactorAuth';
import { useCaptchaSettings, type CaptchaProvider, type UpdateCaptchaSettingsDto } from '../composables/settings/useCaptchaSettings'; // Import Captcha composable
import { useIpWhitelist } from '../composables/settings/useIpWhitelist'; // Import IP Whitelist composable
import { useIpBlacklist } from '../composables/settings/useIpBlacklist'; // Import IP Blacklist composable
import { useVersionCheck } from '../composables/settings/useVersionCheck'; // Import Version Check composable
import { useWorkspaceSettings } from '../composables/settings/useWorkspaceSettings'; // Import Workspace Settings composable
import { useAppearanceSettings } from '../composables/settings/useAppearanceSettings'; // Import Appearance Settings composable
import { useSystemSettings } from '../composables/settings/useSystemSettings'; // Import System Settings composable
import { useExportConnections } from '../composables/settings/useExportConnections'; // Import Export Connections composable

const authStore = useAuthStore();
const settingsStore = useSettingsStore();
const appearanceStore = useAppearanceStore(); // 实例化外观 store
const { t } = useI18n();

// --- Change Password (Refactored) ---
const {
  currentPassword,
  newPassword,
  confirmPassword,
  changePasswordLoading,
  changePasswordMessage,
  changePasswordSuccess,
  handleChangePassword,
} = useChangePassword();

// --- Passkey Management (Refactored) ---
const {
  passkeys, // from authStore, made reactive via usePasskeyManagement
  passkeysLoading: authStorePasskeysLoading, // from authStore, alias to avoid conflict if template uses 'passkeysLoading' for registration
  passkeyRegistrationLoading: passkeyLoading, // Aliased for template compatibility
  passkeyMessage,
  passkeySuccess,
  passkeyDeleteLoadingStates,
  passkeyDeleteError,
  editingPasskeyId,
  editingPasskeyName,
  passkeyEditLoadingStates,
  handleRegisterNewPasskey,
  startEditPasskeyName,
  cancelEditPasskeyName,
  savePasskeyName,
  handleDeletePasskey,
  formatDate, // formatDate for passkeys section
} = usePasskeyManagement();

// --- 2FA (Refactored) ---
const {
  twoFactorEnabled,
  twoFactorLoading,
  twoFactorMessage,
  twoFactorSuccess,
  setupData,
  verificationCode,
  disablePassword,
  isSettingUp2FA,
  // checkTwoFactorStatus, // onMounted will call this
  handleSetup2FA,
  handleVerifyAndActivate2FA,
  handleDisable2FA,
  cancelSetup,
} = useTwoFactorAuth();

// --- CAPTCHA Settings (Refactored) ---
const {
  captchaForm,
  captchaLoading,
  captchaMessage,
  captchaSuccess,
  handleUpdateCaptchaSettings,
} = useCaptchaSettings();

// --- IP Whitelist (Refactored) ---
const {
  ipWhitelistInput,
  ipWhitelistLoading,
  ipWhitelistMessage,
  ipWhitelistSuccess,
  handleUpdateIpWhitelist,
} = useIpWhitelist();

// --- IP Blacklist (Refactored) ---
const {
  ipBlacklistEnabled,
  handleUpdateIpBlacklistEnabled,
  blacklistSettingsForm,
  blacklistSettingsLoading,
  blacklistSettingsMessage,
  blacklistSettingsSuccess,
  handleUpdateBlacklistSettings,
  ipBlacklist,
  blacklistToDeleteIp,
  blacklistDeleteLoading,
  blacklistDeleteError,
  handleDeleteIp, // Exposed as it's used in the template
} = useIpBlacklist();

// --- Version Check (Refactored) ---
const {
  appVersion, // Now from useVersionCheck
  latestVersion,
  isCheckingVersion,
  versionCheckError,
  isUpdateAvailable,
  checkLatestVersion, // Function to check version
} = useVersionCheck();

// --- Workspace Settings (Refactored) ---
const {
  popupEditorEnabled,
  popupEditorLoading,
  popupEditorMessage,
  popupEditorSuccess,
  handleUpdatePopupEditorSetting,
  shareTabsEnabled,
  shareTabsLoading,
  shareTabsMessage,
  shareTabsSuccess,
  handleUpdateShareTabsSetting,
  autoCopyEnabled,
  autoCopyLoading,
  autoCopyMessage,
  autoCopySuccess,
  handleUpdateAutoCopySetting,
  workspaceSidebarPersistentEnabled,
  workspaceSidebarPersistentLoading,
  workspaceSidebarPersistentMessage,
  workspaceSidebarPersistentSuccess,
  handleUpdateWorkspaceSidebarSetting,
  commandInputSyncTargetLocal,
  commandInputSyncLoading,
  commandInputSyncMessage,
  commandInputSyncSuccess,
  handleUpdateCommandInputSyncTarget,
  showConnectionTagsLocal,
  showConnectionTagsLoading,
  showConnectionTagsMessage,
  showConnectionTagsSuccess,
  handleUpdateShowConnectionTags,
  showQuickCommandTagsLocal,
  showQuickCommandTagsLoading,
  showQuickCommandTagsMessage,
  showQuickCommandTagsSuccess,
  handleUpdateShowQuickCommandTags,
  terminalScrollbackLimitLocal,
  terminalScrollbackLimitLoading,
  terminalScrollbackLimitMessage,
  terminalScrollbackLimitSuccess,
  handleUpdateTerminalScrollbackLimit,
  fileManagerShowDeleteConfirmationLocal,
  fileManagerShowDeleteConfirmationLoading,
  fileManagerShowDeleteConfirmationMessage,
  fileManagerShowDeleteConfirmationSuccess,
  handleUpdateFileManagerDeleteConfirmation,
} = useWorkspaceSettings();

// --- Appearance Settings (Refactored) ---
const {
  openStyleCustomizer,
} = useAppearanceSettings();

// --- System Settings (Refactored) ---
const {
  selectedLanguage,
  languageLoading,
  languageMessage,
  languageSuccess,
  languageNames,
  availableLocales,
  handleUpdateLanguage,
  selectedTimezone,
  timezoneLoading,
  timezoneMessage,
  timezoneSuccess,
  commonTimezones,
  handleUpdateTimezone,
  statusMonitorIntervalLocal,
  statusMonitorLoading,
  statusMonitorMessage,
  statusMonitorSuccess,
  handleUpdateStatusMonitorInterval,
  dockerInterval,
  dockerExpandDefault,
  dockerSettingsLoading,
  dockerSettingsMessage,
  dockerSettingsSuccess,
  handleUpdateDockerSettings,
} = useSystemSettings();

// --- Export Connections (Refactored) ---
const {
  exportConnectionsLoading,
  exportConnectionsMessage,
  exportConnectionsSuccess,
  handleExportConnections,
} = useExportConnections();

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
  await checkLatestVersion(); // <-- Check for latest version on mount
});

</script>

<style scoped>
/* Remove all scoped styles as they are now handled by Tailwind utility classes */
</style>

