const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');
const { COOKIE_NAME } = require('../middleware/auth');

const COOKIE_MAX_AGE_MS = 12 * 60 * 60 * 1000; // matches authService's token expiry

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax', // cross-port on localhost is still "same-site" (same hostname) — Lax allows it
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/'
  };
}

const register = asyncHandler(async (req, res) => {
  const { token, user } = await authService.register(req.body);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ user });
});

const login = asyncHandler(async (req, res) => {
  const { token, user } = await authService.login(req.body);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(200).json({ user });
});

const logout = (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.status(200).json({ success: true });
};

// Lets the client ask "who am I, if anyone" using only the httpOnly cookie —
// this is how the frontend learns the current user without ever touching
// the token itself (see client/src/auth.js).
const me = (req, res) => {
  res.status(200).json({ user: { userId: req.user.userId, name: req.user.name, role: req.user.role } });
};

module.exports = { register, login, logout, me };
