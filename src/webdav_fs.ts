import MetadataCache from './metadata_cache';

declare namespace WebDAV {
  type Client = any;
  function createClient(url: string, options: { username: string, password: string }): Client;
}

interface Credential {
  name: string
  url: string
  username: string
  password: string
}

interface OpenedFileProps {
  filePath: string
  mode: string
  buffer: ArrayBuffer
}

export default class WebDAVFS {
  #webDAVClientMap: { [fileSystemId: string]: WebDAV.Client } = {};
  #openedFilesMap: { [openRequestId: string]: OpenedFileProps } = {};
  #metadataCacheMap: { [fileSystemId: string]: MetadataCache } = {};

  constructor() {
    this.#assignEventHandlers();
    this.#resume();
  }

  async isMounted(url: string, username: string) {
    const fileSystemId = createFileSystemID(url, username);
    return await new Promise(resolve => {
      chrome.fileSystemProvider.get(fileSystemId, resolve);
    }) ? true : false;
  }

  async mount(credential: Credential) {
    console.log('WebDAVFS.mount')

    const { name, url, username, password } = credential;
    if (await this.isMounted(url, username)) return;

    const client = WebDAV.createClient(url, { username, password });
    await client.getDirectoryContents('/'); // connect and authenticate

    const fileSystemId = createFileSystemID(url, username);
    await new Promise(resolve => chrome.fileSystemProvider.mount(
      { fileSystemId, displayName: name, writable: true }, resolve
    ));

    this.#webDAVClientMap[fileSystemId] = client;
    this.#metadataCacheMap[fileSystemId] = new MetadataCache();

    await storeMountedCredential(fileSystemId, credential);
  }

  async resumeMounts() {
    for (const { name, url, username } of await getMountedCredentials()) {
      const fileSystemId = createFileSystemID(url, username);
      await new Promise(resolve => chrome.fileSystemProvider.mount(
        { fileSystemId, displayName: name, writable: true }, resolve
      ));
    }
    this.#resume();
  }

  async onUnmountRequested(options: chrome.fileSystemProvider.UnmountOptions) {
    console.log("WebDAVFS.onUnmountRequested");

    await new Promise(resolve =>
      chrome.fileSystemProvider.unmount(options, resolve));

    const { fileSystemId } = options;
    delete this.#webDAVClientMap[fileSystemId];
    delete this.#metadataCacheMap[fileSystemId];

    await removeMountedCredential(fileSystemId);
  }

  async onReadDirectoryRequested(
    options: chrome.fileSystemProvider.DirectoryPathRequestedEventOptions
  ) {
    const { fileSystemId, directoryPath } = options;
    console.log(`WebDAVFS.onReadDirectoryRequested: directoryPath=${directoryPath}`);
    console.debug(options);

    const client = this.#webDAVClientMap[fileSystemId];
    const stats = await client.getDirectoryContents(directoryPath) as any[];
    const metadataList = stats.map(fromStat);
    const metadataCache = this.#metadataCacheMap[fileSystemId];
    metadataCache.put(directoryPath, metadataList);
    const hasMore = false;
    return [metadataList.map(metadata =>
      canonicalizedMetadata(metadata, options)), hasMore];
  }

  async onGetMetadataRequested(
    options: chrome.fileSystemProvider.MetadataRequestedEventOptions
  ) {
    const { fileSystemId, entryPath, thumbnail } = options;
    console.log(`WebDAVFS.onGetMetadataRequested: entryPath=${entryPath}, thumbnail=${thumbnail}`);
    console.debug(options);

    if (thumbnail) throw new Error('Thumbnail not supported');

    const client = this.#webDAVClientMap[fileSystemId];
    const metadataCache = this.#metadataCacheMap[fileSystemId];
    const cache = metadataCache.get(entryPath);
    if (cache.metadata && cache.directoryExists && cache.fileExists)
      return [canonicalizedMetadata(cache.metadata, options)];

    const stat = await client.stat(entryPath);
    console.debug(stat);
    return [canonicalizedMetadata(fromStat(stat), options)];
  }

  async onOpenFileRequested(
    options: chrome.fileSystemProvider.OpenFileRequestedEventOptions
  ) {
    const { requestId, filePath, mode } = options;
    console.log(`WebDAVFS.onOpenFileRequested: requestId=${requestId}, filePath='${filePath}', mode=${mode}`);
    console.debug(options);

    const buffer = new ArrayBuffer(0);

    this.#openedFilesMap[requestId] = { filePath, mode, buffer };
  }

