const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

const sendEmail = async (to, subject, html) => {
  try {
    await transporter.sendMail({
      from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
      to,
      subject,
      html
    });
    console.log(`📧 Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error(`❌ Email failed to ${to}:`, err.message);
    return false;
  }
};

// Email Templates
const emails = {

  accountActivated: (businessName, email) => ({
    subject: 'Your MSChat Account is Now Active! 🎉',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#00d55b;font-size:28px;margin:0;">MSChat</h1>
          <p style="color:#888;font-size:12px;margin:4px 0 0;">by MS Discoveries</p>
        </div>
        <h2 style="color:#fff;">Your account is now active!</h2>
        <p style="color:#aaa;">Hi <strong style="color:#fff;">${businessName}</strong>,</p>
        <p style="color:#aaa;">Great news! Your payment has been verified and your MSChat account is now fully active.</p>
        <p style="color:#aaa;">You can now log in to your dashboard and start setting up your chat widget.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/login" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Login to Dashboard →</a>
        </div>
        <div style="border-top:1px solid #1e1e1e;padding-top:20px;margin-top:20px;">
          <p style="color:#888;font-size:12px;text-align:center;">MSChat by MS Discoveries | halo@msdiscoveries.com | +91 9443724724</p>
        </div>
      </div>
    `
  }),

  paymentRejected: (businessName, reason) => ({
    subject: 'MSChat Payment Verification Failed',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat</h1>
        <h2 style="color:#ff4444;">Payment Verification Failed</h2>
        <p style="color:#aaa;">Hi <strong style="color:#fff;">${businessName}</strong>,</p>
        <p style="color:#aaa;">Unfortunately we could not verify your payment. Reason: <strong style="color:#fff;">${reason}</strong></p>
        <p style="color:#aaa;">Please resubmit your payment with the correct transaction ID.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/payment" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Resubmit Payment →</a>
        </div>
        <p style="color:#888;font-size:12px;text-align:center;">Need help? Contact halo@msdiscoveries.com | +91 9443724724</p>
      </div>
    `
  }),

  newRegistration: (businessName, email, plan, amount) => ({
    subject: `New MSChat Registration — ${businessName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat Admin Alert</h1>
        <h2 style="color:#fff;">New Business Registration</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:#888;padding:8px 0;">Business Name</td><td style="color:#fff;">${businessName}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Email</td><td style="color:#fff;">${email}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Plan</td><td style="color:#00d55b;">${plan}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Amount</td><td style="color:#fff;">${amount}</td></tr>
        </table>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/super-admin" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">View in Admin Panel →</a>
        </div>
      </div>
    `
  }),

  paymentSubmitted: (businessName, txnId, plan, amount) => ({
    subject: `Payment Submitted for Verification — ${businessName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat Admin Alert</h1>
        <h2 style="color:#fff;">Payment Submitted for Verification</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:#888;padding:8px 0;">Business</td><td style="color:#fff;">${businessName}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">TXN ID</td><td style="color:#00d55b;">${txnId}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Plan</td><td style="color:#fff;">${plan}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Amount</td><td style="color:#fff;">${amount}</td></tr>
        </table>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/super-admin/payments" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Payment →</a>
        </div>
      </div>
    `
  }),

  renewalReminder: (businessName, daysLeft, expiryDate, plan) => ({
    subject: `MSChat Subscription Expiring in ${daysLeft} Days`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat</h1>
        <h2 style="color:#f59e0b;">⚠ Your subscription expires in ${daysLeft} days</h2>
        <p style="color:#aaa;">Hi <strong style="color:#fff;">${businessName}</strong>,</p>
        <p style="color:#aaa;">Your <strong style="color:#fff;">${plan}</strong> plan expires on <strong style="color:#f59e0b;">${expiryDate}</strong>.</p>
        <p style="color:#aaa;">Please renew before expiry to avoid service interruption.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/billing" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Renew Now →</a>
        </div>
        <p style="color:#888;font-size:12px;text-align:center;">Questions? Contact halo@msdiscoveries.com | +91 9443724724</p>
      </div>
    `
  }),

  accountSuspended: (businessName, gracePeriodEnds) => ({
    subject: 'MSChat Account Suspended — Action Required',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat</h1>
        <h2 style="color:#ff4444;">Your account has been suspended</h2>
        <p style="color:#aaa;">Hi <strong style="color:#fff;">${businessName}</strong>,</p>
        <p style="color:#aaa;">Your MSChat subscription has expired and your account is now suspended.</p>
        <p style="color:#aaa;"><strong style="color:#f59e0b;">You have 5 days to reactivate your account by making a payment.</strong></p>
        <p style="color:#aaa;">Grace period ends: <strong style="color:#ff4444;">${gracePeriodEnds}</strong></p>
        <p style="color:#aaa;">After this date, your account will enter a 3-day deletion countdown.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/billing" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Reactivate Now →</a>
        </div>
      </div>
    `
  }),

  deletionWarning: (businessName, deletionDate) => ({
    subject: '⚠ FINAL WARNING — MSChat Account Deletion in 3 Days',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat</h1>
        <h2 style="color:#ff4444;">⚠ FINAL WARNING — Account Deletion</h2>
        <p style="color:#aaa;">Hi <strong style="color:#fff;">${businessName}</strong>,</p>
        <p style="color:#aaa;"><strong style="color:#ff4444;">Your account will be permanently deleted on ${deletionDate}.</strong></p>
        <p style="color:#aaa;">All your data — agents, chat history, branding, visitor info — will be permanently deleted with NO recovery possible.</p>
        <p style="color:#aaa;">This is your last chance to save your account.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/billing" style="background:#ff4444;color:#fff;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Save My Account Now →</a>
        </div>
        <p style="color:#888;font-size:12px;text-align:center;">Need help? Contact halo@msdiscoveries.com | +91 9443724724</p>
      </div>
    `
  }),

  forgotPasswordAdmin: (agentName, agentEmail, businessName) => ({
    subject: `Password Reset Request — Agent ${agentName} (${businessName})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#000;color:#fff;padding:30px;border-radius:12px;">
        <h1 style="color:#00d55b;">MSChat Admin Alert</h1>
        <h2 style="color:#fff;">Agent Password Reset Request</h2>
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="color:#888;padding:8px 0;">Agent Name</td><td style="color:#fff;">${agentName}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Agent Email</td><td style="color:#fff;">${agentEmail}</td></tr>
          <tr><td style="color:#888;padding:8px 0;">Business</td><td style="color:#fff;">${businessName}</td></tr>
        </table>
        <p style="color:#aaa;margin-top:16px;">Please log into the admin panel and reset this agent's password manually.</p>
        <div style="text-align:center;margin:30px 0;">
          <a href="https://mschat.msdiscoveries.com/super-admin/agents" style="background:#00d55b;color:#000;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Admin Panel →</a>
        </div>
      </div>
    `
  })

};

module.exports = { sendEmail, emails };
