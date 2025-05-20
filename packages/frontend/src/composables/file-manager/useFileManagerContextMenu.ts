import { ref, type Ref } from 'vue'; // Removed nextTick, ComponentPublicInstance
import type { FileListItem } from '../../types/sftp.types';
import { type useI18n } from 'vue-i18n';
// FileManagerContextMenu import is no longer needed as we don't hold a ref to it
import { workspaceEmitter, type FileManagerContextMenuPayload } from '../../composables/workspaceEvents';

// 定义菜单项类型 (可以根据需要扩展)
export interface ContextMenuItem {
  label: string;
  action?: () => void;
  disabled?: boolean;
  separator?: boolean; // 添加分隔符类型
  submenu?: ContextMenuItem[]; // 添加二级菜单支持
}

// 支持的压缩格式
export type CompressFormat = 'zip' | 'targz' | 'tarbz2';

// 定义剪贴板状态类型
export interface ClipboardState {
  hasContent: boolean;
  operation?: 'copy' | 'cut';
  // 可以添加 sourcePaths: string[] 等更多信息，但对于禁用/启用粘贴，hasContent 就够了
}

// 定义 Composable 的输入参数类型
export interface UseFileManagerContextMenuOptions {
  selectedItems: Ref<Set<string>>;
  lastClickedIndex: Ref<number>;
  fileList: Ref<Readonly<FileListItem[]>>; // 使用 Readonly 避免直接修改
  currentPath: Ref<string>;
  isConnected: Ref<boolean>;
  isSftpReady: Ref<boolean>;
  clipboardState: Ref<Readonly<ClipboardState>>;
  t: ReturnType<typeof useI18n>['t'];
  getActiveConnectionId: () => string | number | null | undefined; // +++ 获取连接ID的回调 +++
  // --- 回调函数 ---
  onRefresh: () => void;
  onUpload: () => void;
  onDownload: (items: FileListItem[]) => void; // 文件下载回调
  onDownloadDirectory: (item: FileListItem) => void; // +++ 文件夹下载回调 +++
  onDelete: () => void; // 删除操作现在由外部处理
  onRename: (item: FileListItem) => void;
  onChangePermissions: (item: FileListItem) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onCopy: () => void; // +++ 复制回调 +++
  onCut: () => void; // +++ 剪切回调 +++
  onPaste: () => void; // +++ 粘贴回调 +++
  // --- 压缩/解压回调 ---
  onCompressRequest: (items: FileListItem[], format: CompressFormat) => void; // +++ 压缩回调 +++
  onDecompressRequest: (item: FileListItem) => void; // +++ 解压回调 +++
}

