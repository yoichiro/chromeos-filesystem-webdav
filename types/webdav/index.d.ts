declare module 'webdav/web' {
  type Client = any;
  function createClient(url: string, options: { username: string, password: string }): Client;
}
