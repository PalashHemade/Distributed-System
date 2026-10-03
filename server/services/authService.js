const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { User } = require('../models');
const { HttpError } = require('../middleware/errorHandler');

const EXPIRES_IN = '12h';

// Read lazily, not as a module-load-time const — this module can be required
// before dotenv.config() has run (require order varies by entry point), and a
// cached `undefined` would silently break auth for the lifetime of the process.
function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

function signToken(user) {
  return jwt.sign(
    { userId: user.userId, role: user.role, name: user.name },
    getSecret(),
    { expiresIn: EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

function toPublicUser(user) {
  return { userId: user.userId, name: user.name, email: user.email, role: user.role };
}

async function register({ email, password, name, role }) {
  if (!email || !password || !name || !['teacher', 'student'].includes(role)) {
    throw new HttpError(400, 'email, password, name, and role ("teacher"|"student") are required');
  }
  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) throw new HttpError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await new User({ userId: uuidv4(), email, name, role, passwordHash }).save();
  return { token: signToken(user), user: toPublicUser(user) };
}

async function login({ email, password }) {
  if (!email || !password) throw new HttpError(400, 'email and password are required');
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new HttpError(401, 'Invalid email or password');
  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) throw new HttpError(401, 'Invalid email or password');
  return { token: signToken(user), user: toPublicUser(user) };
}

module.exports = { signToken, verifyToken, register, login };
