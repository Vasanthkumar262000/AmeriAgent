const express = require('express');
const router  = express.Router();
const db      = require('../config/db');

// ─── META WEBHOOK VERIFICATION ────────────────────────────────────────────────
router.get('/meta', (req, res) => {
  const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || 'mschat_meta_verify';
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Meta webhook verified');
    return res.status(200).send(challenge);
  }
  res.status(403).json({ error: 'Verification failed' });
});

// ─── META WEBHOOK — RECEIVE LEADS ─────────────────────────────────────────────
router.post('/meta', async (req, res) => {
  try {
    res.status(200).json({ status: 'ok' });

    const body = req.body;
    if (body.object !== 'page') return;

    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.field !== 'leadgen') continue;

        const leadgenId = change.value?.leadgen_id;
        const pageId    = change.value?.page_id;
        const adId      = change.value?.ad_id;
        const formId    = change.value?.form_id;

        if (!leadgenId) continue;

        try {
          const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
          if (!accessToken) { console.log('META_PAGE_ACCESS_TOKEN not set'); continue; }

          const fetch = require('node-fetch');
          const metaRes = await fetch(
            `https://graph.facebook.com/v19.0/${leadgenId}?access_token=${accessToken}`
          );
          const leadData = await metaRes.json();

          if (!leadData || leadData.error) {
            console.error('Meta lead fetch error:', leadData?.error);
            continue;
          }

          const fields = {};
          (leadData.field_data || []).forEach(f => {
            fields[f.name.toLowerCase()] = f.values?.[0] || '';
          });

          const name     = fields['full_name'] || fields['name'] || '';
          const email    = fields['email'] || '';
          const phone    = fields['phone_number'] || fields['phone'] || '';
          const campaign = change.value?.campaign_name || 'Meta Ad';

          if (!email && !phone) continue;

          const [[bizRow]] = await db.query(
            `SELECT b.id FROM businesses b
             JOIN plan_settings ps ON b.plan_key = ps.plan_key
             WHERE b.meta_page_id = ? AND b.account_status = 'active'
               AND ps.has_ads_integration = 1`,
            [pageId]
          );

          if (!bizRow) {
            console.log(`No active business found for Meta page_id: ${pageId}`);
            continue;
          }

          await saveLead(bizRow.id, {
            name, email, phone,
            lead_source: 'meta_ad',
            traffic_source: campaign,
            ad_platform: 'meta',
            ad_id: adId,
            form_id: formId,
          });

          console.log(`✅ Meta lead saved: ${name} (${email}) for business ${bizRow.id}`);
        } catch (e) {
          console.error('Meta lead processing error:', e.message);
        }
      }
    }
  } catch (err) {
    console.error('Meta webhook error:', err.message);
  }
});

