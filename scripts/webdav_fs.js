'use strict';

(() => {
  class WebDAVFS {
    #webDAVClientMap = {};
    #openedFilesMap = {};
    #metadataCacheMap = {};

    constructor() {
      this.#assignEventHandlers();
      this.#resume();
    }

    async isMounted(url, username) {
      const fileSystemId = createFileSystemID(url, username);
      return await browser.fileSystemProvider.get(fileSystemId) || false;
    }

    async mount(options) {
      console.log('WebDAVFS.mount')

      const { name, url, username, password } = options;
      if (await this.isMounted(url, username)) return;

      const client = WebDAV.createClient(url, { username, password });
      await client.getDirectoryContents('/'); // connect and authenticate

      const fileSystemId = createFileSystemID(url, username);
      await browser.fileSystemProvider.mount(
        { fileSystemId, displayName: name, writable: true }
      );

      this.#webDAVClientMap[fileSystemId] = client;
      this.#openedFilesMap[fileSystemId] = {};
      this.#metadataCacheMap[fileSystemId] = new MetadataCache();

      await storeMountedCredential(fileSystemId, options);
    }

    async resumeMounts() {
      for (const { name, url, username, password } of await getMountedCredentials()) {
        const client = WebDAV.createClient(url, { username, password });
        await client.getDirectoryContents('/'); // connect and authenticate

        const fileSystemId = createFileSystemID(url, username);
        await browser.fileSystemProvider.mount(
          { fileSystemId, displayName: name, writable: true }
        );

        this.#webDAVClientMap[fileSystemId] = client;
        this.#openedFilesMap[fileSystemId] = {};
        this.#metadataCacheMap[fileSystemId] = new MetadataCache();
      }
    }

    async onUnmountRequested(options) {
      console.log("WebDAVFS.onUnmountRequested");

      const { fileSystemId } = options;
      await browser.fileSystemProvider.unmount({ fileSystemId });

      delete this.#webDAVClientMap[fileSystemId];
      delete this.#openedFilesMap[fileSystemId];
      delete this.#metadataCacheMap[fileSystemId];

      await removeMountedCredential(fileSystemId);
    }

    async onReadDirectoryRequested(options) {
      const { fileSystemId, directoryPath } = options;
      console.log(`WebDAVFS.onReadDirectoryRequested: directoryPath=${directoryPath}`);
      console.debug(options);

      const client = this.#webDAVClientMap[fileSystemId];
      const stats = await client.getDirectoryContents(directoryPath);
      const metadataList = stats.map(fromStat);
      const metadataCache = this.#metadataCacheMap[fileSystemId];
      metadataCache.put(directoryPath, metadataList);
      const hasMore = false;
      return [metadataList.map(metadata => canonicalizedMetadata(metadata, options)), hasMore];
    }

    async onGetMetadataRequested(options) {
      const { fileSystemId, entryPath, thumbnail } = options;
      console.log(`WebDAVFS.onGetMetadataRequested: entryPath=${entryPath}, thumbnail=${thumbnail}`);
      console.debug(options);

      if (thumbnail) throw new Error('Thumbnail not supported');

      const client = this.#webDAVClientMap[fileSystemId];
      const metadataCache = this.#metadataCacheMap[fileSystemId];
      const cache = metadataCache.get(entryPath);
      if (cache.directoryExists && cache.fileExists)
        return [canonicalizedMetadata(cache.metadata, options)];

      const stat = await client.stat(entryPath);
      console.debug(stat);
      return [canonicalizedMetadata(fromStat(stat), options)];
    }

    async onOpenFileRequested(options) {
      const { fileSystemId, requestId, filePath, mode } = options;
      console.log(`WebDAVFS.onOpenFileRequested: requestId=${requestId}, filePath=${filePath}, mode=${mode}`);
      console.debug(options);

      let buffer;
      switch (mode) {
      case 'READ':
        const client = this.#webDAVClientMap[fileSystemId];
        buffer = await client.getFileContents(filePath);
        break;
      case 'WRITE':
        buffer = new ArrayBuffer(0);
        break;
      }

      this.#openedFilesMap[fileSystemId][requestId] = { filePath, mode, buffer };
    }

    async onCloseFileRequested(options) {
      const { fileSystemId, openRequestId } = options;
      console.log(`WebDAVFS.onCloseFileRequested: openRequestId=${openRequestId}`);

      const { filePath, mode, buffer } = this.#openedFilesMap[fileSystemId][openRequestId];

      if (mode === 'WRITE') {
        const client = this.#webDAVClientMap[fileSystemId];
        await client.putFileContents(filePath, buffer);
      }

      delete this.#openedFilesMap[fileSystemId][openRequestId];
    }

    async onReadFileRequested(options) {
      const { fileSystemId, openRequestId, offset, length } = options;
      console.log(`WebDAVFS.onReadFileRequested: openRequestId=${openRequestId}, offset=${offset}, length=${length}`);
      console.debug(options);

      const { buffer } = this.#openedFilesMap[fileSystemId][openRequestId];
      const hasMore = false;
      return [buffer.slice(offset, offset + length), hasMore];
    }

    async onCreateDirectoryRequested(options) {
      const { fileSystemId, directoryPath } = options;
      console.log(`WebDAVFS.onCreateDirectoryRequested: directoryPath=${directoryPath}, recursive=${recursive}`);
      console.debug(options);

      const client = this.#webDAVClientMap[fileSystemId];
      await client.createDirectory(directoryPath);
    }

    async onDeleteEntryRequested(options) {
      const { fileSystemId, entryPath } = options;
      console.log(`WebDAVFS.onDeleteEntryRequested: entryPath=${entryPath}`);

      const client = this.#webDAVClientMap[fileSystemId];
      client.deleteFile(entryPath);

      const metadataCache = this.#metadataCacheMap[fileSystemId];
      metadataCache.remove(entryPath);
    }

    async onCreateFileRequested(options) {
      const { fileSystemId, filePath } = options;
      console.log(`WebDAVFS.onCreateFileRequested: filePath=${filePath}`);

      const client = this.#webDAVClientMap[fileSystemId];
      await client.putFileContents(filePath, new ArrayBuffer(0));

      const metadataCache = this.#metadataCacheMap[fileSystemId];
      metadataCache.remove(filePath);
    }

    async onCopyEntryRequested(options) {
      const { fileSystemId, sourcePath, targetPath } = options;
      console.log(`WebDAVFS.onCopyEntryRequested: sourcePath=${sourcePath}, targetPath=${targetPath}`);

      const client = this.#webDAVClientMap[fileSystemId];
      await client.copyFile(sourcePath, targetPath);

      const metadataCache = this.#metadataCacheMap[fileSystemId];
      metadataCache.remove(sourcePath);
      metadataCache.remove(targetPath);
    }

    async onMoveEntryRequested(options) {
      const { fileSystemId, sourcePath, targetPath } = options;
      console.log(`WebDAVFS.onMoveEntryRequested: sourcePath=${sourcePath}, targetPath=${targetPath}`);

      const client = this.#webDAVClientMap[fileSystemId];
      await client.moveFile(sourcePath, targetPath);

      const metadataCache = this.#metadataCacheMap[fileSystemId];
      metadataCache.remove(sourcePath);
      metadataCache.remove(targetPath);
    }

    async onTruncateRequested(options) {
      const { fileSystemId, filePath, length } = options;
      console.log(`WebDAVFS.onTruncateRequested: filePath=${filePath}, length=${length}`);

      const client = this.#webDAVClientMap[fileSystemId];
      const buffer = await client.getFileContents(filePath);
      await client.putFileContents(buffer.slice(0, length));
    }

    async onWriteFileRequested(options) {
      const { fileSystemId, openRequestId, offset, data } = options;
      console.log(`WebDAVFS.onWriteFileRequested: offset=${offset}`);

      const { buffer } = this.#openedFilesMap[fileSystemId][openRequestId];
      const typed = new Uint8Array(new ArrayBuffer(offset + data.byteLength));
      typed.set(new Uint8Array(buffer));
      typed.set(new Uint8Array(data), offset);
      this.#openedFilesMap[fileSystemId][openRequestId].buffer = typed.buffer;
    }

    async onAbortRequested(options) {
      const { fileSystemId, operationRequestId } = options;
      console.log(`WebDAVFS.onAbortRequested: operationRequestId=${operationRequestId}`)
    }

    #assignEventHandlers = () => {
      for (const name of Object.getOwnPropertyNames(WebDAVFS.prototype)) {
        if (!name.match(/^on/)) continue;

        browser.fileSystemProvider[name].addListener(
          (options, successCallback, errorCallback) => {
            this[name](options).then(result => {
              successCallback(...(result || []));
            }).catch(error => {
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
        this.#openedFilesMap[fileSystemId] = {};
        this.#metadataCacheMap[fileSystemId] = {};
      }
    }
  }

  async function storeMountedCredential(fileSystemId, credential) {
    let { mountedCredentials } = await browser.storage.local.get();
    mountedCredentials = mountedCredentials || {};
    mountedCredentials[fileSystemId] = credential;
    await browser.storage.local.set({ mountedCredentials });
  }

  async function removeMountedCredential(fileSystemId) {
    const { mountedCredentials } = await browser.storage.local.get();
    if (!mountedCredentials) return;
    delete mountedCredentials[fileSystemId];
    await browser.storage.local.set({ mountedCredentials });
  }

  async function getMountedCredentials() {
    const { mountedCredentials } = await browser.storage.local.get();
    return Object.values(mountedCredentials || {});
  }

  function createFileSystemID(url, username) {
    return `webdavfs://${username}/${url}`;
  }

  function fromStat(stat) {
    const { basename, lastmod, size, type, mime } = stat;
    return {
      isDirectory: type === 'directory',
      name: basename,
      size: size,
      modificationTime: new Date(lastmod),
      mimeType: mime,
    };
  }

  function canonicalizedMetadata(metadata, options) {
    const _metadata = Object.assign({}, metadata);
    for (const key of Object.keys(metadata)) {
      if (!options[key]) delete _metadata[key];
    }
    return _metadata;
  }

  window.WebDAVFS = WebDAVFS;
})();
