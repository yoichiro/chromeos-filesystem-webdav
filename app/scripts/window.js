"use strict";

(function() {

    var onLoad = function() {
        loadKeptCredentials();
        assignEventHandlers();
    };

    var assignEventHandlers = function() {
        var btnMount = document.querySelector("#btnMount");
        btnMount.addEventListener("click", function(e) {
            onClickedBtnMount(e);
        });
        var btnKeep = document.querySelector("#btnKeep");
        btnKeep.addEventListener("click", function(e) {
            onClickedBtnKeep(e);
        });
        var authTypeNone = document.querySelector("#authTypeNone");
        authTypeNone.addEventListener("core-change", onChangeAuthType);
        var authTypeBasic = document.querySelector("#authTypeBasic");
        authTypeBasic.addEventListener("core-change", onChangeAuthType);
        var password = document.querySelector("#password");
        password.addEventListener("change", function(e) {
            if (document.activeElement === this) {
                onClickedBtnMount(e);
            }
        });
        // Settings dialog
        var btnSettings = document.querySelector("#btnSettings");
        btnSettings.addEventListener("click", function(e) {
            onClickedBtnSettings(e);
        });
        var keepPasswordYes = document.querySelector("#keepPasswordYes");
        keepPasswordYes.addEventListener("core-change", onChangeKeepPassword);
        var keepPasswordNo = document.querySelector("#keepPasswordNo");
        keepPasswordNo.addEventListener("core-change", onChangeKeepPassword);
    };

    var onChangeAuthType = function(evt) {
        console.log("onChangeAuthType");
        evt.preventDefault();
        var none = document.querySelector("#authTypeNone").checked;
        var username = document.querySelector("#username");
        var password = document.querySelector("#password");
        var passwordDecorator = document.querySelector("#passwordDecorator");
        if (none) {
            username.setAttribute("disabled", "true");
            password.setAttribute("disabled", "true");
            passwordDecorator.setAttribute("disabled", "true");
        } else {
            username.removeAttribute("disabled");
            password.removeAttribute("disabled");
            passwordDecorator.removeAttribute("disabled");
        }
    };

    var onClickedBtnMount = function(evt) {
        console.log("onClickedBtnMount");
        var btnMount = document.querySelector("#btnMount");
        evt.preventDefault();
        btnMount.setAttribute("disabled", "true");
        document.getElementById("toast-mount-attempt").show();
        var url = document.querySelector("#url").value;
        if (url.substring(url.length - 1) === "/") {
            url = url.substring(0, url.length - 1);
        }
        var request = {
            type: "mount",
            url: url,
            name: document.querySelector("#name").value,
            authType: document.querySelector("#authType").selected,
            username: document.querySelector("#username").value,
            password: document.querySelector("#password").value
        };
        chrome.runtime.sendMessage(request, function(response) {
            if (response.success) {
                document.getElementById("toast-mount-success").show();
                window.setTimeout(function() {
                    window.close();
                }, 2000);
            } else {
                var toast = document.getElementById("toast-mount-fail");
                if (response.error) {
                    toast.setAttribute("text", response.error);
                }
                toast.show();
                btnMount.removeAttribute("disabled");
            }
        });
    };

    var setMessageResources = function() {
        var selector = "data-message";
        var elements = document.querySelectorAll("[" + selector + "]");

        for (var i = 0; i < elements.length; i++) {
            var element = elements[i];

            var messageID = element.getAttribute(selector);
            var messageText = chrome.i18n.getMessage(messageID);

            var textNode = null;

            switch(element.tagName.toLowerCase()) {
            case "paper-button":
                textNode = document.createTextNode(messageText);
                element.appendChild(textNode);
                break;
            case "paper-input":
            case "paper-input-decorator":
            case "paper-radio-button":
                element.setAttribute("label", messageText);
                break;
            case "paper-toast":
                element.setAttribute("text", messageText);
                break;
            case "h2":
            case "title":
                textNode = document.createTextNode(messageText);
                element.appendChild(textNode);
                break;
            }
        }
    };

    var onClickedBtnKeep = function(evt) {
        console.log("onClickedBtnKeep");
        chrome.storage.local.get("settings", function(items) {
            var settings = items.settings || {};
            var keepPassword = settings.keepPassword || "keepPasswordNo";
            keepPassword = (keepPassword === "keepPasswordYes");
            var url = document.querySelector("#url").value;
            var authType = document.querySelector("#authType").selected;
            var username = document.querySelector("#username").value;
            var password = document.querySelector("#password").value;
            if (url) {
                chrome.storage.local.get("keptCredentials", function(items) {
                    var credentials = items.keptCredentials || {};
                    var key = createKey(url);
                    var credential = {
                        url: url,
                        authType: authType,
                        username: username
                    };
                    if (keepPassword) {
                        credential.password = password;
                    }
                    credentials[key] = credential;
                    chrome.storage.local.set({
                        keptCredentials: credentials
                    }, function() {
                        loadKeptCredentials();
                    });
                });
            }
        });
    };

    var loadKeptCredentials = function() {
        chrome.storage.local.get("keptCredentials", function(items) {
            document.querySelector("#credentials").innerHTML = "";
            var credentials = items.keptCredentials || {};
            for (var key in credentials) {
                appendCredentialToScreen(credentials[key]);
            }
        });
    };

    var appendCredentialToScreen = function(credential) {
        var credentials = document.querySelector("#credentials");
        var div = document.createElement("div");
        div.setAttribute("horizontal", "true");
        div.setAttribute("layout", "true");
        div.setAttribute("center", "true");
        var item = document.createElement("paper-item");
        item.textContent = createKey(credential.url);
        item.addEventListener("click", (function(credential) {
            return function(evt) {
                setCredentialToForm(credential);
            };
        })(credential));
        div.appendChild(item);
        var btnClose = document.createElement("paper-icon-button");
        btnClose.setAttribute("icon", "close");
        btnClose.setAttribute("title", "Delete");
        btnClose.addEventListener("click", (function(credential) {
            return function(evt) {
                setCredentialToForm(credential);
                chrome.storage.local.get("keptCredentials", function(items) {
                    var credentials = items.keptCredentials || {};
                    var key = createKey(credential.url);
                    delete credentials[key];
                    chrome.storage.local.set({
                        keptCredentials: credentials
                    }, function() {
                        loadKeptCredentials();
                    });
                });
            };
        })(credential));
        div.appendChild(btnClose);
        credentials.appendChild(div);
    };

    var setCredentialToForm = function(credential) {
        document.querySelector("#url").value = credential.url;
        document.querySelector("#authType").selected = credential.authType;
        document.querySelector("#username").value = credential.username;
        var password = credential.password;
        if (password) {
            document.querySelector("#password").value = password;
        } else {
            document.querySelector("#password").value = "";
        }
        document.querySelector("#password").focus();
    };

    var createKey = function(url) {
        return url;
    };

    var onClickedBtnSettings = function(evt) {
        chrome.storage.local.get("settings", function(items) {
            var settings = items.settings || {};
            var keepPassword = settings.keepPassword || "keepPasswordNo";
            if (keepPassword === "keepPasswordYes") {
                document.querySelector("#keepPassword").selected = "keepPasswordYes";
            } else {
                document.querySelector("#keepPassword").selected = "keepPasswordNo";
            }
            document.querySelector("#settingsDialog").toggle();
        });
    };

    var onChangeKeepPassword = function(evt) {
        chrome.storage.local.get("settings", function(items) {
            var settings = items.settings || {};
            settings.keepPassword = document.querySelector("#keepPassword").selected;
            chrome.storage.local.set({settings: settings}, function() {
                console.log("Saving settings done.");
            });
        });
    };

    window.addEventListener("load", function(e) {
        onLoad();
    });

    setMessageResources();

})();
