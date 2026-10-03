const { parseCookie } = require('cookie');
const authService = require('../services/authService');

const COOKIE_NAME = 'token';

// Express middleware: requires an httpOnly `token` cookie, populates req.user.
// (Requires `cookie-parser` to be mounted earlier in the app so req.cookies exists.)
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = authService.verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ error: `Requires role: ${role}` });
    }
    next();
  };
}

// Socket.IO middleware: Socket.IO's handshake doesn't go through cookie-parser,
// so the raw `Cookie` header is parsed directly here. The browser attaches it
// automatically (same as any other cross-port request on localhost — cookies
// are scoped by hostname, not port) as long as the client connects with
// `withCredentials: true` and the server's Socket.IO CORS config allows
// credentials for that origin (see socketManager.js / gateway server.js).
function socketAuth(socket, next) {
  // Everything (not just verifyToken) is inside the try/catch — a synchronous
  // throw in a Socket.IO connection-middleware that doesn't reach next(err)
  // surfaces as an unhandled rejection on the server and hangs the client
  // with no connect_error at all, which is exactly what happened here once
  // before (see git history) when the cookie-parsing call itself threw.
  try {
    const rawCookie = socket.handshake.headers.cookie;
    const token = rawCookie && parseCookie(rawCookie)[COOKIE_NAME];
    if (!token) return next(new Error('Missing auth token'));
    socket.user = authService.verifyToken(token);
    next();
  } catch (err) {
    next(new Error('Invalid or expired token'));
  }
}

module.exports = { COOKIE_NAME, requireAuth, requireRole, socketAuth };
