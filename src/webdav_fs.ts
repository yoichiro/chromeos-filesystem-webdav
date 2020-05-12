import { createClient, Client } from 'webdav/web';
import { v1 as uuidv1 } from 'uuid';

import MetadataCache from './metadata_cache';
import Proxy from './proxy';

type ServerType = 'nc' | 'oc'; // Nextcloud/ownCloud
type PathConverter = (path: string) => string;

interface Credential {
  name: string
  domain: string
  server: ServerType
  username: string
  password: string
}

interface FileSystemProps {
  server: ServerType
  client: Client
  metadataCache: MetadataCache
  filePathConverter: PathConverter
  uploadPathConverter: PathConverter
}

interface OpenedFileProps {
  filePath: string
  mode: string
  uuid: string
  buffer: ArrayBuffer
}

export default class WebDAVFS {
  #proxy: Proxy;
  #fileSystemMap: { [fileSystemId: string]: FileSystemProps } = {};
  #openedFilesMap: { [openRequestId: string]: OpenedFileProps } = {};

  constructor(proxy: Proxy) {
    this.#proxy = proxy;
    this.#assignEventHandlers();
    this.#resume();
  }

  async isMounted(domain: string, username: string) {
    const fileSystemId = createFileSystemID(domain, username);
    const fileSystems: chrome.fileSystemProvider.FileSystemInfo[] =
      await new Promise(resolve => {
        chrome.fileSystemProvider.getAll(resolve);
      });
    return !! fileSystems.find(info => info.fileSystemId === fileSystemId);
  }

  async mount(credential: Credential) {
    console.log('WebDAVFS.mount')

    const { name, domain, username } = credential;
    if (await this.isMounted(domain, username)) return;

    this.#proxy.register(domain);

    const props = this.#getFileSystemProps(credential);
    const { client, filePathConverter } = props;
    // test connection and authentication
    await client.getDirectoryContents(filePathConverter('/'));

    const fileSystemId = createFileSystemID(domain, username);
    await new Promise(resolve => chrome.fileSystemProvider.mount(
      { fileSystemId, displayName: name, writable: true }, resolve
    ));

    this.#fileSystemMap[fileSystemId] = props;

    await storeMountedCredential(fileSystemId, credential);
  }

