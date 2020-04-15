'use strict';

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
    await browser.windows.update(window.id, {
      width: 400, height: 300,
    });
  }

  async function mount(request) {
    const mounted = await fs.isMounted(request.url, request.username);
    if (mounted) throw new Error('Already mounted');
    await fs.mount(request);
  }

  browser.runtime.onInstalled.addListener(async () => {
    await browser.storage.local.set({ version: 'v1' });
  });

  browser.fileSystemProvider.onMountRequested.addListener(openWindow);

  browser.runtime.onMessage.addListener(mount);

  // fs.resumeMounts(); // for debug
})();
