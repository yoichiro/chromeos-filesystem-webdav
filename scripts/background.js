'use strict';

(() => {
  if (!chrome.fileSystemProvider) {
    console.log("There is no chrome.fileSystemProvider API. See you on ChromeOS!");
    return;
  }

  const fs = new WebDAVFS();

  function openWindow() {
    browser.app.window.create("window.html", {
      outerBounds: {
        width: 800,
        height: 470
      },
      resizable: false
    });
  }

  async function mount(request) {
    const mounted = await fs.isMounted(request.url, request.username);
    if (mounted) throw new Error('Already mounted');
    await fs.mount(request);
  }

  browser.fileSystemProvider.onMountRequested.addListener(openWindow);

  browser.runtime.onMessage.addListener(mount);

  // fs.resumeMounts(); // for debug
})();
