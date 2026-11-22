const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const authMiddleware = require('../middleware/auth');
const paymentCtrl = require('../controllers/paymentController');
const db = require('../config/db');

// Ensure uploads dir exists
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `txn_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const paymentRouter = express.Router();

// ─── PUBLIC: Submit payment without auth (for new registrations) ──────────────
paymentRouter.post('/submit-public', upload.single('screenshot'), async (req, res) => {
  const { txn_id, bank_account, currency, billing_cycle, plan_key, business_id, email, address, gstin } = req.body;

  if (!txn_id) return res.status(400).json({ success: false, message: 'Transaction ID is required' });

  try {
    // Find business by ID or email
    let biz;
    if (business_id) {
      const [rows] = await db.query('SELECT * FROM businesses WHERE id = ?', [business_id]);
      biz = rows[0];
    }
    if (!biz && email) {
      const [rows] = await db.query('SELECT * FROM businesses WHERE CONVERT(email USING utf8mb4) = ?', [email]);
      biz = rows[0];
    }
    if (!biz) return res.status(404).json({ success: false, message: 'Business account not found. Please register first.' });

    const screenshot_url = req.file ? `/uploads/${req.file.filename}` : null;
    const curr = (currency || biz.currency || 'inr').toLowerCase();
    const cycle = billing_cycle || biz.billing_cycle || 'monthly';
    const pkey = plan_key || biz.plan_key;
    const bank = (bank_account || 'india').toLowerCase();

    // Get plan price
    const [plans] = await db.query('SELECT * FROM plan_settings WHERE plan_key = ?', [pkey]);
    const plan = plans[0];
    let amount = 0;
    if (plan) {
      if (curr === 'usd') {
        if (cycle === 'yearly') amount = Math.round(Number(plan.price_monthly_usd) * 12 * 0.80);
        else if (cycle === 'quarterly') amount = Math.round(Number(plan.price_monthly_usd) * 3 * 0.90);
        else amount = Number(plan.price_monthly_usd);
      } else {
        if (cycle === 'yearly') amount = Math.round(Number(plan.price_monthly_inr) * 12 * 0.80);
        else if (cycle === 'quarterly') amount = Math.round(Number(plan.price_monthly_inr) * 3 * 0.90);
        else amount = Number(plan.price_monthly_inr);
      }
    }

    // Insert transaction — use correct column names from schema
    await db.query(
      `INSERT INTO payment_transactions 
       (business_id, plan_key, billing_cycle, currency, amount, bank_account, txn_id, screenshot_url, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [biz.id, pkey, cycle, curr, amount, bank, txn_id, screenshot_url]
    );

    // Update business status
    // For renewal (active account) - keep active, just mark payment as pending_verification
    // For new registration - set to pending_approval
    const isRenewal = biz.account_status === 'active';
    await db.query(
      `UPDATE businesses SET 
        account_status = ?,
        payment_status = 'pending_verification',
        billing_cycle = ?
       WHERE id = ?`,
      [isRenewal ? 'active' : 'pending_approval', cycle, biz.id]
    );

    // Notify super admin by email (don't fail if email fails)
    try {
      const { sendEmail } = require('../utils/email');
      await sendEmail(
        process.env.SUPER_ADMIN_EMAIL,
        `New Payment Submitted - ${biz.company_name}`,
        `<div style="font-family:sans-serif;padding:20px;background:#f9f9f9">
          <h2 style="color:#00d55b">New Payment Submitted</h2>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;color:#666">Company</td><td style="padding:8px;font-weight:bold">${biz.company_name}</td></tr>
            <tr><td style="padding:8px;color:#666">Email</td><td style="padding:8px">${biz.email}</td></tr>
            <tr><td style="padding:8px;color:#666">Phone</td><td style="padding:8px">${biz.phone}</td></tr>
            <tr><td style="padding:8px;color:#666">Plan</td><td style="padding:8px">${pkey}</td></tr>
            <tr><td style="padding:8px;color:#666">TXN ID</td><td style="padding:8px;font-family:monospace;font-weight:bold">${txn_id}</td></tr>
            <tr><td style="padding:8px;color:#666">Bank</td><td style="padding:8px">${bank === 'india' ? 'India (INR)' : 'US (USD)'}</td></tr>
            <tr><td style="padding:8px;color:#666">Amount</td><td style="padding:8px;font-weight:bold">${curr.toUpperCase()} ${amount}</td></tr>
          </table>
          <p style="margin-top:16px">Login to admin panel to verify and approve: <a href="https://mschat.msdiscoveries.com/login">MSChat Admin</a></p>
        </div>`
      );
    } catch (emailErr) {
      console.log('Admin notification email failed:', emailErr.message);
    }

    res.json({ success: true, message: 'Payment submitted successfully! Admin will verify and activate your account.' });
  } catch (err) {
    console.error('Payment submit-public error:', err.message, err.stack);
    res.status(500).json({ success: false, message: 'Submission failed: ' + err.message });
  }
});

// ─── AUTHENTICATED ROUTES ─────────────────────────────────────────────────────
paymentRouter.get('/bank-details', authMiddleware(['business']), paymentCtrl.getBankDetails);
paymentRouter.post('/submit', authMiddleware(['business']), upload.single('screenshot'), paymentCtrl.submitPayment);
paymentRouter.get('/pending', authMiddleware(['super_admin']), paymentCtrl.getPendingPayments);
paymentRouter.put('/approve/:transaction_id', authMiddleware(['super_admin']), paymentCtrl.approvePayment);
paymentRouter.put('/reject/:transaction_id', authMiddleware(['super_admin']), paymentCtrl.rejectPayment);

// ─── GENERATE INVOICE ─────────────────────────────────────────────────────────
paymentRouter.get('/invoice/:transaction_id', async (req, res) => {
  try {
    const txnId = parseInt(req.params.transaction_id);
    if (!txnId) return res.status(400).json({ success: false, message: 'Invalid ID' });

    const [rows] = await db.query(
      `SELECT pt.id, pt.business_id, pt.plan_key, pt.billing_cycle, pt.currency,
              pt.amount, pt.bank_account, pt.txn_id, pt.submitted_at,
              b.company_name, b.owner_name, b.email as business_email, b.phone,
              b.address, b.gstin, b.state,
              COALESCE(ps.plan_name, pt.plan_key) as plan_name
       FROM payment_transactions pt
       JOIN businesses b ON pt.business_id = b.id
       LEFT JOIN plan_settings ps ON pt.plan_key = ps.plan_key
       WHERE pt.id = ?`,
      [txnId]
    );

    if (!rows.length) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const generateInvoice = require('../utils/generateInvoice');
    const html = generateInvoice(rows[0]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    console.error('Invoice error:', err.message, err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET ALL PAYMENTS FOR BUSINESS (Billing page) ────────────────────────────
paymentRouter.get('/my-payments', authMiddleware(['business']), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pt.*, ps.plan_name FROM payment_transactions pt
       LEFT JOIN plan_settings ps ON pt.plan_key = ps.plan_key
       WHERE pt.business_id = ? ORDER BY pt.submitted_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = paymentRouter;
