import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const port = +(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };

http.createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, `http://localhost:${port}`).pathname);
    let file = resolve(root, `.${path === '/' ? '/tests/browser/episode-fixture.html' : path}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('Outside root');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    response.end(await readFile(file));
  } catch (_) {
    // Mirror the production SPA fallback so direct loads and reloads of routes
    // such as /movie/7 and /box-office exercise the real application shell.
    try {
      const path = decodeURIComponent(new URL(request.url, `http://localhost:${port}`).pathname);
      if (!extname(path) && path !== '/tests/browser/episode-fixture') {
        response.writeHead(200, { 'content-type': mime['.html'], 'cache-control': 'no-store' });
        response.end(await readFile(resolve(root, 'index.html')));
        return;
      }
    } catch (_) {}
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`CineVerse browser fixture: http://127.0.0.1:${port}`));
