import axios from 'axios';

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:5000';

// The JWT itself lives in an httpOnly cookie set by the server — this code
// never sees it, can't read it, and doesn't need to. Every request/socket
// connection just needs `withCredentials: true` (set globally in main.jsx)
// and the browser attaches the cookie automatically.

export async function fetchCurrentUser() {
  try {
    const res = await axios.get(`${GATEWAY_URL}/api/auth/me`, { withCredentials: true });
    return res.data.user;
  } catch (err) {
    return null; // not logged in / expired session
  }
}

export async function logout() {
  await axios.post(`${GATEWAY_URL}/api/auth/logout`, {}, { withCredentials: true }).catch(() => {});
}
