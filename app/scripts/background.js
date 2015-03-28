"use strict";

(function() {

    var webdav_fs_ = new WebDavFS();

    chrome.app.runtime.onLaunched.addListener(function() {
        chrome.app.window.create("window.html", {
            outerBounds: {
                width: 800,
                height: 470
            },
            resizable: false
        });
    });

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
