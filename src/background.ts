import WebDAVFS from './webdav_fs';

(() => {
  if (!chrome.fileSystemProvider) {
    console.log("There is no chrome.fileSystemProvider API. See you on ChromeOS!");
    return;
  }

  const fs = new WebDAVFS();

  async function openWindow() {
    const window = await browser.windows.create({
      url: 'window.html',
      type: 'popup',
    });
    if (!window.id) return;
    await browser.windows.update(window.id, {
      width: 400, height: 300,
    });
  }

  async function mount(request: any) {
    const { url, username } = request;
    const mounted = await fs.isMounted(url, username);
    if (mounted) throw new Error('Already mounted');
    await fs.mount(request);
  }

  browser.runtime.onInstalled.addListener(async () => {
    await browser.storage.local.set({ version: 'v1' });
  });

  browser.runtime.onMessage.addListener(mount);

  chrome.fileSystemProvider.onMountRequested.addListener(openWindow);

  // fs.resumeMounts(); // for debug
})();
