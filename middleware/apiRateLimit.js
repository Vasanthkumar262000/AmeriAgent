const db = require('../config/db');

module.exports = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) return res.status(401).json({ success: false, message: 'API key required' });

    // Get business from API key
    const [[keyRow]] = await db.query(
      `SELECT bak.business_id, b.plan_key, ps.api_calls_daily, ps.api_calls_monthly
       FROM business_api_keys bak
       JOIN businesses b ON bak.business_id = b.id
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE bak.api_key = ? AND b.account_status = 'active'`,
      [apiKey]
    );

    if (!keyRow) return res.status(401).json({ success: false, message: 'Invalid API key' });

    // Pack Advanced = unlimited
    if (!keyRow.api_calls_daily && !keyRow.api_calls_monthly) {
      req.business_id = keyRow.business_id;
      req.plan_key = keyRow.plan_key;
      return next();
    }

    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';

    // Get or create usage record
    await db.query(
      `INSERT INTO api_usage (business_id, date, calls_today, calls_month)
       VALUES (?, ?, 0, 0)
       ON DUPLICATE KEY UPDATE date=date`,
      [keyRow.business_id, today]
    );

    const [[usage]] = await db.query(
      `SELECT calls_today, calls_month FROM api_usage
       WHERE business_id = ? AND date = ?`,
      [keyRow.business_id, today]
    );

    // Check daily limit
    if (keyRow.api_calls_daily && usage.calls_today >= keyRow.api_calls_daily) {
      return res.status(429).json({
        success: false,
        error: 'DAILY_LIMIT_REACHED',
        message: `Daily API limit reached (${keyRow.api_calls_daily} calls). Resets at midnight IST.`,
        limit: keyRow.api_calls_daily,
        used: usage.calls_today,
        resets_at: `${today}T18:30:00.000Z`
      });
    }

    // Check monthly limit
    const [[monthUsage]] = await db.query(
      `SELECT SUM(calls_today) as total FROM api_usage
       WHERE business_id = ? AND date >= ?`,
      [keyRow.business_id, monthStart]
    );

    if (keyRow.api_calls_monthly && monthUsage.total >= keyRow.api_calls_monthly) {
      return res.status(429).json({
        success: false,
        error: 'MONTHLY_LIMIT_REACHED',
        message: `Monthly API limit reached (${keyRow.api_calls_monthly} calls). Resets on 1st of next month.`,
        limit: keyRow.api_calls_monthly,
        used: monthUsage.total
      });
    }

    // Increment usage
    await db.query(
      `UPDATE api_usage SET calls_today = calls_today + 1, calls_month = calls_month + 1, last_call_at = NOW()
       WHERE business_id = ? AND date = ?`,
      [keyRow.business_id, today]
    );

    // Add usage info to headers
    res.set('X-RateLimit-Daily-Limit', keyRow.api_calls_daily || 'unlimited');
    res.set('X-RateLimit-Daily-Used', usage.calls_today + 1);
    res.set('X-RateLimit-Monthly-Limit', keyRow.api_calls_monthly || 'unlimited');
    res.set('X-RateLimit-Monthly-Used', (monthUsage.total || 0) + 1);

    req.business_id = keyRow.business_id;
    req.plan_key = keyRow.plan_key;
    next();

  } catch(err) {
    console.error('API rate limit error:', err.message);
    res.status(500).json({ success: false, message: 'API error' });
  }
};
