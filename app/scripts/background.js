"use strict";

(function() {

    if (!chrome.fileSystemProvider) {
        console.log("There is no chrome.fileSystemProvider API. See you on ChromeOS!");
        return;
    }

    var webdav_fs_ = new WebDavFS();

    var openWindow = function() {
        chrome.app.window.create("window.html", {
            outerBounds: {
                width: 800,
                height: 470
            },
            resizable: false
        });
    };

    chrome.app.runtime.onLaunched.addListener(openWindow);

    if (chrome.fileSystemProvider.onMountRequested) {
        chrome.fileSystemProvider.onMountRequested.addListener(openWindow);
    }

    var doMount = function(request, sendResponse) {
        webdav_fs_.checkAlreadyMounted(request.url, request.username, function(exists) {
            if (exists) {
                sendResponse({
                    type: "error",
                    error: "Already mounted"
                });
            } else {
                var options = {
                    url: request.url,
                    name: request.name,
                    authType: request.authType,
                    username: request.username,
                    password: request.password,
                    onSuccess: function() {
                        sendResponse({
                            type: "mounted",
                            success: true
                        });
                    },
                    onError: function(reason) {
                        sendResponse({
                            type: "error",
                            success: false,
                            error: reason
                        });
                    }
                };
                webdav_fs_.mount(options);
            }
        });
    };

    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        console.log(request);
        switch(request.type) {
        case "mount":
            doMount(request, sendResponse);
            break;
        default:
            var message;
            if (request.type) {
                message = "Invalid request type: " + request.type + ".";
            } else {
                message = "No request type provided.";
            }
            sendResponse({
                type: "error",
                success: false,
                message: message
            });
            break;
        }
        return true;
    });

})();