  async onCloseFileRequested(
    options: chrome.fileSystemProvider.OpenedFileRequestedEventOptions
  ) {
    const { fileSystemId, openRequestId } = options;
    const { filePath, mode, buffer } = this.#openedFilesMap[openRequestId];
    console.log(`WebDAVFS.onCloseFileRequested: openRequestId=${openRequestId}, filePath='${filePath}', mode=${mode}`);


    if (mode === 'WRITE') {
      const client = this.#webDAVClientMap[fileSystemId];
      await client.putFileContents(filePath, buffer);
    }

    delete this.#openedFilesMap[openRequestId];
  }

  async onReadFileRequested(
    options: chrome.fileSystemProvider.OpenedFileOffsetRequestedEventOptions
  ) {
    const { fileSystemId, openRequestId, offset, length } = options;
    const { filePath } = this.#openedFilesMap[openRequestId];
    console.log(`WebDAVFS.onReadFileRequested: openRequestId=${openRequestId}, filePath='${filePath}', offset=${offset}, length=${length}`);
    console.debug(options);

    const client = this.#webDAVClientMap[fileSystemId];
    const url = new URL(client.getFileDownloadLink(filePath));
    const url_ = url.origin + url.pathname;

    const { username, password } = url;
    const credential = `${username}:${password}`;

    const headers = new Headers();
    headers.set('Authorization', `Basic ${btoa(credential)}`);
    // HTTP range requests
    // https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
    headers.set('Range', `bytes=${offset}-${offset + length - 1}`);

    const response = await fetch(url_, { headers });
    console.log(`WebDAVFS.onReadFileRequested: Content-Range: ${response.headers.get('Content-Range')}`);
    const buffer = await response.arrayBuffer();
    const hasMore = false;
    return [buffer, hasMore];
  }

  async onWriteFileRequested(
    options: chrome.fileSystemProvider.OpenedFileIoRequestedEventOptions
  ) {
    const { openRequestId, offset, data } = options;
    const { filePath, buffer } = this.#openedFilesMap[openRequestId];
    console.log(`WebDAVFS.onWriteFileRequested: openRequestId=${openRequestId}, filePath='${filePath}', offset=${offset}, data.byteLength=${data.byteLength}`);

    const typed = new Uint8Array(new ArrayBuffer(offset + data.byteLength));
    typed.set(new Uint8Array(buffer));
    typed.set(new Uint8Array(data), offset);
    this.#openedFilesMap[openRequestId].buffer = typed.buffer;
  }

  async onCreateDirectoryRequested(
    options: chrome.fileSystemProvider.DirectoryPathRecursiveRequestedEventOptions
  ) {
    const { fileSystemId, directoryPath } = options;
    console.log(`WebDAVFS.onCreateDirectoryRequested: directoryPath=${directoryPath}`);
    console.debug(options);

    const client = this.#webDAVClientMap[fileSystemId];
    await client.createDirectory(directoryPath);
  }

  async onDeleteEntryRequested(
    options: chrome.fileSystemProvider.EntryPathRecursiveRequestedEventOptions
  ) {
    const { fileSystemId, entryPath } = options;
    console.log(`WebDAVFS.onDeleteEntryRequested: entryPath=${entryPath}`);

    const client = this.#webDAVClientMap[fileSystemId];
    client.deleteFile(entryPath);

    const metadataCache = this.#metadataCacheMap[fileSystemId];
    metadataCache.remove(entryPath);
  }

  async onCreateFileRequested(
    options: chrome.fileSystemProvider.FilePathRequestedEventOptions
  ) {
    const { fileSystemId, filePath } = options;
    console.log(`WebDAVFS.onCreateFileRequested: filePath=${filePath}`);

    const client = this.#webDAVClientMap[fileSystemId];
    await client.putFileContents(filePath, new ArrayBuffer(0));

    const metadataCache = this.#metadataCacheMap[fileSystemId];
    metadataCache.remove(filePath);
  }

