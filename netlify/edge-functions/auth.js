// =============================================================
//  Acceso con usuario y contraseña — pantalla de ingreso propia
//
//  Usuarios: variable de entorno APP_USERS en Netlify, formato
//     usuario1:clave1;usuario2:clave2
//  Las credenciales nunca se escriben en el código ni en GitHub.
//
//  Rutas especiales:
//     POST /__login   valida el formulario y crea la sesión
//     GET  /__logout  cierra la sesión
// =============================================================

const COOKIE = 'tx_session';
const SHORT_SESSION_H = 12;     // sin «mantener sesión»: hasta cerrar el navegador (máx. 12 h)
const LONG_SESSION_D = 30;      // con «mantener sesión»: 30 días
const enc = new TextEncoder();

// ---------- Usuarios ----------
function loadUsers() {
  const raw = Netlify.env.get('APP_USERS') || '';
  const map = new Map();
  for (const entry of raw.split(/[;\n]/)) {
    const s = entry.trim();
    const i = s.indexOf(':');
    if (i > 0) map.set(s.slice(0, i).trim().toLowerCase(), s.slice(i + 1));
  }
  return { raw, map };
}

// ---------- Firma de la sesión (HMAC-SHA256) ----------
// La llave se deriva de APP_USERS (+ AUTH_SECRET opcional): si cambias los
// usuarios o claves, todas las sesiones abiertas se invalidan automáticamente.
async function getKey(raw) {
  const secret = raw + '|' + (Netlify.env.get('AUTH_SECRET') || 'transcriptor');
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sign(key, data) {
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeToken(key, user, hours) {
  const exp = Math.floor(Date.now() / 1000) + hours * 3600;
  const payload = `${encodeURIComponent(user)}.${exp}`;
  return `${payload}.${await sign(key, payload)}`;
}

async function readToken(key, token, users) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  if (!safeEqual(sig, await sign(key, `${u}.${exp}`))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  const user = decodeURIComponent(u);
  return users.has(user) ? user : null;
}

function getCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? m[1] : null;
}

function safeNext(n) {
  return typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/__')
    ? n : '/';
}

// ---------- Respuestas ----------
const noStore = { 'cache-control': 'no-store' };

function loginPage({ error = '', next = '/', user = '' } = {}, status = 401) {
  return new Response(renderLogin({ error, next, user }), {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...noStore },
  });
}

