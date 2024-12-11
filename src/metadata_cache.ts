export default class MetadataCache {
  #directories: { [directoryPath: string]: { [name: string]: chrome.fileSystemProvider.EntryMetadata } } = {};

  put(
    directoryPath: string,
    metadataList: chrome.fileSystemProvider.EntryMetadata[]
  ) {
    this.#directories[directoryPath] =
      Object.fromEntries(metadataList.map(metadata => [metadata.name, metadata]));
  }

  get(entryPath: string) { 
    if (entryPath === "/") {
      return {
        needFetch: true,
        exists: true
      };
    } else {
      var lastDelimiterPos = entryPath.lastIndexOf("/");
      var directoryPath;
      var name;
      if (lastDelimiterPos === 0) {
        directoryPath = "/";
        name = entryPath.substring(1);
      } else {
        directoryPath = entryPath.substring(0, lastDelimiterPos);
        name = entryPath.substring(lastDelimiterPos + 1);
      }
      var entries = this.#directories[directoryPath];
      if (entries) {
        var entry = entries[name];
        if (entry) {
          return {
            directoryExists: true,
            fileExists: true,
            metadata: entry
          };
        } else {
          return {
            directoryExists: true,
            fileExists: false
          };
        }
      } else {
        return {
          directoryExists: false,
          fileExists: false
        };
      }
    }
  }

  remove(entryPath: string) {
    for (var key in this.#directories) {
      if (key.indexOf(entryPath) === 0) {
        delete this.#directories[key];
      }
    }
    var lastDelimiterPos = entryPath.lastIndexOf("/");
    if (lastDelimiterPos !== 0) {
      delete this.#directories[entryPath.substring(0, lastDelimiterPos)];
    }
  }
}
