export default async (request, context) => {
  const users = (Netlify.env.get('APP_USERS') || '')
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.includes(':'));

  if (!users.length) {
    return new Response('Acceso no configurado. Define APP_USERS en Netlify.', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    let credentials = '';
    try { credentials = atob(header.slice(6)); } catch (_) {}
    if (users.includes(credentials)) return context.next();
  }

  return new Response('Acceso restringido. Ingresa tu usuario y contraseña.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Transcriptor", charset="UTF-8"',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

export const config = { path: '/*' };