// 辅助函数：检查文件是否为支持的压缩格式
const SUPPORTED_ARCHIVE_EXTENSIONS = ['.zip', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2'];
function isSupportedArchive(filename: string): boolean {
  const lowerCaseFilename = filename.toLowerCase();
  return SUPPORTED_ARCHIVE_EXTENSIONS.some(ext => lowerCaseFilename.endsWith(ext));
}


export function useFileManagerContextMenu(options: UseFileManagerContextMenuOptions) {
  const {
    selectedItems,
    lastClickedIndex,
    fileList,
    currentPath,
    isConnected,
    isSftpReady,
    clipboardState,
    t,
    getActiveConnectionId, // +++ 解构 getActiveConnectionId +++
    onRefresh,
    onUpload,
    onDownload,
    onDelete,
    onRename,
    onChangePermissions,
    onNewFolder,
    onNewFile,
    onCopy,
    onCut,
    onPaste,
    onDownloadDirectory,
    onCompressRequest,
    onDecompressRequest,
  } = options;

  // Removed contextMenuVisible, contextMenuPosition, contextMenuItems, contextTargetItem, contextMenuRef

  const showContextMenu = (event: MouseEvent, item?: FileListItem) => {
    event.preventDefault();
    const targetItem = item || null;

    // Adjust selection based on right-click target
    if (targetItem && !event.ctrlKey && !event.metaKey && !event.shiftKey && !selectedItems.value.has(targetItem.filename)) {
        selectedItems.value.clear();
        selectedItems.value.add(targetItem.filename);
        const index = fileList.value.findIndex((f: FileListItem) => f.filename === targetItem.filename);
        lastClickedIndex.value = index;
    } else if (!targetItem) {
        selectedItems.value.clear();
        lastClickedIndex.value = -1;
    }

    let menu: ContextMenuItem[] = [];
    const selectionSize = selectedItems.value.size;
    const clickedItemIsSelected = targetItem && selectedItems.value.has(targetItem.filename);
    const hasClipboardContent = clipboardState.value.hasContent;

    const currentSelectedFileItems = Array.from(selectedItems.value)
        .map(filename => fileList.value.find(f => f.filename === filename))
        .filter((file): file is FileListItem => !!file);

    // Build context menu items (logic largely preserved, but now assigned to local 'menu' variable)
    if (selectionSize > 1 && clickedItemIsSelected) {
        const allFilesSelected = currentSelectedFileItems.length === selectionSize && currentSelectedFileItems.every(selItem => selItem.attrs.isFile);
        menu = [
            { label: t('fileManager.actions.cut'), action: onCut, disabled: !(isConnected.value && isSftpReady.value) },
            { label: t('fileManager.actions.copy'), action: onCopy, disabled: !(isConnected.value && isSftpReady.value) },
        ];
         if (allFilesSelected) {
             menu.push({ label: t('fileManager.actions.downloadMultiple', { count: selectionSize }), action: () => onDownload(currentSelectedFileItems), disabled: !(isConnected.value && isSftpReady.value) });
         }
        menu.push({
            label: t('fileManager.contextMenu.compress'),
            submenu: [
                { label: t('fileManager.contextMenu.compressZip'), action: () => onCompressRequest(currentSelectedFileItems, 'zip'), disabled: !(isConnected.value && isSftpReady.value) },
                { label: t('fileManager.contextMenu.compressTarGz'), action: () => onCompressRequest(currentSelectedFileItems, 'targz'), disabled: !(isConnected.value && isSftpReady.value) },
                { label: t('fileManager.contextMenu.compressTarBz2'), action: () => onCompressRequest(currentSelectedFileItems, 'tarbz2'), disabled: !(isConnected.value && isSftpReady.value) }
            ]
        });
        menu.push({ label: '', action: () => {}, disabled: true, separator: true });
        menu.push(
            { label: t('fileManager.actions.deleteMultiple', { count: selectionSize }), action: onDelete, disabled: !(isConnected.value && isSftpReady.value) },
            { label: t('fileManager.actions.refresh'), action: onRefresh, disabled: !(isConnected.value && isSftpReady.value) }
        );
    } else if (targetItem && targetItem.filename !== '..') {
        menu = [];
        if (targetItem.attrs.isFile) {
            menu.push({ label: t('fileManager.actions.download', { name: targetItem.filename }), action: () => onDownload([targetItem]), disabled: !(isConnected.value && isSftpReady.value) });
        } else if (targetItem.attrs.isDirectory) {
            menu.push({ label: t('fileManager.actions.downloadFolder', { name: targetItem.filename }), action: () => onDownloadDirectory(targetItem), disabled: !(isConnected.value && isSftpReady.value) });
        }
        menu.push({ label: t('fileManager.actions.cut'), action: onCut, disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: t('fileManager.actions.copy'), action: onCopy, disabled: !(isConnected.value && isSftpReady.value) });
        if (targetItem.attrs.isDirectory) {
             menu.push({ label: t('fileManager.actions.paste'), action: onPaste, disabled: !(isConnected.value && isSftpReady.value) || !hasClipboardContent });
        }
        menu.push({ label: '', action: () => {}, disabled: true, separator: true });
        menu.push({ label: t('fileManager.actions.delete'), action: onDelete, disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: t('fileManager.actions.rename'), action: () => onRename(targetItem), disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: '', action: () => {}, disabled: true, separator: true });
        const canCompress = isConnected.value && isSftpReady.value;
        const canDecompress = isConnected.value && isSftpReady.value && targetItem.attrs.isFile && isSupportedArchive(targetItem.filename);
        menu.push({
            label: t('fileManager.contextMenu.compress'),
            submenu: [
                { label: t('fileManager.contextMenu.compressZip'), action: () => onCompressRequest([targetItem], 'zip'), disabled: !canCompress },
                { label: t('fileManager.contextMenu.compressTarGz'), action: () => onCompressRequest([targetItem], 'targz'), disabled: !canCompress },
                { label: t('fileManager.contextMenu.compressTarBz2'), action: () => onCompressRequest([targetItem], 'tarbz2'), disabled: !canCompress }
            ]
        });
        if (canDecompress) {
            menu.push({ label: t('fileManager.contextMenu.decompress'), action: () => onDecompressRequest(targetItem) });
        }
        menu.push({ label: '', action: () => {}, disabled: true, separator: true });
        menu.push({ label: t('fileManager.actions.newFolder'), action: onNewFolder, disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: t('fileManager.actions.newFile'), action: onNewFile, disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: t('fileManager.actions.upload'), action: onUpload, disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: t('fileManager.actions.changePermissions'), action: () => onChangePermissions(targetItem), disabled: !(isConnected.value && isSftpReady.value) });
        menu.push({ label: t('fileManager.actions.refresh'), action: onRefresh, disabled: !(isConnected.value && isSftpReady.value) });
    } else if (!targetItem) {
        menu = [
            { label: t('fileManager.actions.paste'), action: onPaste, disabled: !(isConnected.value && isSftpReady.value) || !hasClipboardContent },
            { label: t('fileManager.actions.newFolder'), action: onNewFolder, disabled: !(isConnected.value && isSftpReady.value) },
            { label: t('fileManager.actions.newFile'), action: onNewFile, disabled: !(isConnected.value && isSftpReady.value) },
            { label: t('fileManager.actions.upload'), action: onUpload, disabled: !(isConnected.value && isSftpReady.value) },
            { label: t('fileManager.actions.refresh'), action: onRefresh, disabled: !(isConnected.value && isSftpReady.value) },
        ];
    } else { // Clicked on '..'
        menu = [
            { label: t('fileManager.actions.paste'), action: onPaste, disabled: !(isConnected.value && isSftpReady.value) || !hasClipboardContent },
            { label: t('fileManager.actions.refresh'), action: onRefresh, disabled: !(isConnected.value && isSftpReady.value) }
        ];
    }

    const sftpInstanceIdRaw = getActiveConnectionId();
    const sftpInstanceId = sftpInstanceIdRaw !== null && sftpInstanceIdRaw !== undefined ? String(sftpInstanceIdRaw) : undefined;


    const payload: FileManagerContextMenuPayload = {
      position: { x: event.clientX, y: event.clientY },
      items: menu,
      activeContextItem: targetItem,
      selectedFileItems: currentSelectedFileItems,
      currentDirectoryPath: currentPath.value,
      sftpInstanceId: sftpInstanceId,
    };

    workspaceEmitter.emit('fileManager:requestContextMenuOpen', payload);
    // Removed all logic for nextTick, direct DOM manipulation, and event listeners for hiding menu
  };

  // Removed hideContextMenu function

  // 返回需要暴露的状态和方法
  return {
    showContextMenu,
    // Removed contextMenuVisible, contextMenuPosition, contextMenuItems, contextTargetItem, contextMenuRef, hideContextMenu
  };
}