const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');
const { sendEmail, emails } = require('../utils/email');
require('dotenv').config();

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// ─── BUSINESS REGISTRATION ────────────────────────────────────────────────────
exports.registerBusiness = async (req, res) => {
  const { company_name, owner_name, email, phone, password, plan_key, billing_cycle, currency, address, gstin, state } = req.body;
  try {
    const [existing] = await db.query('SELECT id FROM businesses WHERE email = ?', [email]);
    if (existing.length) return res.status(400).json({ success: false, message: 'Email already registered' });

    const password_hash = await bcrypt.hash(password, 12);
    const bot_id = uuidv4().replace(/-/g, '').substring(0, 20);

    const [result] = await db.query(
      `INSERT INTO businesses (company_name, owner_name, email, phone, password_hash, plan_key, billing_cycle, currency, address, gstin, state, account_status, payment_status, bot_id, month_reset_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', 'unpaid', ?, DATE_ADD(CURDATE(), INTERVAL 1 MONTH))`,
      [company_name, owner_name, email, phone, password_hash, plan_key, billing_cycle, currency, address || '', gstin || '', state || '', bot_id]
    );

    await db.query('INSERT INTO business_branding (business_id) VALUES (?)', [result.insertId]);

    const [plan] = await db.query('SELECT plan_name FROM plan_settings WHERE plan_key = ?', [plan_key]);
    try {
      await sendEmail(
        process.env.SUPER_ADMIN_EMAIL,
        emails.newRegistration(company_name, email, plan[0]?.plan_name, '').subject,
        emails.newRegistration(company_name, email, plan[0]?.plan_name, '').html
      );
    } catch(e) { console.log('Email error:', e.message); }

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please complete payment to activate your account.',
      data: { business_id: result.insertId, bot_id }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

// ─── BUSINESS LOGIN ───────────────────────────────────────────────────────────
exports.loginBusiness = async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT b.*, ps.max_agents, ps.max_chats_per_month, ps.has_ai, ps.has_custom_branding,
              ps.has_analytics, ps.has_canned_replies, ps.has_white_label, ps.chat_history_days,
              ps.has_ads_integration, ps.plan_name
       FROM businesses b
       LEFT JOIN plan_settings ps ON b.plan_key = ps.plan_key
       WHERE b.email = ?`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const business = rows[0];
    const valid = await bcrypt.compare(password, business.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    if (business.account_status === 'pending_payment') {
      return res.status(403).json({ success: false, message: 'Please complete payment to access your account', status: 'pending_payment' });
    }
    if (business.account_status === 'pending_approval') {
      return res.status(403).json({ success: false, message: 'Your payment is under review.', status: 'pending_approval' });
    }
    if (business.account_status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Your account is suspended.', status: 'suspended' });
    }
    if (business.account_status === 'deleted') {
      return res.status(403).json({ success: false, message: 'This account has been deleted.', status: 'deleted' });
    }

    const token = generateToken({ id: business.id, role: 'business', email: business.email, bot_id: business.bot_id });
    delete business.password_hash;
    business.role = 'business'; // always set role explicitly

    res.json({ success: true, message: 'Login successful', token, data: business });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ─── AGENT LOGIN ──────────────────────────────────────────────────────────────
exports.loginAgent = async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT a.*, b.company_name, b.account_status, b.bot_id, b.plan_key,
              b.welcome_message, b.offline_message
       FROM agents a
       JOIN businesses b ON a.business_id = b.id
       WHERE a.email = ?`,
      [email]
    );
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const agent = rows[0];
    if (!agent.is_active) return res.status(403).json({ success: false, message: 'Your account has been deactivated' });
    if (agent.account_status !== 'active') return res.status(403).json({ success: false, message: 'Business account is not active' });

    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    await db.query('UPDATE agents SET last_seen_at = NOW() WHERE id = ?', [agent.id]);

    const token = generateToken({ id: agent.id, role: agent.role, business_id: agent.business_id, email: agent.email });
    delete agent.password_hash;
    // role already exists in agent object from DB

    res.json({ success: true, message: 'Login successful', token, data: agent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ─── SUPER ADMIN LOGIN ────────────────────────────────────────────────────────
exports.loginSuperAdmin = async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM super_admins WHERE id = 1 AND is_active = 1');
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const admin = rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = generateToken({ id: admin.id, role: 'super_admin', email: admin.email });
    delete admin.password_hash;
    admin.role = 'super_admin'; // always set role explicitly

    res.json({ success: true, message: 'Login successful', token, data: admin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

// ─── CHANGE PASSWORD (Agent) ──────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  const agentId = req.user.id;
  try {
    const [rows] = await db.query('SELECT password_hash FROM agents WHERE id = ?', [agentId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Agent not found' });

    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const new_hash = await bcrypt.hash(new_password, 12);
    await db.query('UPDATE agents SET password_hash = ? WHERE id = ?', [new_hash, agentId]);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Password change failed' });
  }
};

// ─── FORGOT PASSWORD ──────────────────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT a.*, b.company_name FROM agents a
       JOIN businesses b ON a.business_id = b.id
       WHERE a.email = ?`,
      [email]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Agent not found' });

    const agent = rows[0];
    await db.query('UPDATE agents SET forgot_password_requested = 1, forgot_password_at = NOW() WHERE id = ?', [agent.id]);

    try {
      const emailData = emails.forgotPasswordAdmin(agent.name, agent.email, agent.company_name);
      await sendEmail(process.env.SUPER_ADMIN_EMAIL, emailData.subject, emailData.html);
    } catch(e) { console.log('Email error:', e.message); }

    await db.query(
      `INSERT INTO notifications (recipient_type, recipient_id, type, title, message)
       VALUES ('super_admin', 1, 'forgot_password', 'Password Reset Request', ?)`,
      [`Agent ${agent.name} from ${agent.company_name} requested password reset.`]
    );

    res.json({ success: true, message: 'Password reset request sent to administrator.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Request failed' });
  }
};