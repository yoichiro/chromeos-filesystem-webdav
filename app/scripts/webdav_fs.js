"use strict";

(function() {

    // Constructor

    var WebDavFS = function() {
        this.webDavClientMap_ = {};
        this.opened_files_ = {};
        this.metadataCache_ = {};
        assignEventHandlers.call(this);
    };

    // Public functions

    WebDavFS.prototype.mount = function(options) {
        var fileSystemId = createFileSystemID.call(this, options.url, options.username);
        var webDavClient = new WebDavClient(
            this, options.url, options.authType, options.username, options.password);
        webDavClient.checkRootPath({
            onSuccess: function() {
                this.webDavClientMap_[fileSystemId] = webDavClient;
                doMount.call(
                    this,
                    webDavClient.getUrl(),
                    webDavClient.getAuthType(),
                    webDavClient.getUsername(),
                    webDavClient.getPassword(),
                    function() {
                        options.onSuccess();
                    }.bind(this));
            }.bind(this),
            onError: function(error) {
                options.onError(error);
            }.bind(this)
        });
    };

    WebDavFS.prototype.resume = function(fileSystemId, onSuccess, onError) {
        console.log("resume - start");
        getMountedCredential.call(this, fileSystemId, function(credential) {
            if (credential) {
                this.mount({
                    url: credential.url,
                    authType: credential.authType,
                    username: credential.username,
                    password: credential.password,
                    onSuccess: function() {
                        onSuccess();
                    }.bind(this),
                    onError: function(reason) {
                        onError(reason);
                    }.bind(this)
                });
            } else {
                onError("Credential[" + fileSystemId + "] not found");
            }
        }.bind(this));
    };

    WebDavFS.prototype.onUnmountRequested = function(options, successCallback, errorCallback) {
        console.log("onUnmountRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        doUnmount.call(this, webDavClient, options.requestId, successCallback);
    };

    WebDavFS.prototype.onReadDirectoryRequested = function(options, successCallback, errorCallback) {
        console.log("onReadDirectoryRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.readDirectory({
            path: options.directoryPath,
            onSuccess: function(result) {
                console.log(result);
                var metadataCache = getMetadataCache.call(this, options.fileSystemId);
                metadataCache.put(options.directoryPath, result.metadataList);
                successCallback(result.metadataList, false);
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onGetMetadataRequested = function(options, successCallback, errorCallback) {
        console.log("onGetMetadataRequested: thumbnail=" + options.thumbnail);
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        var metadataCache = getMetadataCache.call(this, options.fileSystemId);
        var cache = metadataCache.get(options.entryPath);
        if (cache.directoryExists && cache.fileExists) {
            successCallback(cache.metadata);
        } else {
            webDavClient.getMetadata({
                path: options.entryPath,
                onSuccess: function(result) {
                    console.log(result);
                    successCallback(result.metadata);
                }.bind(this),
                onError: function(reason) {
                    console.log(reason);
                    if (reason === "NOT_FOUND") {
                        errorCallback("NOT_FOUND");
                    } else {
                        errorCallback("FAILED");
                    }
                }.bind(this)
            });
        }
    };

    WebDavFS.prototype.onOpenFileRequested = function(options, successCallback, errorCallback) {
        console.log("onOpenFileRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.openFile(options.filePath, options.requestId, options.mode, function() {
            var openedFiles = getOpenedFiles.call(this, options.fileSystemId);
            openedFiles[options.requestId] = options.filePath;
            successCallback();
        }.bind(this), errorCallback);
    };

    WebDavFS.prototype.onReadFileRequested = function(options, successCallback, errorCallback) {
        console.log("onReadFileRequested - start");
        console.log(options);
        var filePath = getOpenedFiles.call(this, options.fileSystemId)[options.openRequestId];
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        var cache = metadataCache.get(filePath);
        var read_len = options.length;
        if (cache.directoryExists && cache.fileExists) {
            if (options.offset + options.length > cache.metadata.size) {
                read_len = cache.metadata.size - options.offset;
                if (read_len <= 0) {
                    successCallback(new ArrayBuffer(0), false);
                    return;
                }
            }
        }
        webDavClient.readFile({
            path: filePath,
            offset: options.offset,
            length: read_len,
            onSuccess: function(result) {
                console.log(result);
                successCallback(result.data, result.hasMore);
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onCloseFileRequested = function(options, successCallback, errorCallback) {
        console.log("onCloseFileRequested");
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        var filePath = getOpenedFiles.call(this, options.fileSystemId)[options.openRequestId];
        webDavClient.closeFile({
            path: filePath,
            openRequestId: options.openRequestId,
            onSuccess: function() {
                delete this.opened_files_[options.openRequestId];
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }.bind(this)
        });
    };

    WebDavFS.prototype.onCreateDirectoryRequested = function(options, successCallback, errorCallback) {
        console.log("onCreateDirectoryRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.createDirectory({
            path: options.directoryPath,
            onSuccess: function() {
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onDeleteEntryRequested = function(options, successCallback, errorCallback) {
        console.log("onDeleteEntryRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.deleteEntry({
            path: options.entryPath,
            onSuccess: function() {
                var metadataCache = getMetadataCache.call(this, options.fileSystemId);
                metadataCache.remove(options.entryPath);
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onMoveEntryRequested = function(options, successCallback, errorCallback) {
        console.log("onMoveEntryRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.moveEntry({
            sourcePath: options.sourcePath,
            targetPath: options.targetPath,
            onSuccess: function() {
                var metadataCache = getMetadataCache.call(this, options.fileSystemId);
                metadataCache.remove(options.sourcePath);
                metadataCache.remove(options.targetPath);
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onCopyEntryRequested = function(options, successCallback, errorCallback) {
        console.log("onCopyEntryRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.copyEntry({
            sourcePath: options.sourcePath,
            targetPath: options.targetPath,
            onSuccess: function() {
                var metadataCache = getMetadataCache.call(this, options.fileSystemId);
                metadataCache.remove(options.sourcePath);
                metadataCache.remove(options.targetPath);
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onWriteFileRequested = function(options, successCallback, errorCallback) {
        console.log("onWriteFileRequested");
        console.log(options);
        var filePath = getOpenedFiles.call(this, options.fileSystemId)[options.openRequestId];
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.writeFile({
            path: filePath,
            offset: options.offset,
            data: options.data,
            openRequestId: options.openRequestId,
            onSuccess: function() {
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onTruncateRequested = function(options, successCallback, errorCallback) {
        console.log("onTruncateRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.truncate({
            path: options.filePath,
            length: options.length,
            onSuccess: function() {
                successCallback(false);
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.onCreateFileRequested = function(options, successCallback, errorCallback) {
        console.log("onCreateFileRequested");
        console.log(options);
        var webDavClient = getWebDavClient.call(this, options.fileSystemId);
        webDavClient.createFile({
            path: options.filePath,
            onSuccess: function() {
                var metadataCache = getMetadataCache.call(this, options.fileSystemId);
                metadataCache.remove(options.filePath);
                successCallback();
            }.bind(this),
            onError: function(reason) {
                console.log(reason);
                errorCallback("FAILED");
            }
        });
    };

    WebDavFS.prototype.checkAlreadyMounted = function(url, username, callback) {
        var fileSystemId = createFileSystemID.call(this, url, username);
        chrome.fileSystemProvider.getAll(function(fileSystems) {
            for (var i = 0; i < fileSystems.length; i++) {
                if (fileSystems[i].fileSystemId === fileSystemId) {
                    callback(true);
                    return;
                }
            }
            callback(false);
        }.bind(this));
    };

    // Private functions

    var doMount = function(url, authType, username, password, callback) {
        this.checkAlreadyMounted(url, username, function(exists) {
            if (!exists) {
                var fileSystemId = createFileSystemID.call(this, url, username);
                var displayName = url;
                displayName += " (" + username + ")";
                registerMountedCredential(
                    url, authType, username, password,
                    function() {
                        chrome.fileSystemProvider.mount({
                            fileSystemId: fileSystemId,
                            displayName: displayName,
                            writable: true
                        }, function() {
                            callback();
                        }.bind(this));
                    }.bind(this));
            } else {
                callback();
            }
        }.bind(this));
    };

    var doUnmount = function(webDavClient, requestId, successCallback) {
        console.log("doUnmount");
        _doUnmount.call(
            this,
            webDavClient.getUrl(),
            webDavClient.getUsername(),
            function() {
                successCallback();
            }.bind(this));
    };

    var _doUnmount = function(url, username, successCallback) {
        console.log("_doUnmount");
        unregisterMountedCredential.call(
            this, url, username,
            function() {
                var fileSystemId = createFileSystemID.call(this, url, username);
                console.log(fileSystemId);
                chrome.fileSystemProvider.unmount({
                    fileSystemId: fileSystemId
                }, function() {
                    delete this.webDavClientMap_[fileSystemId];
                    deleteMetadataCache.call(this, fileSystemId);
                    successCallback();
                }.bind(this));
            }.bind(this));
    };

    var registerMountedCredential = function(
            url, authType, username, password, callback) {
        var fileSystemId = createFileSystemID.call(this, url, username);
        chrome.storage.local.get("mountedCredentials", function(items) {
            var mountedCredentials = items.mountedCredentials || {};
            mountedCredentials[fileSystemId] = {
                url: url,
                authType: authType,
                username: username,
                password: password
            };
            chrome.storage.local.set({
                mountedCredentials: mountedCredentials
            }, function() {
                callback();
            }.bind(this));
        }.bind(this));
    };

    var unregisterMountedCredential = function(url, username, callback) {
        var fileSystemId = createFileSystemID.call(this, url, username);
        chrome.storage.local.get("mountedCredentials", function(items) {
            var mountedCredentials = items.mountedCredentials || {};
            delete mountedCredentials[fileSystemId];
            chrome.storage.local.set({
                mountedCredentials: mountedCredentials
            }, function() {
                callback();
            }.bind(this));
        }.bind(this));
    };

    var getMountedCredential = function(fileSystemId, callback) {
        chrome.storage.local.get("mountedCredentials", function(items) {
            var mountedCredentials = items.mountedCredentials || {};
            var credential = mountedCredentials[fileSystemId];
            callback(credential);
        }.bind(this));
    };

    var createFileSystemID = function(url, username) {
        var id = "webdavfs://" + username + "/" + url;
        return id;
    };

    var createEventHandler = function(callback) {
        return function(options, successCallback, errorCallback) {
            var fileSystemId = options.fileSystemId;
            var webDavClient = getWebDavClient.call(this, fileSystemId);
            if (!webDavClient) {
                this.resume(fileSystemId, function() {
                    callback(options, successCallback, errorCallback);
                }.bind(this), function(reason) {
                    console.log("resume failed: " + reason);
                    chrome.notifications.create("", {
                        type: "basic",
                        title: "WebDAV File System",
                        message: "Resuming connection failed.",
                        iconUrl: "/icons/48.png"
                    }, function(notificationId) {
                        errorCallback("FAILED");
                    }.bind(this));
                }.bind(this));
            } else {
                callback(options, successCallback, errorCallback);
            }
        }.bind(this);
    };

    var assignEventHandlers = function() {
        chrome.fileSystemProvider.onUnmountRequested.addListener(
            function(options, successCallback, errorCallback) { // Unmount immediately
                var fileSystemId = options.fileSystemId;
                var webDavClient = getWebDavClient.call(this, fileSystemId);
                if (!webDavClient) {
                    this.resume(fileSystemId, function() {
                        this.onUnmountRequested(options, successCallback, errorCallback);
                    }.bind(this), function(reason) {
                        console.log("resume failed: " + reason);
                        errorCallback("FAILED");
                    }.bind(this));
                } else {
                    this.onUnmountRequested(options, successCallback, errorCallback);
                }
            }.bind(this));
        chrome.fileSystemProvider.onReadDirectoryRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onReadDirectoryRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onGetMetadataRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onGetMetadataRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onOpenFileRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onOpenFileRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onReadFileRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onReadFileRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onCloseFileRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onCloseFileRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onCreateDirectoryRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onCreateDirectoryRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onDeleteEntryRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onDeleteEntryRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onMoveEntryRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onMoveEntryRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onCopyEntryRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onCopyEntryRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onWriteFileRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onWriteFileRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onTruncateRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onTruncateRequested(options, successCallback, errorCallback);
            }.bind(this)));
        chrome.fileSystemProvider.onCreateFileRequested.addListener(
            createEventHandler.call(this, function(options, successCallback, errorCallback) {
                this.onCreateFileRequested(options, successCallback, errorCallback);
            }.bind(this)));
    };

    var getWebDavClient = function(fileSystemID) {
        var webDavClient = this.webDavClientMap_[fileSystemID];
        return webDavClient;
    };

    var getOpenedFiles = function(fileSystemId) {
        var openedFiles = this.opened_files_[fileSystemId];
        if (!openedFiles) {
            openedFiles = {};
            this.opened_files_[fileSystemId] = openedFiles;
        }
        return openedFiles;
    };

    var getMetadataCache = function(fileSystemId) {
        var metadataCache = this.metadataCache_[fileSystemId];
        if (!metadataCache) {
            metadataCache = new MetadataCache();
            this.metadataCache_[fileSystemId] = metadataCache;
            console.log("getMetadataCache: Created. " + fileSystemId);
        }
        return metadataCache;
    };

    var deleteMetadataCache = function(fileSystemId) {
        console.log("deleteMetadataCache: " + fileSystemId);
        delete this.metadataCache_[fileSystemId];
    };

    // Export

    window.WebDavFS = WebDavFS;

})();
