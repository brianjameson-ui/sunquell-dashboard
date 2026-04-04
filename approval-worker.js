const fs = require('fs');
const path = require('path');

const approvalsPath = path.join(__dirname, 'approvals.json');

function loadApprovals() {
  return JSON.parse(fs.readFileSync(approvalsPath, 'utf8'));
}

function saveApprovals(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(approvalsPath, JSON.stringify(data, null, 2));
}

function setStatus(id, status, comment = '') {
  const data = loadApprovals();
  const item = data.items.find(x => x.id === id);
  if (!item) throw new Error(`Approval item not found: ${id}`);
  item.status = status;
  if (comment) item.comment = comment;
  saveApprovals(data);
  return item;
}

function markSent(id, note = '') {
  const data = loadApprovals();
  const item = data.items.find(x => x.id === id);
  if (!item) throw new Error(`Approval item not found: ${id}`);
  item.status = 'Sent';
  item.sentAt = new Date().toISOString();
  if (note) item.comment = note;
  saveApprovals(data);
  return item;
}

function getApprovedToSend() {
  const data = loadApprovals();
  return data.items.filter(item =>
    item.status === 'Approved' &&
    !item.sentAt &&
    (item.kind === 'Email Approval' || item.kind === 'Twilio Text')
  );
}

if (require.main === module) {
  const [cmd, id, status, ...rest] = process.argv.slice(2);
  const comment = rest.join(' ');
  if (cmd === 'set-status') {
    console.log(JSON.stringify(setStatus(id, status, comment), null, 2));
  } else if (cmd === 'mark-sent') {
    console.log(JSON.stringify(markSent(id, comment), null, 2));
  } else if (cmd === 'get-approved-to-send') {
    console.log(JSON.stringify(getApprovedToSend(), null, 2));
  } else {
    console.error('Usage: node approval-worker.js set-status <id> <status> [comment]');
    console.error('   or: node approval-worker.js mark-sent <id> [comment]');
    console.error('   or: node approval-worker.js get-approved-to-send');
    process.exit(1);
  }
}
