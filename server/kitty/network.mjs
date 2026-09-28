import { EnvHttpProxyAgent, fetch } from 'undici';
// Honor HTTP(S)_PROXY / NO_PROXY without logging credentials or weakening TLS.
let dispatcher;
export function fetchModel(url, options = {}) {
  dispatcher ??= new EnvHttpProxyAgent();
  return fetch(url, { ...options, dispatcher });
}
