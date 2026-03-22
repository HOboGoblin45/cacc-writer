import Database from 'better-sqlite3';
const db = new Database('./data/cacc-writer.db');

// Add user_id to invoices (phase12 schema missed it)
try {
  db.exec("ALTER TABLE invoices ADD COLUMN user_id TEXT DEFAULT 'default'");
  console.log('Added user_id column');
} catch(e) {
  if (e.message.includes('duplicate')) console.log('user_id already exists');
  else console.log('Error:', e.message);
}

// Add status alias (invoiceGenerator uses 'status', phase12 uses 'invoice_status')
try {
  db.exec("ALTER TABLE invoices ADD COLUMN status TEXT DEFAULT 'unpaid'");
  console.log('Added status column');
} catch(e) {
  if (e.message.includes('duplicate')) console.log('status already exists');
  else console.log('status error:', e.message);
}

// Add amount alias (invoiceGenerator uses 'amount', phase12 uses subtotal)
try {
  db.exec("ALTER TABLE invoices ADD COLUMN amount REAL DEFAULT 0");
  console.log('Added amount column');
} catch(e) {
  if (e.message.includes('duplicate')) console.log('amount already exists');
  else console.log('amount error:', e.message);
}

// Add client_email
try {
  db.exec("ALTER TABLE invoices ADD COLUMN client_email TEXT");
  console.log('Added client_email column');
} catch(e) {
  if (e.message.includes('duplicate')) console.log('client_email already exists');
  else console.log('client_email error:', e.message);
}

// Create index
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, status)");
  console.log('Created user index');
} catch(e) { console.log('Index:', e.message); }

const cols = db.pragma('table_info(invoices)');
console.log('Columns:', cols.map(c => c.name).join(', '));
db.close();
console.log('Done!');
