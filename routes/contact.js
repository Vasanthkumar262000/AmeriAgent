const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ── POST: Submit contact form ─────────────────────────────────────────────────
router.post('/submit', async (req, res) => {
  const { bot_id, name, email, phone, message, source, page, user_agent, referrer, custom_fields } = req.body;
  try {
    const [[biz]] = await db.query(
      `SELECT b.id, b.company_name, ps.max_websites
       FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.bot_id = ? AND b.account_status = 'active'`,
      [bot_id]
    );
    if (!biz) return res.status(404).json({ success: false, message: 'Business not found' });

    // ── IP & Geo ──────────────────────────────────────────────────────────────
    const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || '').split(',')[0].trim();
    let country = null, city = null;
    try {
      const geoip = require('geoip-lite');
      const geo = geoip.lookup(ip);
      if (geo) { country = geo.country; city = geo.city; }
    } catch(e) {}

    // ── Device & Browser ──────────────────────────────────────────────────────
    const ua = user_agent || '';
    const isMobile = /mobile|android|iphone|ipad/i.test(ua);
    const device_type = isMobile ? 'mobile' : 'desktop';
    const browser = ua.match(/(chrome|firefox|safari|edge|opera)/i)?.[1] || 'unknown';

    // ── Website limit check ───────────────────────────────────────────────────
    let domain = '';
    if (page) {
      try {
        const fullUrl = page.startsWith('http') ? page : 'https://unknown.com' + page;
        const parsed = new URL(fullUrl).hostname.replace('www.', '');
        if (parsed !== 'unknown.com') domain = parsed;
      } catch(e) { domain = ''; }
    }
    if (domain) {
      const [[existingDomain]] = await db.query(
        'SELECT id FROM registered_websites WHERE business_id = ? AND domain = ?',
        [biz.id, domain]
      );
      if (!existingDomain) {
        const [[count]] = await db.query(
          'SELECT COUNT(*) as c FROM registered_websites WHERE business_id = ?',
          [biz.id]
        );
        if (count.c >= (biz.max_websites || 5)) {
          return res.status(403).json({ success: false, message: `Website limit reached (${biz.max_websites || 5} websites). Please upgrade your plan.` });
        }
        await db.query('INSERT IGNORE INTO registered_websites (business_id, domain) VALUES (?,?)', [biz.id, domain]);
      }
    }

    // ── Save or update visitor ────────────────────────────────────────────────
    const [[existingVisitor]] = await db.query(
      'SELECT id FROM visitors WHERE business_id = ? AND email = ?',
      [biz.id, email]
    );
    let visitor_id;
    if (existingVisitor) {
      visitor_id = existingVisitor.id;
      await db.query(
        `UPDATE visitors SET
          name=?, phone=?, last_visit_at=NOW(), lead_source=?,
          ip_address=?, country=COALESCE(country,?), city=COALESCE(city,?),
          device_type=COALESCE(device_type,?), browser=COALESCE(browser,?)
         WHERE id=?`,
        [name, phone || '', 'form', ip, country, city, device_type, browser, visitor_id]
      );
    } else {
      const [result] = await db.query(
        `INSERT INTO visitors
           (business_id, name, email, phone, lead_source, traffic_source,
            ip_address, country, city, device_type, browser)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [biz.id, name, email, phone || '', 'form', referrer || page || 'direct',
         ip, country, city, device_type, browser]
      );
      visitor_id = result.insertId;
    }

    // ── Save to offline_messages (always, with visitor_id + custom_fields) ────
    // custom_fields arrives as JSON array: [{label, value}, ...]
    const customFieldsJson = custom_fields
      ? (typeof custom_fields === 'string' ? custom_fields : JSON.stringify(custom_fields))
      : null;

    await db.query(
      `INSERT INTO offline_messages
         (business_id, visitor_id, name, email, phone, message, custom_fields)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [biz.id, visitor_id, name, email, phone || '', message || '', customFieldsJson]
    );

    // ── Notification ──────────────────────────────────────────────────────────
    try {
      const locationStr = [city, country].filter(Boolean).join(', ');
      await db.query(
        'INSERT INTO business_notifications (business_id, type, title, message) VALUES (?,?,?,?)',
        [biz.id, 'new_lead', 'New Lead from Contact Form 👥',
         `${name} (${email}${phone ? ', ' + phone : ''})${locationStr ? ' from ' + locationStr : ''} submitted the contact form.`]
      );
    } catch(e) {}

    res.json({ success: true, message: 'Contact form submitted successfully' });
  } catch(err) {
    console.error('Contact form error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET: Form submissions for a visitor (used by Lead Details panel) ──────────
router.get('/submissions/:visitor_id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email, phone, message, custom_fields, created_at
       FROM offline_messages
       WHERE visitor_id = ?
       ORDER BY created_at DESC`,
      [req.params.visitor_id]
    );
    const data = rows.map(r => ({
      ...r,
      custom_fields: r.custom_fields
        ? (() => { try { return JSON.parse(r.custom_fields); } catch(e) { return []; } })()
        : [],
    }));
    res.json({ success: true, data });
  } catch(err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;