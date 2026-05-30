const crypto = require('node:crypto');

const LOGIN_COOKIE_NAME = 'admin_session';

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce((cookies, part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex <= 0) {
      return cookies;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
    cookies[key] = value;
    return cookies;
  }, {});
}

function secureEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildCookie(token, maxAgeSeconds, secure) {
  const parts = [
    `${LOGIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildExpiredCookie(secure) {
  const parts = [
    `${LOGIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function createAdminAuth(options) {
  const {
    username,
    password,
    sessionTtlMs = 24 * 60 * 60 * 1000,
    maxAttempts = 3,
    windowMs = 5 * 60 * 1000
  } = options;

  const enabled = Boolean(username && password);
  const sessions = new Map();
  const loginAttempts = new Map();

  function cleanup(now = Date.now()) {
    for (const [token, session] of sessions.entries()) {
      if (session.expiresAt <= now) {
        sessions.delete(token);
      }
    }

    for (const [ip, attempt] of loginAttempts.entries()) {
      if (attempt.resetAt <= now) {
        loginAttempts.delete(ip);
      }
    }
  }

  function getClientIp(request) {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
      return forwardedFor.split(',')[0].trim();
    }

    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  function getAttemptState(ip, now = Date.now()) {
    cleanup(now);
    const current = loginAttempts.get(ip);
    if (!current || current.resetAt <= now) {
      const next = { count: 0, resetAt: now + windowMs };
      loginAttempts.set(ip, next);
      return next;
    }

    return current;
  }

  function registerFailedAttempt(ip, now = Date.now()) {
    const state = getAttemptState(ip, now);
    state.count += 1;
    loginAttempts.set(ip, state);
    return state;
  }

  function clearFailedAttempts(ip) {
    loginAttempts.delete(ip);
  }

  function getRemainingAttempts(ip, now = Date.now()) {
    const state = getAttemptState(ip, now);
    return Math.max(0, maxAttempts - state.count);
  }

  function isRateLimited(ip, now = Date.now()) {
    const state = getAttemptState(ip, now);
    return state.count >= maxAttempts;
  }

  function createSession(reply, request) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + sessionTtlMs;
    const secure = request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';

    sessions.set(token, {
      username,
      createdAt: Date.now(),
      expiresAt
    });

    reply.header('set-cookie', buildCookie(token, Math.floor(sessionTtlMs / 1000), secure));
  }

  function clearSession(reply, request) {
    const secure = request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https';
    reply.header('set-cookie', buildExpiredCookie(secure));
  }

  function getSession(request) {
    cleanup();
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[LOGIN_COOKIE_NAME];
    if (!token) {
      return null;
    }

    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }

    return {
      username: session.username,
      expires_at: new Date(session.expiresAt).toISOString()
    };
  }

  function authenticate(request, submittedUsername, submittedPassword) {
    const ip = getClientIp(request);
    if (!enabled) {
      return {
        ok: false,
        statusCode: 503,
        message: 'Admin login is not configured.'
      };
    }

    if (isRateLimited(ip)) {
      return {
        ok: false,
        statusCode: 429,
        message: 'Too many login attempts. Try again later.',
        remaining_attempts: 0
      };
    }

    const valid =
      secureEquals(submittedUsername, username) && secureEquals(submittedPassword, password);

    if (!valid) {
      const state = registerFailedAttempt(ip);
      return {
        ok: false,
        statusCode: 401,
        message: 'Invalid admin credentials.',
        remaining_attempts: Math.max(0, maxAttempts - state.count)
      };
    }

    clearFailedAttempts(ip);
    return {
      ok: true,
      statusCode: 200,
      message: 'Authenticated.'
    };
  }

  function requireSession(request, reply) {
    const session = getSession(request);
    if (!session) {
      reply.code(401);
      return null;
    }

    return session;
  }

  return {
    enabled,
    maxAttempts,
    windowMs,
    getClientIp,
    getRemainingAttempts,
    getSession,
    authenticate,
    createSession,
    clearSession,
    requireSession
  };
}

module.exports = {
  createAdminAuth
};
