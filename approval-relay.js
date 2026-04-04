const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PORT = 8787;
const approvalsPath = path.join(__dirname, 'approvals.json');
const gogPath = path.join(__dirname, '.tools', 'gog.exe');
const twilioPath = path.join(__dirname, '.secrets', 'twilio.json');

function loadApprovals() {
  return JSON.parse(fs.readFileSync(approvalsPath, 'utf8'));
}

function saveApprovals(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(approvalsPath, JSON.stringify(data, null, 2));
}

function sendJson(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function publishApprovalsToGitHub() {
  // placeholder hook; repo publishing stays external/tool-driven for now
  return true;
}

function sendTwilioText(to, body) {
  const twilio = JSON.parse(fs.readFileSync(twilioPath, 'utf8'));
  const postData = new URLSearchParams({
    To: to,
    From: twilio.from_number,
    Body: body
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${twilio.account_sid}/Messages.json`,
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${twilio.account_sid}:${twilio.auth_token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data || 'twilio text sent');
        } else {
          reject(new Error(`Twilio ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function executeApprovedItem(item) {
  if (item.kind === 'Email Approval' && item.to && item.subject && item.body) {
    execFileSync(gogPath, ['gmail', 'send', '-a', 'brianjameson@sunquell.ca', '--to', item.to, '--subject', item.subject, '--body', item.body], { stdio: 'pipe' });
    return 'email sent';
  }
  if (item.kind === 'Twilio Text' && item.to && item.body) {
    await sendTwilioText(item.to, item.body);
    return 'twilio text sent';
  }
  return 'no-op';
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  if (req.url === '/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, port: PORT });
  }

  if (req.url === '/approvals' && req.method === 'GET') {
    return sendJson(res, 200, loadApprovals());
  }

  if (req.url === '/approvals/action' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const data = loadApprovals();
        const item = data.items.find(x => x.id === payload.id);
        if (!item) return sendJson(res, 404, { ok: false, error: 'Item not found' });

        if (payload.comment !== undefined) item.comment = payload.comment || '';
        if (payload.status) item.status = payload.status;

        if (payload.status === 'Approved' && payload.execute === true) {
          const result = await executeApprovedItem(item);
          item.status = 'Sent';
          item.sentAt = new Date().toISOString();
          item.comment = item.comment || result;
        }

        saveApprovals(data);
        publishApprovalsToGitHub();
        return sendJson(res, 200, { ok: true, item });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: err.message });
      }
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`approval relay listening on http://127.0.0.1:${PORT}`);
});