// ─── GOOGLE ADS WEBHOOK — RECEIVE LEADS ───────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const googleSecret = req.headers['google-gclid-secret'] || req.headers['x-google-secret'] || req.body.google_key;
    const [[bizRow]] = await db.query(
      `SELECT b.id FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.google_ads_secret = ? AND b.account_status = 'active'
         AND ps.has_ads_integration = 1`,
      [googleSecret]
    ).catch(() => [[null]]);

    if (!bizRow) {
      return res.status(403).json({ success: false, message: 'Invalid secret or plan does not support ads integration' });
    }

    const { name, email, phone, campaign_name, ad_id } = req.body;

    if (!name && !email) {
      return res.status(400).json({ success: false, message: 'Name or email required' });
    }

    await saveLead(bizRow.id, {
      name:           name || '',
      email:          email || '',
      phone:          phone || '',
      lead_source:    'google_ad',
      traffic_source: campaign_name || 'Google Ad',
      ad_platform:    'google',
      ad_id:          ad_id || null,
    });

    console.log(`✅ Google lead saved: ${name} (${email}) for business ${bizRow.id}`);
    res.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('Google webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── HELPER: Authenticate property portal by secret key ───────────────────────
async function getBusinessBySecret(secret) {
  const [[bizRow]] = await db.query(
    `SELECT b.id FROM businesses b
     JOIN plan_settings ps ON b.plan_key = ps.plan_key
     WHERE b.property_portal_secret = ? AND b.account_status = 'active'
       AND ps.has_ads_integration = 1`,
    [secret]
  ).catch(() => [[null]]);
  return bizRow || null;
}

// ─── 99ACRES WEBHOOK — RECEIVE LEADS ──────────────────────────────────────────
// Webhook URL to give 99Acres: POST /api/ad-leads/99acres
// Header: x-portal-secret: <your_property_portal_secret>
// They send: sender_name, sender_email, sender_phone, property_name, location, budget
router.post('/99acres', async (req, res) => {
  try {
    const secret  = req.headers['x-portal-secret'] || req.body.secret_key;
    const bizRow  = await getBusinessBySecret(secret);

    if (!bizRow) {
      return res.status(403).json({ success: false, message: 'Invalid secret key' });
    }

    const {
      sender_name, sender_email, sender_phone,
      property_name, location, budget,
      name, email, phone  // fallback field names
    } = req.body;

    const leadName  = sender_name  || name  || '';
    const leadEmail = sender_email || email || '';
    const leadPhone = sender_phone || phone || '';
    const property  = property_name || '';
    const source    = [property, location, budget ? `Budget: ${budget}` : ''].filter(Boolean).join(' | ');

    if (!leadName && !leadEmail && !leadPhone) {
      return res.status(400).json({ success: false, message: 'At least one of name, email, or phone is required' });
    }

    await saveLead(bizRow.id, {
      name:           leadName,
      email:          leadEmail,
      phone:          leadPhone,
      lead_source:    '99acres',
      traffic_source: source || '99Acres',
      ad_platform:    '99acres',
    });

    console.log(`✅ 99Acres lead saved: ${leadName} (${leadPhone}) for business ${bizRow.id}`);
    res.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('99Acres webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── HOUSING.COM WEBHOOK — RECEIVE LEADS ──────────────────────────────────────
// Webhook URL to give Housing.com: POST /api/ad-leads/housing
// Header: x-portal-secret: <your_property_portal_secret>
// They send: name, email, phone, project_name, city, enquiry_type
router.post('/housing', async (req, res) => {
  try {
    const secret  = req.headers['x-portal-secret'] || req.body.secret_key;
    const bizRow  = await getBusinessBySecret(secret);

    if (!bizRow) {
      return res.status(403).json({ success: false, message: 'Invalid secret key' });
    }

    const {
      name, email, phone,
      project_name, city, enquiry_type
    } = req.body;

    if (!name && !email && !phone) {
      return res.status(400).json({ success: false, message: 'At least one of name, email, or phone is required' });
    }

    const source = [project_name, city, enquiry_type].filter(Boolean).join(' | ');

    await saveLead(bizRow.id, {
      name:           name || '',
      email:          email || '',
      phone:          phone || '',
      lead_source:    'housing',
      traffic_source: source || 'Housing.com',
      ad_platform:    'housing',
    });

    console.log(`✅ Housing.com lead saved: ${name} (${phone}) for business ${bizRow.id}`);
    res.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('Housing.com webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── MAGICBRICKS WEBHOOK — RECEIVE LEADS ──────────────────────────────────────
// Webhook URL to give MagicBricks: POST /api/ad-leads/magicbricks
// Header: x-portal-secret: <your_property_portal_secret>
// They send: buyerName, buyerEmail, buyerPhone, propertyId, propertyTitle, locality
router.post('/magicbricks', async (req, res) => {
  try {
    const secret  = req.headers['x-portal-secret'] || req.body.secret_key;
    const bizRow  = await getBusinessBySecret(secret);

    if (!bizRow) {
      return res.status(403).json({ success: false, message: 'Invalid secret key' });
    }

    const {
      buyerName, buyerEmail, buyerPhone,
      propertyTitle, locality,
      name, email, phone  // fallback field names
    } = req.body;

    const leadName  = buyerName  || name  || '';
    const leadEmail = buyerEmail || email || '';
    const leadPhone = buyerPhone || phone || '';
    const source    = [propertyTitle, locality].filter(Boolean).join(' | ');

    if (!leadName && !leadEmail && !leadPhone) {
      return res.status(400).json({ success: false, message: 'At least one of name, email, or phone is required' });
    }

    await saveLead(bizRow.id, {
      name:           leadName,
      email:          leadEmail,
      phone:          leadPhone,
      lead_source:    'magicbricks',
      traffic_source: source || 'MagicBricks',
      ad_platform:    'magicbricks',
    });

    console.log(`✅ MagicBricks lead saved: ${leadName} (${leadPhone}) for business ${bizRow.id}`);
    res.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('MagicBricks webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── INDIAMART WEBHOOK — RECEIVE LEADS ────────────────────────────────────────
// Webhook URL to give IndiaMART: POST /api/ad-leads/indiamart
// Header: x-portal-secret: <your_property_portal_secret>
// They send: SENDER_NAME, SENDER_EMAIL, SENDER_MOBILE, SUBJECT, QUERY_MESSAGE
router.post('/indiamart', async (req, res) => {
  try {
    const secret  = req.headers['x-portal-secret'] || req.body.secret_key;
    const bizRow  = await getBusinessBySecret(secret);

    if (!bizRow) {
      return res.status(403).json({ success: false, message: 'Invalid secret key' });
    }

    // IndiaMART uses UPPERCASE field names
    const {
      SENDER_NAME, SENDER_EMAIL, SENDER_MOBILE, SUBJECT, QUERY_MESSAGE,
      name, email, phone  // fallback field names
    } = req.body;

    const leadName  = SENDER_NAME   || name  || '';
    const leadEmail = SENDER_EMAIL  || email || '';
    const leadPhone = SENDER_MOBILE || phone || '';
    const subject   = SUBJECT       || 'IndiaMART Enquiry';
    const message   = QUERY_MESSAGE || '';

    if (!leadName && !leadEmail && !leadPhone) {
      return res.status(400).json({ success: false, message: 'At least one of name, email, or phone is required' });
    }

    const source = [subject, message ? message.substring(0, 60) : ''].filter(Boolean).join(': ');

    await saveLead(bizRow.id, {
      name:           leadName,
      email:          leadEmail,
      phone:          leadPhone,
      lead_source:    'indiamart',
      traffic_source: source || 'IndiaMART',
      ad_platform:    'indiamart',
    });

    console.log(`✅ IndiaMART lead saved: ${leadName} (${leadPhone}) for business ${bizRow.id}`);
    res.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('IndiaMART webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── JUSTDIAL WEBHOOK — RECEIVE LEADS ─────────────────────────────────────────
// Webhook URL to give JustDial: POST /api/ad-leads/justdial
// Header: x-portal-secret: <your_property_portal_secret>
// They send: name, phone, email, category, city, leadtype, response (their JSON is sometimes URL-encoded)
router.post('/justdial', async (req, res) => {
  try {
    const secret  = req.headers['x-portal-secret'] || req.body.secret_key;
    const bizRow  = await getBusinessBySecret(secret);

    if (!bizRow) {
      return res.status(403).json({ success: false, message: 'Invalid secret key' });
    }

    // JustDial sometimes sends a nested "leads" array
    let leadData = req.body;
    if (req.body.leads && Array.isArray(req.body.leads) && req.body.leads.length > 0) {
      leadData = req.body.leads[0];
    }

    const {
      name, phone, email,
      category, city, leadtype
    } = leadData;

    if (!name && !email && !phone) {
      return res.status(400).json({ success: false, message: 'At least one of name, email, or phone is required' });
    }

    const source = [category, city, leadtype].filter(Boolean).join(' | ');

    await saveLead(bizRow.id, {
      name:           name   || '',
      email:          email  || '',
      phone:          phone  || '',
      lead_source:    'justdial',
      traffic_source: source || 'JustDial',
      ad_platform:    'justdial',
    });

    console.log(`✅ JustDial lead saved: ${name} (${phone}) for business ${bizRow.id}`);
    res.json({ success: true, message: 'Lead received' });
  } catch (err) {
    console.error('JustDial webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── HELPER: Save lead to visitors table ──────────────────────────────────────
async function saveLead(business_id, { name, email, phone, lead_source, traffic_source, ad_platform, ad_id, form_id }) {
  const [[existing]] = await db.query(
    'SELECT id FROM visitors WHERE business_id = ? AND (email = ? OR (phone = ? AND phone != ""))',
    [business_id, email || '__no_email__', phone || '__no_phone__']
  );

  if (existing) {
    await db.query(
      `UPDATE visitors SET
         name=?, phone=?, last_visit_at=NOW(),
         lead_source=?, traffic_source=?
       WHERE id=?`,
      [name, phone || '', lead_source, traffic_source, existing.id]
    );
  } else {
    await db.query(
      `INSERT INTO visitors
         (business_id, name, email, phone, lead_source, traffic_source)
       VALUES (?,?,?,?,?,?)`,
      [business_id, name, email || '', phone || '', lead_source, traffic_source]
    );
  }

  // Platform label for notification
  const platformLabels = {
    meta:        '📘 Meta Ad',
    google:      '🟢 Google Ad',
    '99acres':   '🏠 99Acres',
    housing:     '🏡 Housing.com',
    magicbricks: '🧱 MagicBricks',
    indiamart:   '🛒 IndiaMART',
    justdial:    '📞 JustDial',
  };
  const platformLabel = platformLabels[ad_platform] || '🎯 Ad Lead';

  try {
    await db.query(
      'INSERT INTO business_notifications (business_id, type, title, message) VALUES (?,?,?,?)',
      [
        business_id,
        'new_lead',
        `New Lead from ${platformLabel}`,
        `${name} (${email || ''}${phone ? (email ? ', ' : '') + phone : ''}) enquired via ${platformLabel}.`
      ]
    );
  } catch(e) {}
}

module.exports = router;