  async onCopyEntryRequested(
    options: chrome.fileSystemProvider.SourceTargetPathRequestedEventOptions
  ) {
    const { fileSystemId, sourcePath, targetPath } = options;
    console.log(`WebDAVFS.onCopyEntryRequested: sourcePath=${sourcePath}, targetPath=${targetPath}`);

    const client = this.#webDAVClientMap[fileSystemId];
    await client.copyFile(sourcePath, targetPath);

    const metadataCache = this.#metadataCacheMap[fileSystemId];
    metadataCache.remove(sourcePath);
    metadataCache.remove(targetPath);
  }

  async onMoveEntryRequested(
    options: chrome.fileSystemProvider.SourceTargetPathRequestedEventOptions
  ) {
    const { fileSystemId, sourcePath, targetPath } = options;
    console.log(`WebDAVFS.onMoveEntryRequested: sourcePath=${sourcePath}, targetPath=${targetPath}`);

    const client = this.#webDAVClientMap[fileSystemId];
    await client.moveFile(sourcePath, targetPath);

    const metadataCache = this.#metadataCacheMap[fileSystemId];
    metadataCache.remove(sourcePath);
    metadataCache.remove(targetPath);
  }

  async onTruncateRequested(
    options: chrome.fileSystemProvider.FilePathLengthRequestedEventOptions
  ) {
    const { fileSystemId, filePath, length } = options;
    console.log(`WebDAVFS.onTruncateRequested: filePath=${filePath}, length=${length}`);

    const client = this.#webDAVClientMap[fileSystemId];
    const buffer = await client.getFileContents(filePath);
    await client.putFileContents(buffer.slice(0, length));
  }

  async onAbortRequested(
    options: chrome.fileSystemProvider.OperationRequestedEventOptions
  ) {
    const { operationRequestId } = options;
    console.log(`WebDAVFS.onAbortRequested: operationRequestId=${operationRequestId}`)
  }

  #assignEventHandlers = () => {
    for (const name of Object.getOwnPropertyNames(WebDAVFS.prototype)) {
      if (!name.match(/^on/)) continue;

      (chrome.fileSystemProvider as any)[name].addListener(
        (options: any, successCallback: Function, errorCallback: Function) => {
          (this as any)[name](options).then((result: void | Array<any>) => {
            successCallback(...(result || []));
          }).catch((error: any) => {
            if (error instanceof Error) console.error(error);
            let reason = error instanceof String ? error : 'FAILED';
            if (error.message === 'Request failed with status code 404')
              reason = 'NOT_FOUND';
            errorCallback(reason);
          });
        }
      );
    }
  };

  #resume = async () => {
    console.log('WebDAVFS.resume');

    for (const { url, username, password } of await getMountedCredentials()) {
      const client = WebDAV.createClient(url, { username, password });

      const fileSystemId = createFileSystemID(url, username);
      this.#webDAVClientMap[fileSystemId] = client;
      this.#metadataCacheMap[fileSystemId] = new MetadataCache();
    }
  };
}

async function storeMountedCredential(
  fileSystemId: string, credential: Credential
) {
  let { mountedCredentials } = await browser.storage.local.get();
  mountedCredentials = mountedCredentials || {};
  mountedCredentials[fileSystemId] = credential;
  await browser.storage.local.set({ mountedCredentials });
}

async function removeMountedCredential(fileSystemId: string) {
  const { mountedCredentials } = await browser.storage.local.get();
  if (!mountedCredentials) return;
  delete mountedCredentials[fileSystemId];
  await browser.storage.local.set({ mountedCredentials });
}

async function getMountedCredentials(): Promise<Credential[]> {
  const { mountedCredentials } = await browser.storage.local.get();
  return Object.values(mountedCredentials || {});
}

function createFileSystemID(url: string, username: string) {
  return `webdavfs://${username}/${url}`;
}

function fromStat(stat: any): chrome.fileSystemProvider.EntryMetadata {
  const { basename, lastmod, size, type, mime } = stat;
  return {
    isDirectory: type === 'directory',
    name: basename,
    size: size,
    modificationTime: new Date(lastmod),
    mimeType: mime,
  };
}

function canonicalizedMetadata(
  metadata: chrome.fileSystemProvider.EntryMetadata, options: any
): chrome.fileSystemProvider.EntryMetadata {
  const _metadata: any = Object.assign({}, metadata);
  for (const key of Object.keys(metadata)) {
    if (!options[key]) delete _metadata[key];
  }
  return _metadata;
}

// window.WebDAVFS = WebDAVFS;
