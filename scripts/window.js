'use strict';

document.querySelector('#btnOk').addEventListener('click', async ev => {
  const btnOk = ev.target;
  btnOk.setAttribute('disabled', 'true');

  const message = document.querySelector('#message');
  message.innerText = 'Mounting...';

  const name = document.querySelector('#name').value;
  const url = document.querySelector("#url").value;
  const username = document.querySelector("#username").value;
  const password = document.querySelector("#password").value;
  // if (url.substring(url.length - 1) === "/") {
  //     url = url.substring(0, url.length - 1);
  // }

  const request = {
      type: "mount",
      authType: 'basic',
      url,
      username,
      password,
  };

  const response = await browser.runtime.sendMessage(request)
  if (response.success) {
    const credentials = await browser.storage.local.get('credentials');
    const key = url;
    const credential = { name, url, username, password };
    credentials[key] = credential;
    await browser.storage.local.set({ credentials });
    window.close();
  } else {
    if (response.error) {
      message.innerText = response.error;
    }
    btnOk.removeAttribute("disabled");
  }
});
