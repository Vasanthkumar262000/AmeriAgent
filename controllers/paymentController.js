const db = require('../config/db');
const { sendEmail, emails } = require('../utils/email');
require('dotenv').config();

// Bank account details
const bankAccounts = {
  india: {
    ac_name: process.env.INDIA_BANK_AC_NAME,
    ac_no: process.env.INDIA_BANK_AC_NO,
    bank_name: process.env.INDIA_BANK_NAME,
    branch: process.env.INDIA_BANK_BRANCH,
    ifsc: process.env.INDIA_BANK_IFSC,
    swift: process.env.INDIA_BANK_SWIFT,
    currency: 'INR'
  },
  us: {
    ac_name: process.env.US_BANK_AC_NAME,
    ac_no: process.env.US_BANK_AC_NO,
    routing: process.env.US_BANK_ROUTING,
    bank_name: process.env.US_BANK_NAME,
    address: process.env.US_BANK_ADDRESS,
    currency: 'USD'
  }
};

// ─── GET BANK DETAILS ─────────────────────────────────────────────────────────
exports.getBankDetails = async (req, res) => {
  try {
    const [business] = await db.query(
      `SELECT b.*, ps.plan_name, ps.price_monthly_usd, ps.price_yearly_usd,
              ps.price_monthly_inr, ps.price_yearly_inr
       FROM businesses b
       JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.id = ?`,
      [req.user.id]
    );
    if (!business.length) return res.status(404).json({ success: false, message: 'Business not found' });

    const biz = business[0];
    const isYearly = biz.billing_cycle === 'yearly';
    const isINR = biz.currency === 'inr';
    const amount = isINR
      ? (isYearly ? biz.price_yearly_inr * 12 : biz.price_monthly_inr)
      : (isYearly ? biz.price_yearly_usd * 12 : biz.price_monthly_usd);

    res.json({
      success: true,
      data: {
        bank_accounts: bankAccounts,
        plan: biz.plan_name,
        billing_cycle: biz.billing_cycle,
        currency: biz.currency,
        amount,
        amount_formatted: isINR ? `₹${amount.toLocaleString('en-IN')}` : `$${amount}`
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to get bank details' });
  }
};

// ─── SUBMIT PAYMENT ───────────────────────────────────────────────────────────
exports.submitPayment = async (req, res) => {
  const { txn_id, bank_account, amount, currency } = req.body;
  const business_id = req.user.id;
  const screenshot_url = req.file ? `/uploads/${req.file.filename}` : null;

  try {
    const [business] = await db.query(
      'SELECT *, (SELECT plan_name FROM plan_settings WHERE plan_key = businesses.plan_key) as plan_name FROM businesses WHERE id = ?',
      [business_id]
    );
    if (!business.length) return res.status(404).json({ success: false, message: 'Business not found' });

    const biz = business[0];

    // Save transaction
    await db.query(
      `INSERT INTO payment_transactions (business_id, plan_key, billing_cycle, currency, amount, bank_account, txn_id, screenshot_url, payment_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [business_id, biz.plan_key, biz.billing_cycle, currency, amount, bank_account, txn_id, screenshot_url]
    );

    // Update business status
    await db.query(
      'UPDATE businesses SET account_status = ?, payment_status = ? WHERE id = ?',
      ['pending_approval', 'pending_verification', business_id]
    );

    // Notify super admin
    const emailData = emails.paymentSubmitted(biz.company_name, txn_id, biz.plan_name, `${currency.toUpperCase()} ${amount}`);
    await sendEmail(process.env.SUPER_ADMIN_EMAIL, emailData.subject, emailData.html);

    // Log notification in DB
    await db.query(
      `INSERT INTO notifications (recipient_type, recipient_id, type, title, message)
       VALUES ('super_admin', 1, 'payment_submitted', 'New Payment for Verification', ?)`,
      [`${biz.company_name} submitted TXN ID: ${txn_id} for ${biz.plan_name}`]
    );

    res.json({ success: true, message: 'Payment submitted successfully. Admin will verify and activate your account shortly.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Payment submission failed' });
  }
};

// ─── APPROVE PAYMENT (Super Admin) ───────────────────────────────────────────
exports.approvePayment = async (req, res) => {
  const { transaction_id } = req.params;
  try {
    const [txn] = await db.query(
      `SELECT pt.*, b.company_name, b.email, b.billing_cycle
       FROM payment_transactions pt
       JOIN businesses b ON pt.business_id = b.id
       WHERE pt.id = ?`,
      [transaction_id]
    );
    if (!txn.length) return res.status(404).json({ success: false, message: 'Transaction not found' });

    const t = txn[0];

    // Calculate exact days: monthly=30, quarterly=90, yearly=365
    const cycleDays = t.billing_cycle === 'yearly' ? 365
                    : t.billing_cycle === 'quarterly' ? 90
                    : 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + cycleDays);

    // Activate business and update billing_cycle + plan_key from transaction
    await db.query(
      `UPDATE businesses SET
        account_status = 'active',
        payment_status = 'paid',
        billing_cycle = ?,
        plan_key = ?,
        plan_started_at = NOW(),
        plan_expires_at = ?,
        suspended_at = NULL,
        grace_period_ends_at = NULL,
        deletion_scheduled_at = NULL
       WHERE id = ?`,
      [t.billing_cycle, t.plan_key, expiresAt, t.business_id]
    );

    // Update transaction
    await db.query(
      'UPDATE payment_transactions SET payment_status = "approved", reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
      [req.user.id, transaction_id]
    );

    // Notify business via in-app notification
    await db.query(
      'INSERT INTO business_notifications (business_id, type, title, message) VALUES (?,?,?,?)',
      [t.business_id, 'payment_approved', 'Payment Approved ✅',
       `Your ${t.billing_cycle} plan payment has been verified and activated. Your plan is now active until ${expiresAt.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}.`]
    );

    // Send activation email
    const emailData = emails.accountActivated(t.company_name, t.email);
    await sendEmail(t.email, emailData.subject, emailData.html);

    // Notify business dashboard
    const cycleLabel = t.billing_cycle === 'quarterly' ? 'Quarterly' : t.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly';
    await db.query(
      `INSERT INTO business_notifications (business_id, type, title, message) VALUES (?, 'payment_approved', 'Payment Approved ✅', ?)`,
      [t.business_id, `Your ${cycleLabel} payment has been approved. Your account is now active.`]
    ).catch(() => {});

    res.json({ success: true, message: 'Payment approved and account activated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Approval failed' });
  }
};

// ─── REJECT PAYMENT (Super Admin) ────────────────────────────────────────────
exports.rejectPayment = async (req, res) => {
  const { transaction_id } = req.params;
  const { reason } = req.body;
  try {
    const [txn] = await db.query(
      `SELECT pt.*, b.company_name, b.email FROM payment_transactions pt
       JOIN businesses b ON pt.business_id = b.id WHERE pt.id = ?`,
      [transaction_id]
    );
    if (!txn.length) return res.status(404).json({ success: false, message: 'Transaction not found' });

    const t = txn[0];

    await db.query(
      'UPDATE payment_transactions SET payment_status = "rejected", rejection_reason = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?',
      [reason, req.user.id, transaction_id]
    );

    await db.query(
      'UPDATE businesses SET account_status = "pending_payment", payment_status = "rejected" WHERE id = ?',
      [t.business_id]
    );

    // Notify business via in-app notification
    await db.query(
      'INSERT INTO business_notifications (business_id, type, title, message) VALUES (?,?,?,?)',
      [t.business_id, 'payment_rejected', 'Payment Rejected ❌',
       `Your payment was rejected. Reason: ${reason || 'Please contact support at halo@msdiscoveries.com'}`]
    );

    const emailData = emails.paymentRejected(t.company_name, reason);
    await sendEmail(t.email, emailData.subject, emailData.html);

    // Notify business dashboard
    await db.query(
      `INSERT INTO business_notifications (business_id, type, title, message) VALUES (?, 'payment_rejected', 'Payment Rejected ❌', ?)`,
      [t.business_id, `Your payment was rejected. Reason: ${reason || 'Contact support for details.'}`]
    ).catch(() => {});

    res.json({ success: true, message: 'Payment rejected and business notified' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Rejection failed' });
  }
};

// ─── GET ALL PENDING PAYMENTS (Super Admin) ───────────────────────────────────
exports.getPendingPayments = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pt.*, b.company_name, b.email, b.phone,
              ps.plan_name
       FROM payment_transactions pt
       JOIN businesses b ON pt.business_id = b.id
       JOIN plan_settings ps ON pt.plan_key = ps.plan_key
       WHERE pt.payment_status IN ('pending', 'pending_verification')
       ORDER BY pt.submitted_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch payments' });
  }
};