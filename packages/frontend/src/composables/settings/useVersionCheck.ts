import { ref, computed } from 'vue';
import axios from 'axios';
import pkg from '../../../package.json'; // 调整路径以正确导入 package.json
import { useI18n } from 'vue-i18n';

export function useVersionCheck() {
  const { t } = useI18n();
  const appVersion = ref(pkg.version);
  const latestVersion = ref<string | null>(null);
  const isCheckingVersion = ref(false);
  const versionCheckError = ref<string | null>(null);

  const isUpdateAvailable = computed(() => {
    // 简单的字符串比较，假设 tag 格式为 vX.Y.Z
    return latestVersion.value && latestVersion.value !== `v${appVersion.value}`;
  });

  const checkLatestVersion = async (targetBranch: string = 'electron') => {
    isCheckingVersion.value = true;
    versionCheckError.value = null;
    latestVersion.value = null;
    try {
      const response = await axios.get(`https://api.github.com/repos/Heavrnl/nexus-terminal/releases`);
      
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const branchReleases = response.data.filter(
          (release: any) => release.target_commitish === targetBranch && !release.prerelease && !release.draft
        );

        if (branchReleases.length > 0) {
          // GitHub API 返回的 releases 默认按 created_at 降序，第一个就是最新的
          latestVersion.value = branchReleases[0].tag_name;
        } else {
          // 没有找到指定分支的 release, 尝试查找其他最新的 release 作为回退
          const anyValidReleases = response.data.filter(
            (release: any) => !release.prerelease && !release.draft
          );
          if (anyValidReleases.length > 0) {
            latestVersion.value = anyValidReleases[0].tag_name;
            // 为了简化，此处不设置特定的提示信息表明这是回退到的通用版本
          } else {
            // 如果没有任何可用的 release
            versionCheckError.value = t('settings.about.error.noReleases');
          }
        }
      } else if (response.data && Array.isArray(response.data) && response.data.length === 0) {
        // 仓库没有任何 release
        versionCheckError.value = t('settings.about.error.noReleases');
      } else {
        // API 返回格式不正确
        versionCheckError.value = t('settings.about.error.checkFailedShort'); // 复用一个已有的短错误提示
      }
    } catch (error: any) {
      console.error(`检查 ${targetBranch} 分支最新版本失败:`, error);
      if (axios.isAxiosError(error) && error.response?.status === 403) {
         versionCheckError.value = t('settings.about.error.rateLimit');
      } else {
        versionCheckError.value = t('settings.about.error.checkFailed'); // 通用失败提示
      }
    } finally {
      isCheckingVersion.value = false;
    }
  };

  return {
    appVersion,
    latestVersion,
    isCheckingVersion,
    versionCheckError,
    isUpdateAvailable,
    checkLatestVersion,
  };
}