'use strict';

async function ncLoginFlow(domain) {
  // Nextcloud Login flow v2
  // https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/index.html#login-flow-v2
  const url = `https://${domain}/index.php/login/v2`;
  const response = await fetch(url, { method: 'POST' });
  const { poll: { token, endpoint }, login } = await response.json();

  await browser.tabs.create({ url: login });

  return await new Promise(resolve => {
    // polling
    const id = setInterval(async () => {
      const body = new URLSearchParams();
      body.append('token', token);
      const response = await fetch(endpoint, { method: 'POST', body });
      if (response.ok) {
        const { loginName: username, appPassword: password } = await response.json();
        clearInterval(id);
        resolve({ server: 'nc', username, password, token });
      }
    }, 1000);
  });
}

document.querySelector('#btnOk').addEventListener('click', async ev => {
  const btnOk = ev.target;
  btnOk.setAttribute('disabled', 'true');

  const name = document.querySelector('#name').value;
  const domain = document.querySelector("#domain").value;
  const username = document.querySelector("#username").value;
  const password = document.querySelector("#password").value;

  const granted = await browser.permissions.request({
    origins: [`https://${domain}/`]
  });
  if (!granted) return;

  const request = { server: 'oc', name, domain, username, password };

  const details = document.querySelector('#expander');
  if (!details.open) {
    Object.assign(request, await ncLoginFlow(domain));
  }

  const message = document.querySelector('#message');
  message.innerText = 'Mounting...';

  await browser.runtime.sendMessage(request)
    .then(window.close)
    .catch(error => {
      console.error(error);
      message.innerText = error.message;
      btnOk.removeAttribute("disabled");
    });
});

document.querySelector('#expander').addEventListener('toggle', ev => {
  const details = ev.target;
  const button = document.querySelector('#btnOk');

  if (details.open) button.innerText = 'Mount';
  else button.innerText = 'Login';
});
