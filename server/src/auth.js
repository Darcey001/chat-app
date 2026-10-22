import jwt from 'jsonwebtoken';

export function signToken(user, secret) {
  return jwt.sign({ id: user.id, username: user.username }, secret, { expiresIn: '7d' });
}

export function verifyToken(token, secret) {
  try {
    const { id, username } = jwt.verify(token, secret);
    return { id, username };
  } catch {
    return null;
  }
}

/** Express middleware: requires "Authorization: Bearer <token>". */
export function requireAuth(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token && verifyToken(token, secret);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  };
}
