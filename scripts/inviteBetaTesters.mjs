#!/usr/bin/env node

import Database from 'better-sqlite3';
import crypto from 'crypto';
import process from 'process';

// Parse command-line arguments
const args = process.argv.slice(2);
let limit = 50;
let tier = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') {
    limit = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--tier') {
    tier = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  }
}

// Validate arguments
if (isNaN(limit) || limit < 1) {
  console.error('Error: --limit must be a positive integer');
  process.exit(1);
}

if (tier && !['starter', 'pro', 'enterprise'].includes(tier.toLowerCase())) {
  console.error('Error: --tier must be one of: starter, pro, enterprise');
  process.exit(1);
}

// Connect to database
let db;
try {
  db = new Database('./data/cacc.db');
  // Ensure we can read from the database
  db.exec('SELECT 1');
} catch (error) {
  console.error('Error: Could not open database at ./data/cacc.db');
  console.error(error.message);
  process.exit(1);
}

/**
 * Generate a beta code in format: RB-BETA-{random8}
 * Example: RB-BETA-X7K9M2P4
 */
function generateBetaCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RB-BETA-${code}`;
}

/**
 * Main function to invite beta testers
 */
async function inviteBetaTesters() {
  console.log('Real Brain Beta Tester Invitation Tool');
  console.log('=====================================\n');

  // Build query
  let query = 'SELECT id, email, name, tier, status FROM waitlist WHERE status IN ("pending", "approved")';
  const params = [];

  if (tier) {
    query += ' AND tier = ?';
    params.push(tier.toLowerCase());
  }

  query += ' LIMIT ?';
  params.push(limit);

  try {
    // Get pending users
    const stmt = db.prepare(query);
    const users = stmt.all(...params);

    if (users.length === 0) {
      console.log('No pending or approved waitlist users found matching criteria.');
      db.close();
      process.exit(0);
    }

    console.log(`Found ${users.length} users to invite`);
    if (tier) {
      console.log(`Filter: tier = ${tier}`);
    }
    console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (database will be updated)'}`);
    console.log('=====================================\n');

    const invited = [];

    // Process each user
    for (const user of users) {
      const betaCode = generateBetaCode();

      console.log(`${invited.length + 1}. ${user.email}`);
      console.log(`   Name: ${user.name || '(no name)'}`);
      console.log(`   Tier: ${user.tier || 'unspecified'}`);
      console.log(`   Current status: ${user.status}`);
      console.log(`   Beta code: ${betaCode}`);

      if (!dryRun) {
        try {
          const updateStmt = db.prepare(
            'UPDATE waitlist SET status = "invited", beta_code = ?, invited_at = datetime("now") WHERE id = ?'
          );
          updateStmt.run(betaCode, user.id);
          console.log(`   ✓ Updated to "invited"`);
        } catch (error) {
          console.log(`   ✗ Update failed: ${error.message}`);
        }
      } else {
        console.log('   (dry run - not updating)');
      }

      invited.push({
        id: user.id,
        email: user.email,
        name: user.name,
        betaCode,
      });

      console.log('');
    }

    // Summary
    console.log('=====================================');
    console.log(`Summary: ${invited.length} user(s) processed`);
    if (dryRun) {
      console.log('Status: DRY RUN - no database changes made');
    } else {
      console.log(`Status: ${invited.length} user(s) marked as invited`);
      console.log('Next steps: Send invitation emails with beta codes');
    }
    console.log('=====================================');

    db.close();
  } catch (error) {
    console.error('Fatal error:', error.message);
    db.close();
    process.exit(1);
  }
}

inviteBetaTesters();
