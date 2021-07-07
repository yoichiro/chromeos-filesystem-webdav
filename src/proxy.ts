const UA = 'Nextcloud (unofficial) for Chrome OS';

export default class Proxy {
  #hosts: string[] = [];

  onBeforeSendHeaders(details: chrome.webRequest.WebRequestHeadersDetails) {
    const { url, initiator, requestHeaders } = details;
    if (!requestHeaders) return;
    if (initiator !== `chrome-extension://${browser.runtime.id}`) return;
    console.log(`Proxy.onBeforeSendHeaders: url = ${url}`);

    for (let i = 0; i < requestHeaders.length; i++) {
      const header = requestHeaders[i];
      if (header.name.match(/^User-Agent$/i)) {
        header.value = UA;
      } else if (header.name.match(/^(Cookie|Origin|Sec-Fetch-(Site|Mode|Dest))$/i)) {
        requestHeaders.splice(i, 1);
        i--;
      }
    }

    return { requestHeaders };
  }

  onHeadersReceived(details: chrome.webRequest.WebResponseHeadersDetails) {
    const { url, initiator, responseHeaders } = details;
    if (!responseHeaders) return;
    if (initiator !== `chrome-extension://${browser.runtime.id}`) return;
    console.log(`Proxy.onHeadersReceived: url = ${url}`);

    for (let i = 0; i < responseHeaders.length; i++) {
      const header = responseHeaders[i];
      if (header.name.match(/^Set-Cookie$/i)) {
        responseHeaders.splice(i, 1);
        i--;
      }
    }

    return { responseHeaders };
  }

  async register(host: string) {
    if (this.#hosts.find(v => v === host)) return;
    this.#hosts.push(host);

    chrome.webRequest.onBeforeSendHeaders.addListener(
      this.onBeforeSendHeaders,
      { urls: [`https://${host}/*`], types: ['xmlhttprequest'] },
      ['blocking', 'requestHeaders', 'extraHeaders']
    );

    chrome.webRequest.onHeadersReceived.addListener(
      this.onHeadersReceived,
      { urls: [`https://${host}/*`], types: ['xmlhttprequest'] },
      ['blocking', 'responseHeaders', 'extraHeaders']
    );
  }
}
