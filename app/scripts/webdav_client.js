"use strict";

(function() {

    // Constructor

    var WebDavClient = function(webDavFS, url, authType, username, password) {
        this.webdav_fs_ = webDavFS;
        this.url_ = url;
        this.authType_ = authType;
        this.username_ = username;
        this.password_ = password;
        this.writeRequestMap = {};
        this.rootPath_ = null;
        initializeJQueryAjaxBinaryHandler.call(this);
    };

    // Public functions

    WebDavClient.prototype.getUrl = function() {
        return this.url_;
    };

    WebDavClient.prototype.getAuthType = function() {
        return this.authType_;
    };

    WebDavClient.prototype.getUsername = function() {
        return this.username_;
    };

    WebDavClient.prototype.getPassword = function() {
        return this.password_;
    };

    WebDavClient.prototype.getRootPath = function() {
        return this.rootPath_;
    };
    
    // options: onSuccess, onError
    WebDavClient.prototype.checkRootPath = function(options) {
        var headers = createHeaders.call(this, {
            "Content-Type": "text/xml; charset=UTF-8",
            "Depth": 0
        });
        $.ajax({
            type: "PROPFIND",
            url: this.getUrl(),
            headers: headers,
            dataType: "xml"
        }).done(function(result) {
            this.rootPath_ = removeLastSlash.call(this, select.call(this, result, "href"));
            console.log("rootPath: " + this.rootPath_);
            options.onSuccess();
        }.bind(this)).fail(function(error) {
            console.log(error);
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: path, onSuccess, onError
    WebDavClient.prototype.getMetadata = function(options) {
        var headers = createHeaders.call(this, {
            "Content-Type": "text/xml; charset=UTF-8",
            "Depth": 0
        });
        $.ajax({
            type: "PROPFIND",
            url: this.getUrl() + encodePath(options.path),
            headers: headers,
            dataType: "xml"
        }).done(function(result) {
            var metadata = createMetadata.call(this, result);
            options.onSuccess({
                metadata: metadata
            });
        }.bind(this)).fail(function(error) {
            console.log(error);
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: path, onSuccess, onError
    WebDavClient.prototype.readDirectory = function(options) {
        var headers = createHeaders.call(this, {
            "Content-Type": "text/xml; charset=UTF-8",
            "Depth": 1
        });
        $.ajax({
            type: "PROPFIND",
            url: this.getUrl() + encodePath(options.path),
            headers: headers,
            dataType: "xml"
        }).done(function(result) {
            console.log(result);
            var responses = elements.call(this, result, "response");
            var metadataList = [];
            // First element should be ignored because it is the parent directory.
            if (responses.length > 1) {
                for (var i = 1; i < responses.length; i++) {
                    var metadata = createMetadata.call(this, responses[i]);
                    metadataList.push(metadata);
                }
            }
            options.onSuccess({
                metadataList: metadataList
            });
        }.bind(this)).fail(function(error) {
            console.log(error);
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    WebDavClient.prototype.openFile = function(filePath, requestId, mode, successCallback, errorCallback) {
        this.writeRequestMap[requestId] = {
            mode: mode
        };
        successCallback();
    };

    // options: path, openRequestId, onSuccess, onError
    WebDavClient.prototype.closeFile = function(options) {
        var writeRequest = this.writeRequestMap[options.openRequestId];
        if (writeRequest && writeRequest.mode === "WRITE") {
            var localFileName = writeRequest.localFileName;
            var errorHandler = function(error) {
                console.log("writeFile failed");
                console.log(error);
                options.onError("FAILED");
            }.bind(this);
            window.requestFileSystem  = window.requestFileSystem || window.webkitRequestFileSystem;
            window.requestFileSystem(window.TEMPORARY, 100 * 1024 * 1024, function(fs) {
                fs.root.getFile(localFileName, {}, function(fileEntry) {
                    fileEntry.file(function(file) {
                        var totalSize = file.size;
                        var reader = new FileReader();
                        reader.addEventListener("loadend", function() {
                            sendSimpleUpload.call(this, {
                                filePath: options.path,
                                data: reader.result
                            }, function() {
                                fileEntry.remove(function() {
                                    options.onSuccess();
                                }.bind(this), errorHandler);
                            }.bind(this),
                            options.onError);
                        }.bind(this));
                        reader.readAsArrayBuffer(file);
                    }.bind(this));
                }.bind(this), errorHandler);
            }.bind(this), errorHandler);
        } else {
            options.onSuccess();
        }
    };

    // options: path, offset, length, onSuccess, onError
    WebDavClient.prototype.readFile = function(options) {
        var headers = createHeaders.call(this, {
            "Range": "bytes=" + options.offset + "-" + (options.offset + options.length - 1)
        });
        $.ajax({
            type: "GET",
            url: this.getUrl() + encodePath(options.path),
            headers: headers,
            dataType: "binary",
            responseType: "arraybuffer"
        }).done(function(result) {
            console.log(result);
            options.onSuccess({
                data: result,
                hasMore: false
            });
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: path, onSuccess, onError
    WebDavClient.prototype.createDirectory = function(options) {
        var headers = createHeaders.call(this, {});
        $.ajax({
            type: "MKCOL",
            url: this.getUrl() + encodePath(options.path) + "/",
            headers: headers
        }).done(function(result) {
            options.onSuccess();
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: path, onSuccess, onError
    WebDavClient.prototype.deleteEntry = function(options) {
        var headers = createHeaders.call(this, {});
        $.ajax({
            type: "DELETE",
            url: this.getUrl() + encodePath(options.path),
            headers: headers
        }).done(function(result) {
            options.onSuccess();
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: sourcePath, targetPath, onSuccess, onError
    WebDavClient.prototype.moveEntry = function(options) {
        var headers = createHeaders.call(this, {
            "Destination": this.getUrl() + encodePath(options.targetPath),
            "Overwrite": "F"
        });
        $.ajax({
            type: "MOVE",
            url: this.getUrl() + encodePath(options.sourcePath),
            headers: headers
        }).done(function(result) {
            options.onSuccess();
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: sourcePath, targetPath, onSuccess, onError
    WebDavClient.prototype.copyEntry = function(options) {
        var headers = createHeaders.call(this, {
            "Destination": this.getUrl() + encodePath(options.targetPath),
            "Overwrite": "F"
        });
        $.ajax({
            type: "COPY",
            url: this.getUrl() + encodePath(options.sourcePath),
            headers: headers
        }).done(function(result) {
            options.onSuccess();
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: path, onSuccess, onError
    WebDavClient.prototype.createFile = function(options) {
        var headers = createHeaders.call(this, {});
        $.ajax({
            type: "PUT",
            url: this.getUrl() + encodePath(options.path),
            headers: headers,
            processData: false,
            data: new ArrayBuffer()
        }).done(function(result) {
            options.onSuccess();
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // options: path, data, offset, openRequestId, onSuccess, onError
    WebDavClient.prototype.writeFile = function(options) {
        var writeRequest = this.writeRequestMap[options.openRequestId];
        writeRequest.filePath = options.path;
        var localFileName = String(options.openRequestId);
        writeRequest.localFileName = localFileName;
        var errorHandler = function(error) {
            console.log("writeFile failed");
            console.log(error);
            options.onError("FAILED");
        }.bind(this);
        window.requestFileSystem  = window.requestFileSystem || window.webkitRequestFileSystem;
        window.requestFileSystem(window.TEMPORARY, 100 * 1024 * 1024, function(fs) {
            fs.root.getFile(localFileName, {create: true, exclusive: false}, function(fileEntry) {
                fileEntry.createWriter(function(fileWriter) {
                    fileWriter.onwriteend = function(e) {
                        options.onSuccess();
                    }.bind(this);
                    fileWriter.onerror = errorHandler;
                    fileWriter.seek(options.offset);
                    var blob = new Blob([options.data]);
                    fileWriter.write(blob);
                }.bind(this), errorHandler);
            }.bind(this),
            errorHandler);
        }.bind(this),
        errorHandler);
    };

    // options: path, length, onSuccess, onError
    WebDavClient.prototype.truncate = function(options) {
        var headers = createHeaders.call(this, {});
        $.ajax({
            type: "GET",
            url: this.getUrl() + encodePath(options.path),
            headers: headers,
            dataType: "binary",
            responseType: "arraybuffer"
        }).done(function(data) {
            if (options.length < data.byteLength) {
                // Truncate
                var req = {
                    filePath: options.path,
                    data: data.slice(0, options.length)
                };
                sendSimpleUpload.call(this, req, options.onSuccess, options.onError);
            } else {
                // Pad with null bytes.
                var diff = options.length - data.byteLength;
                var blob = new Blob([data, new Array(diff + 1).join('\0')]);
                var reader = new FileReader();
                reader.addEventListener("loadend", function() {
                    var req = {
                        filePath: options.path,
                        data: reader.result
                    };
                    sendSimpleUpload.call(this, req, options.onSuccess, options.onError);
                }.bind(this));
                reader.readAsArrayBuffer(blob);
            }
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, options.onSuccess, options.onError);
        }.bind(this));
    };

    // Private functions

    var createHeaders = function(headers) {
        if (this.getAuthType() === "basic") {
            headers.Authorization = "Basic " + btoa(this.getUsername() + ":" + this.getPassword());
        }
        return headers;
    };

    var handleError = function(error, onSuccess, onError) {
        console.log(error);
        var status = Number(error.status);
        if (status === 404) {
            onError("NOT_FOUND");
        } else if (status === 416) {
            onSuccess(new ArrayBuffer(), false);
        } else {
            onError("FAILED");
        }
    };

    // options: filePath, data
    var sendSimpleUpload = function(options, successCallback, errorCallback) {
        var headers = createHeaders.call(this, {
            "Content-Type": "application/octet-stream"
        });
        $.ajax({
            type: "PUT",
            url: this.getUrl() + encodePath(options.filePath),
            headers: headers,
            processData: false,
            data: options.data
        }).done(function(result) {
            console.log(result);
            successCallback();
        }.bind(this)).fail(function(error) {
            handleError.call(this, error, successCallback, errorCallback);
        }.bind(this));
    };

    var initializeJQueryAjaxBinaryHandler = function() {
        $.ajaxTransport("+binary", function(options, originalOptions, jqXHR){
            if (window.FormData &&
                ((options.dataType && (options.dataType === 'binary')) ||
                 (options.data && ((window.ArrayBuffer && options.data instanceof ArrayBuffer) ||
                                   (window.Blob && options.data instanceof Blob))))) {
                return {
                    send: function(_, callback){
                        var xhr = new XMLHttpRequest(),
                            url = options.url,
                            type = options.type,
                            dataType = options.responseType || "blob",
                            data = options.data || null;
                        xhr.addEventListener('load', function(){
                            var data = {};
                            data[options.dataType] = xhr.response;
                            callback(xhr.status, xhr.statusText, data, xhr.getAllResponseHeaders());
                        });
                        xhr.open(type, url, true);
                        for (var key in options.headers) {
                            xhr.setRequestHeader(key, options.headers[key]);
                        }
                        xhr.responseType = dataType;
                        xhr.send(data);
                    },
                    abort: function(){
                        jqXHR.abort();
                    }
                };
            }
        });
    };

    var getNameFromPath = function(path) {
        var realPath = path.substring(this.rootPath_.length);
        if (realPath === "/") {
            return "";
        } else {
            var target = realPath;
            if (target.substring(target.length - 1) === "/") {
                target = target.substring(0, target.length - 1);
            }
            var names = target.split("/");
            var name = names[names.length - 1];
            return name;
        }
    };

    var removeLastSlash = function(source) {
        if (source.lastIndexOf("/") === (source.length - 1)) {
            return source.substring(0, source.length - 1);
        } else {
            return source;
        }
    };

    var select = function(element, selector) {
        var namespace = "DAV:";
        var elements = element.getElementsByTagNameNS(namespace, selector);
        if (elements.length > 0) {
            return elements[0].textContent;
        } else {
            return "";
        }
    };

    var elements = function(element, selector) {
        var namespace = "DAV:";
        var elements = element.getElementsByTagNameNS(namespace, selector);
        return elements;
    };

    var exists = function(element, selector) {
        var namespace = "DAV:";
        var elements = element.getElementsByTagNameNS(namespace, selector);
        return elements.length > 0;
    };

    var createMetadata = function(element) {
        var name = decodeURIComponent(getNameFromPath.call(this, select.call(this, element, "href")));
        var contentType = select.call(this, element, "getcontenttype");
        var isDirectory = exists.call(this, element, "collection");
        var modificationTime = new Date(select.call(this, element, "getlastmodified"));
        var size = Number(select.call(this, element, "getcontentlength"), 10);
        if (Number.isNaN(size)) {
            size = 0;
        }
        var metadata = {
            isDirectory: isDirectory,
            name: name,
            size: size,
            modificationTime: modificationTime
        };
        if (!isDirectory) {
            metadata.mimeType = contentType;
        }
        return metadata;
    };
    
    var encodePath = function(path) {
        var result = [];
        var split = path.split("/");
        for (var i = 0; i < split.length; i++) {
            result.push(encodeURIComponent(split[i]));
        }
        return "/" + result.join("/");
    };

    // Export

    window.WebDavClient = WebDavClient;

})();