  async resumeMounts() {
    for (const { name, domain, username } of await getMountedCredentials()) {
      const fileSystemId = createFileSystemID(domain, username);
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
    delete this.#fileSystemMap[fileSystemId];

    await removeMountedCredential(fileSystemId);
  }

  async onReadDirectoryRequested(
    options: chrome.fileSystemProvider.DirectoryPathRequestedEventOptions
  ) {
    const { fileSystemId, directoryPath } = options;
    console.log(`WebDAVFS.onReadDirectoryRequested: directoryPath=${directoryPath}`);
    console.debug(options);

    const { client, metadataCache, filePathConverter } =
      this.#fileSystemMap[fileSystemId];
    const stats =
      await client.getDirectoryContents(filePathConverter(directoryPath)) as any[];
    const metadataList = stats.map(fromStat);
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

    const { client, metadataCache, filePathConverter } =
      this.#fileSystemMap[fileSystemId];
    const cache = metadataCache.get(entryPath);
    if (cache.metadata && cache.directoryExists && cache.fileExists)
      return [canonicalizedMetadata(cache.metadata, options)];

    const stat = await client.stat(filePathConverter(entryPath));
    console.debug(stat);
    return [canonicalizedMetadata(fromStat(stat), options)];
  }

  async onOpenFileRequested(
    options: chrome.fileSystemProvider.OpenFileRequestedEventOptions
  ) {
    const { fileSystemId, requestId, filePath, mode } = options;
    console.log(`WebDAVFS.onOpenFileRequested: requestId=${requestId}, filePath='${filePath}', mode=${mode}`);
    console.debug(options);

    const buffer = new ArrayBuffer(0);
    const uuid = uuidv1();
    const { server, client, uploadPathConverter } = this.#fileSystemMap[fileSystemId];

    if (mode === 'WRITE' && server === 'nc') {
      // Nextcloud chunked file upload
      // https://docs.nextcloud.com/server/15/developer_manual/client_apis/WebDAV/chunking.html
      await client.createDirectory(uploadPathConverter(`/${uuid}`));
    }

    this.#openedFilesMap[requestId] = { filePath, mode, uuid, buffer };
  }

  async onCloseFileRequested(
    options: chrome.fileSystemProvider.OpenedFileRequestedEventOptions
  ) {
    const { fileSystemId, openRequestId } = options;
    const { filePath, mode, uuid, buffer } = this.#openedFilesMap[openRequestId];
    console.log(`WebDAVFS.onCloseFileRequested: openRequestId=${openRequestId}, filePath='${filePath}', mode=${mode}`);

    const { server, client, filePathConverter, uploadPathConverter } =
      this.#fileSystemMap[fileSystemId];

    if (mode === 'WRITE') {
      if (server === 'nc') {
        // Nextcloud chunked file upload
        // https://docs.nextcloud.com/server/15/developer_manual/client_apis/WebDAV/chunking.html
        await client.moveFile(
          uploadPathConverter(`/${uuid}/.file`), filePathConverter(filePath)
        );
      } else await client.putFileContents(filePathConverter(filePath), buffer);
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

    const { client, filePathConverter } = this.#fileSystemMap[fileSystemId];
    const url = new URL(client.getFileDownloadLink(filePathConverter(filePath)));
    const url_ = url.origin + url.pathname;

    const credential = [url.username, url.password].map(decodeURIComponent).join(':');

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
    const { fileSystemId, openRequestId, offset, data } = options;
    const { filePath, uuid, buffer } = this.#openedFilesMap[openRequestId];
    console.log(`WebDAVFS.onWriteFileRequested: openRequestId=${openRequestId}, filePath='${filePath}', offset=${offset}, data.byteLength=${data.byteLength}`);

    const { server, client, uploadPathConverter } =
      this.#fileSystemMap[fileSystemId];

    if (server === 'nc') {
      // Nextcloud chunked file upload
      // https://docs.nextcloud.com/server/15/developer_manual/client_apis/WebDAV/chunking.html
      const end = offset + data.byteLength - 1;
      const uploadPath = `/${uuid}/${paddedIndex(offset)}-${paddedIndex(end)}`;

      console.log(`WebDAVFS.onWriteFileRequested: uploadPath: ${uploadPath}`);
      await client.putFileContents(uploadPathConverter(uploadPath), data);
    } else {
      const typed = new Uint8Array(new ArrayBuffer(offset + data.byteLength));
      typed.set(new Uint8Array(buffer));
      typed.set(new Uint8Array(data), offset);
      this.#openedFilesMap[openRequestId].buffer = typed.buffer;
    }
  }

  async onCreateDirectoryRequested(
    options: chrome.fileSystemProvider.DirectoryPathRecursiveRequestedEventOptions
  ) {
    const { fileSystemId, directoryPath } = options;
    console.log(`WebDAVFS.onCreateDirectoryRequested: directoryPath=${directoryPath}`);
    console.debug(options);

    const { client, metadataCache, filePathConverter } = this.#fileSystemMap[fileSystemId];
    await client.createDirectory(filePathConverter(directoryPath));

    metadataCache.remove(directoryPath);
  }

  async onDeleteEntryRequested(
    options: chrome.fileSystemProvider.EntryPathRecursiveRequestedEventOptions
  ) {
    const { fileSystemId, entryPath } = options;
    console.log(`WebDAVFS.onDeleteEntryRequested: entryPath=${entryPath}`);

    const { client, metadataCache, filePathConverter } = this.#fileSystemMap[fileSystemId];
    client.deleteFile(filePathConverter(entryPath));

    metadataCache.remove(entryPath);
  }

  async onCreateFileRequested(
    options: chrome.fileSystemProvider.FilePathRequestedEventOptions
  ) {
    const { fileSystemId, filePath } = options;
    console.log(`WebDAVFS.onCreateFileRequested: filePath=${filePath}`);

    const { client, metadataCache, filePathConverter } = this.#fileSystemMap[fileSystemId];
    const data = new ArrayBuffer(0);
    await client.putFileContents(filePathConverter(filePath), data);

    metadataCache.remove(filePath);
  }

  async onCopyEntryRequested(
    options: chrome.fileSystemProvider.SourceTargetPathRequestedEventOptions
  ) {
    const { fileSystemId, sourcePath, targetPath } = options;
    console.log(`WebDAVFS.onCopyEntryRequested: sourcePath=${sourcePath}, targetPath=${targetPath}`);

    const { client, metadataCache, filePathConverter } = this.#fileSystemMap[fileSystemId];
    await client.copyFile(filePathConverter(sourcePath), filePathConverter(targetPath));

    metadataCache.remove(sourcePath);
    metadataCache.remove(targetPath);
  }

  async onMoveEntryRequested(
    options: chrome.fileSystemProvider.SourceTargetPathRequestedEventOptions
  ) {
    const { fileSystemId, sourcePath, targetPath } = options;
    console.log(`WebDAVFS.onMoveEntryRequested: sourcePath=${sourcePath}, targetPath=${targetPath}`);

    const { client, metadataCache, filePathConverter } = this.#fileSystemMap[fileSystemId];
    await client.moveFile(filePathConverter(sourcePath), filePathConverter(targetPath));

    metadataCache.remove(sourcePath);
    metadataCache.remove(targetPath);
  }

  async onTruncateRequested(
    options: chrome.fileSystemProvider.FilePathLengthRequestedEventOptions
  ) {
    const { filePath, length } = options;
    console.log(`WebDAVFS.onTruncateRequested: filePath=${filePath}, length=${length}`);
    // do nothing
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

    for (const credential of await getMountedCredentials()) {
      const { domain, username } = credential;
      const fileSystemId = createFileSystemID(domain, username);
      this.#fileSystemMap[fileSystemId] = this.#getFileSystemProps(credential);
      this.#proxy.register(domain);
    }
  };

  #getFileSystemProps = (credential: Credential) => {
    const { domain, server, username, password } = credential;

    const url = `https://${domain}/remote.php/dav/`;
    const client = createClient(url, { username, password });
    const metadataCache = new MetadataCache();
    const filePathConverter: PathConverter =
      path => `/files/${username}${path}`;
    const uploadPathConverter: PathConverter =
      path => `/uploads/${username}${path}`;

    return {
      server, client, metadataCache, filePathConverter, uploadPathConverter,
    };
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

function createFileSystemID(domain: string, username: string) {
  return `webdavfs://${domain}/${username}`;
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

function paddedIndex(index: number) {
  const padding = '000000000000000';
  const length = padding.length;

  return (padding + String(index)).slice(-length);
}
