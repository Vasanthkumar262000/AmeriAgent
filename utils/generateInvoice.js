module.exports = function generateInvoice(t) {
  const invoiceNo = 'INV-' + String(t.business_id).padStart(4,'0') + '-' + String(t.id).padStart(6,'0');
  const date = new Date(t.submitted_at).toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });
  const isINR = t.currency === 'inr';
  const sym = isINR ? '\u20b9' : '$';
  const baseAmount = Number(t.amount);
  const planLabel = (t.plan_name || t.plan_key || '').replace(/_/g,' ');
  const bankName = t.bank_account === 'india' ? 'Union Bank of India' : 'Community Federal Savings Bank';

  // ─── GST CALCULATION ──────────────────────────────────────────────────────────
  let gstHtml = '';
  let totalAmount = baseAmount;
  let gstType = '';

  if (isINR) {
    const isTamilNadu = t.state && t.state.trim().toLowerCase() === 'tamil nadu';
    const gstAmount = Math.round(baseAmount * 0.18 * 100) / 100;
    totalAmount = Math.round((baseAmount + gstAmount) * 100) / 100;

    if (isTamilNadu) {
      // CGST + SGST for Tamil Nadu
      const cgst = Math.round(gstAmount / 2 * 100) / 100;
      const sgst = Math.round(gstAmount / 2 * 100) / 100;
      gstHtml = `
        <div class="tr"><span>CGST (9%)</span><span>${sym}${cgst.toLocaleString('en-IN')}</span></div>
        <div class="tr"><span>SGST (9%)</span><span>${sym}${sgst.toLocaleString('en-IN')}</span></div>`;
      gstType = 'CGST + SGST (Tamil Nadu)';
    } else {
      // IGST for other Indian states
      gstHtml = `<div class="tr"><span>IGST (18%)</span><span>${sym}${gstAmount.toLocaleString('en-IN')}</span></div>`;
      gstType = 'IGST (Other State)';
    }
  } else {
    // USD — No GST
    gstHtml = `<div class="tr"><span>GST</span><span>Not Applicable</span></div>`;
    gstType = 'No GST (International)';
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<title>Invoice ${invoiceNo}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;padding:40px 20px;color:#111}
.page{max-width:780px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,0.1)}
.header{background:#000;padding:32px 40px;display:flex;justify-content:space-between;align-items:flex-start}
.logo-wrap{display:flex;align-items:center;gap:10px}
.logo-icon{width:40px;height:40px;background:#00d55b;border-radius:10px;display:flex;align-items:center;justify-content:center}
.logo-text{color:#fff;font-size:22px;font-weight:700}
.logo-sub{color:#555;font-size:11px;margin-top:2px}
.inv-label h2{color:#00d55b;font-size:28px;font-weight:800;text-align:right}
.inv-label p{color:#555;font-size:13px;margin-top:4px;text-align:right}
.body{padding:36px 40px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:28px}
.block h4{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:10px}
.block .co{font-size:16px;font-weight:700;margin-bottom:6px}
.block p{font-size:13px;color:#444;line-height:1.9}
.divider{height:1px;background:#f0f0f0;margin:20px 0}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
thead tr{background:#000}
thead th{padding:11px 14px;text-align:left;font-size:11px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.06em}
tbody tr{border-bottom:1px solid #f5f5f5}
tbody td{padding:13px 14px;font-size:14px;color:#111}
.ar{text-align:right;font-weight:700}
.totals{display:flex;justify-content:flex-end}
.totals-box{width:280px}
.tr{display:flex;justify-content:space-between;padding:7px 0;font-size:14px;border-bottom:1px solid #f5f5f5}
.tr.final{border-top:2px solid #000;border-bottom:none;margin-top:6px;padding-top:12px;font-weight:800;font-size:18px}
.gst-note{font-size:11px;color:#888;margin-top:4px;text-align:right}
.pay-info{background:#f9f9f9;border-radius:10px;padding:18px;margin-top:22px}
.pay-info h4{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-bottom:12px}
.pr{display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid #eee}
.pr:last-child{border:none}
.pr span:first-child{color:#888}
.pr span:last-child{font-weight:600}
.gstin-box{background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:8px 12px;margin-top:8px;font-size:12px;color:#166534}
.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;background:rgba(0,200,81,0.1);color:#16a34a;border:1px solid #86efac}
.footer{background:#000;padding:20px 40px;display:flex;justify-content:space-between;align-items:center}
.footer p{font-size:12px;color:#555}
.footer .ty{color:#00d55b;font-weight:700;font-size:14px}
@media print{body{padding:0;background:#fff}.page{box-shadow:none;border-radius:0}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="logo-wrap">
      <div class="logo-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <div>
        <div class="logo-text"><span style="color:#00d55b">MS</span>Chat</div>
        <div class="logo-sub">by MS Discoveries</div>
      </div>
    </div>
    <div class="inv-label">
      <h2>INVOICE</h2>
      <p>${invoiceNo}</p>
      <p style="margin-top:5px">${date}</p>
    </div>
  </div>

  <div class="body">
    <div class="grid">
      <div class="block">
        <h4>From</h4>
        <p class="co">MS Discoveries</p>
        <p>Paramathi Velur, Namakkal</p>
        <p>Tamil Nadu - 638182, India</p>
        <p style="margin-top:4px">halo@msdiscoveries.com</p>
        <p>+91 9443724724</p>
        <div class="gstin-box"><strong>GSTIN:</strong> 33FYQPM9398C1ZP</div>
      </div>
      <div class="block">
        <h4>Billed To</h4>
        <p class="co">${t.company_name}</p>
        <p>${t.owner_name || ''}</p>
        <p>${t.business_email}</p>
        <p>${t.phone || ''}</p>
        ${t.address ? `<p style="margin-top:4px">${t.address}</p>` : ''}
        ${t.state ? `<p>${t.state}</p>` : ''}
        ${t.gstin ? `<div class="gstin-box" style="margin-top:8px"><strong>GSTIN:</strong> ${t.gstin}</div>` : ''}
      </div>
    </div>

    <div class="divider"></div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Plan</th>
          <th>Billing Cycle</th>
          <th>SAC Code</th>
          <th class="ar">Base Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>MSChat SaaS Subscription</td>
          <td style="text-transform:capitalize">${planLabel}</td>
          <td>${
            t.billing_cycle === 'quarterly' ? 'Quarterly Plan' :
            t.billing_cycle === 'yearly' ? 'Yearly Plan' :
            'Monthly Plan'
          }</td>
          <td>998313</td>
          <td class="ar">${sym}${baseAmount.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-box">
        <div class="tr"><span>Subtotal</span><span>${sym}${baseAmount.toLocaleString('en-IN')}</span></div>
        ${gstHtml}
        <div class="tr final"><span>Total</span><span>${sym}${totalAmount.toLocaleString('en-IN')}</span></div>
        ${isINR ? `<div class="gst-note">${gstType}</div>` : ''}
      </div>
    </div>

    <div class="pay-info">
      <h4>Payment Details</h4>
      <div class="pr"><span>Payment Method</span><span>Bank Transfer</span></div>
      <div class="pr"><span>Bank</span><span>${bankName}</span></div>
      <div class="pr"><span>Account</span><span>${t.bank_account === 'india' ? 'India (INR)' : 'US (USD)'}</span></div>
      <div class="pr"><span>Transaction ID</span><span style="font-family:monospace">${t.txn_id}</span></div>
      <div class="pr"><span>Status</span><span><span class="badge">PAID</span></span></div>
      ${isINR ? `<div class="pr"><span>GST Type</span><span>${gstType}</span></div>` : ''}
    </div>
  </div>

  <div class="footer">
    <p>mschat.msdiscoveries.com</p>
    <p class="ty">Thank you for your business!</p>
    <p>halo@msdiscoveries.com</p>
  </div>
</div>
<script>if(window.location.search.includes('print=1'))window.print();</script>
</body>
</html>`;
};
