import Proxy from './proxy';
import WebDAVFS from './webdav_fs';

(() => {
  if (!chrome.fileSystemProvider) {
    console.log("There is no chrome.fileSystemProvider API. See you on ChromeOS!");
    return;
  }

  const proxy = new Proxy();
  const fs = new WebDAVFS(proxy);

  async function openWindow() {
    const window = await browser.windows.create({
      url: 'window.html',
      type: 'popup',
    });
    if (!window.id) return;
    await browser.windows.update(window.id, {
      width: 336, height: 300,
    });
  }

  async function mount(request: any) {
    const { domain, username } = request;
    const mounted = await fs.isMounted(domain, username);
    if (mounted) throw new Error('Already mounted');
    await fs.mount(request);
  }

  browser.runtime.onInstalled.addListener(async () => {
    const VERSION = 2;
    const { version } = await browser.storage.local.get();
    if (version === VERSION) return;
    else if (version === undefined) {
      await browser.storage.local.set({ version: VERSION });
      return;
    }

    // clear storage
    await browser.storage.local.set({ version: 2, mountedCredentials: {} });

    // unmount all filesystems
    const infos: chrome.fileSystemProvider.FileSystemInfo[] =
      await new Promise(resolve => {
        chrome.fileSystemProvider.getAll(resolve);
      });
    for (const { fileSystemId } of infos) {
      await new Promise(resolve => {
        chrome.fileSystemProvider.unmount({ fileSystemId }, resolve);
      });
    }

    await openWindow();
  });

  browser.runtime.onMessage.addListener(async msg => {
    const [action, options] = msg;
    if (action === 'mount') {
      await mount(options)
    } else if (action === 'registerProxy') {
      const { host } = options;
      await proxy.register(host);
    }
  });

  chrome.fileSystemProvider.onMountRequested.addListener(openWindow);

  // fs.resumeMounts(); // for debug
})();