function redirect(location, cookie) {
  const headers = new Headers({ location, ...noStore });
  if (cookie) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

// ---------- Manejador principal ----------
export default async (request, context) => {
  const url = new URL(request.url);
  const { raw, map: users } = loadUsers();

  if (!users.size) {
    return new Response('Acceso no configurado. Define APP_USERS en Netlify.', {
      status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', ...noStore },
    });
  }

  const key = await getKey(raw);

  // Cerrar sesión
  if (url.pathname === '/__logout') {
    return redirect('/', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }

  // Envío del formulario
  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData();
    const user = String(form.get('user') || '').trim().toLowerCase();
    const pass = String(form.get('pass') || '');
    const remember = form.get('remember') === 'on';
    const next = safeNext(String(form.get('next') || '/'));

    const expected = users.get(user);
    if (expected === undefined || !safeEqual(pass, expected)) {
      await new Promise((r) => setTimeout(r, 700)); // frena intentos repetidos
      return loginPage({ error: 'Usuario o contraseña incorrectos.', next, user });
    }

    const hours = remember ? LONG_SESSION_D * 24 : SHORT_SESSION_H;
    const token = await makeToken(key, user, hours);
    const maxAge = remember ? `; Max-Age=${hours * 3600}` : '';
    return redirect(next, `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge}`);
  }

  // Sesión válida → continúa al sitio
  if (await readToken(key, getCookie(request, COOKIE), users)) return context.next();

  // Sin sesión: páginas → pantalla de ingreso; recursos → 401
  const wantsHtml = (request.headers.get('accept') || '').includes('text/html');
  if (request.method === 'GET' && wantsHtml) {
    return loginPage({ next: safeNext(url.pathname + url.search) });
  }
  return new Response('No autorizado', { status: 401, headers: noStore });
};

export const config = { path: '/*' };

// ---------- Pantalla de ingreso ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderLogin({ error, next, user }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ingresar · Transcriptor</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%231f4e5f'/><path d='M9 13v6M13 9v14M17 11v10M21 14v4M25 12v8' stroke='%23f4efe6' stroke-width='2.4' stroke-linecap='round'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --bg:#f4efe6; --surface:#fffdf8; --ink:#1d2a30; --muted:#66727a; --line:#e2dacb;
          --accent:#1f4e5f; --accent-ink:#f4efe6; --accent-soft:#dfe9ea; --warm:#c8643b; --err-bg:#fbe9e2; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141b1f; --surface:#1c2529; --ink:#e9e4da; --muted:#9aa5ab; --line:#2d393e;
            --accent:#7fb3c2; --accent-ink:#10181b; --accent-soft:#23353b; --warm:#e08a62; --err-bg:#3a2620; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px 16px;
         background:var(--bg); color:var(--ink); font:16px/1.5 Inter, system-ui, sans-serif; }
  .card { width:100%; max-width:400px; background:var(--surface); border:1px solid var(--line);
          border-radius:18px; padding:34px 28px 28px; box-shadow:0 1px 2px rgba(29,42,48,.06), 0 12px 32px rgba(29,42,48,.07); }
  .logo { width:52px; height:52px; display:block; margin:0 auto 14px; }
  .logo rect { fill:var(--accent); } .logo path { stroke:var(--accent-ink); stroke-width:2.4; stroke-linecap:round; }
  h1 { font-family:Fraunces, Georgia, serif; font-weight:600; font-size:1.7rem; text-align:center; margin:0; }
  .sub { text-align:center; color:var(--muted); margin:4px 0 26px; font-size:.95rem; }
  label.f { display:block; font-size:.85rem; font-weight:500; margin:0 0 6px; }
  .input { position:relative; margin-bottom:16px; }
  input[type=text], input[type=password] { width:100%; font:inherit; padding:12px 14px; border-radius:11px;
          border:1px solid var(--line); background:var(--bg); color:var(--ink); outline:none; transition:border-color .15s, box-shadow .15s; }
  input:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
  .pw input { padding-right:84px; }
  .toggle { position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:0;
            color:var(--accent); font:500 .82rem Inter, sans-serif; cursor:pointer; padding:6px 8px; border-radius:7px; }
  .toggle:hover { background:var(--accent-soft); }
  .remember { display:flex; align-items:center; gap:9px; font-size:.9rem; color:var(--muted); margin:4px 0 22px; cursor:pointer; }
  .remember input { width:17px; height:17px; accent-color:var(--accent); margin:0; }
  button.go { width:100%; font:600 1rem Inter, sans-serif; padding:13px; border-radius:11px; border:0;
              background:var(--accent); color:var(--accent-ink); cursor:pointer; transition:opacity .15s, transform .05s; }
  button.go:hover { opacity:.92; } button.go:active { transform:translateY(1px); }
  button.go[disabled] { opacity:.6; cursor:wait; }
  .error { background:var(--err-bg); color:var(--warm); border-radius:10px; padding:10px 12px;
           font-size:.9rem; margin-bottom:18px; display:flex; gap:8px; align-items:center; }
  .note { text-align:center; color:var(--muted); font-size:.82rem; margin:22px 0 0; }
  .privacy { display:flex; gap:8px; align-items:flex-start; background:var(--accent-soft); border-radius:10px;
             padding:10px 12px; font-size:.82rem; margin-top:18px; color:var(--ink); }
</style>
</head>
<body>
  <main class="card">
    <svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8"/><path d="M9 13v6M13 9v14M17 11v10M21 14v4M25 12v8"/></svg>
    <h1>Transcriptor</h1>
    <p class="sub">Ingresa con tu cuenta del equipo</p>

    ${error ? `<div class="error" role="alert">⚠️ ${esc(error)}</div>` : ''}

    <form method="post" action="/__login" id="f">
      <input type="hidden" name="next" value="${esc(next)}">
      <label class="f" for="user">Usuario</label>
      <div class="input">
        <input type="text" id="user" name="user" value="${esc(user)}" autocomplete="username"
               autocapitalize="none" spellcheck="false" required ${user ? '' : 'autofocus'}>
      </div>
      <label class="f" for="pass">Contraseña</label>
      <div class="input pw">
        <input type="password" id="pass" name="pass" autocomplete="current-password" required ${user ? 'autofocus' : ''}>
        <button type="button" class="toggle" id="t" aria-label="Mostrar contraseña">Mostrar</button>
      </div>
      <label class="remember"><input type="checkbox" name="remember"> Mantener sesión iniciada en este equipo</label>
      <button class="go" type="submit" id="go">Ingresar</button>
    </form>

    <div class="privacy">🔒 <span>Tus audios se procesan solo en tu equipo. Nunca se envían a ningún servidor.</span></div>
    <p class="note">¿No tienes acceso? Solicítalo al administrador del proyecto.</p>
  </main>
<script>
  var p = document.getElementById('pass'), t = document.getElementById('t');
  t.onclick = function () {
    var show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    t.textContent = show ? 'Ocultar' : 'Mostrar';
    t.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    p.focus();
  };
  document.getElementById('f').onsubmit = function () {
    var b = document.getElementById('go'); b.disabled = true; b.textContent = 'Ingresando…';
  };
</script>
</body>
</html>`;
}
