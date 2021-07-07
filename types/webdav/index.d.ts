declare module 'webdav/web' {
  type Client = any;

  const axios: any;

  interface CreateClientOptions {
    username: string
    password: string
  }

  function createClient(url: string, options: CreateClientOptions): Client;
}
