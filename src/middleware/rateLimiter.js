const rateLimitStore = new Map();

function rateLimit(key, maxAttempts = 5, windowMs = 60000) {
  const now = Date.now();
  const entry = rateLimitStore.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count++;
  rateLimitStore.set(key, entry);
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore) {
      if (Date.now() > v.resetAt) rateLimitStore.delete(k);
    }
  }
  return entry.count <= maxAttempts ? null : Math.ceil((entry.resetAt - now) / 1000);
}

function rateLimitMiddleware(name, max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const retryAfter = rateLimit(name + ':' + ip, max, windowMs);
    if (retryAfter) {
      return res.status(429).json({ error: 'too_many_requests', retry_after: retryAfter });
    }
    next();
  };
}

const feedbackLimiter = rateLimitMiddleware('feedback', 10, 60000);
const smsLimiter = rateLimitMiddleware('sms', 10, 60000);
const emailLimiter = rateLimitMiddleware('email', 5, 60000);
const importLimiter = rateLimitMiddleware('import', 3, 60000);

module.exports = { rateLimit, feedbackLimiter, smsLimiter, emailLimiter, importLimiter };
