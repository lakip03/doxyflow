const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware to parse JSON with larger limit for diffs
app.use(express.json({ limit: '50mb' }));

// Log file path
const LOG_FILE = path.join(__dirname, 'webhook-logs.json');
const DIFF_DIR = path.join(__dirname, 'diffs');

// Initialize directories and files
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(DIFF_DIR)) {
  fs.mkdirSync(DIFF_DIR);
}

// Webhook endpoint
app.post('/autodocs/git', (req, res) => {
  const payload = req.body;
  const timestamp = new Date();
  
  console.log('\n🔔 Webhook received!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📦 Repository: ${payload.repository}`);
  console.log(`🌿 Branch: ${payload.branch}`);
  console.log(`⏰ Time: ${payload.timestamp}`);
  console.log(`📄 Triggered by: ${payload.triggered_by?.file} (${payload.triggered_by?.event_type})`);
  
  if (payload.last_commit) {
    console.log(`💾 Last Commit: ${payload.last_commit}`);
  }
  
  console.log('\n📊 Changes Summary:');
  console.log(`   ✅ Staged files: ${payload.staged_changes?.count || 0}`);
  if (payload.staged_changes?.files?.length > 0) {
    payload.staged_changes.files.forEach(f => console.log(`      • ${f}`));
  }
  
  console.log(`   ⚠️  Unstaged files: ${payload.unstaged_changes?.count || 0}`);
  if (payload.unstaged_changes?.files?.length > 0) {
    payload.unstaged_changes.files.forEach(f => console.log(`      • ${f}`));
  }
  
  console.log(`   ❓ Untracked files: ${payload.untracked_files?.length || 0}`);
  if (payload.untracked_files?.length > 0) {
    payload.untracked_files.forEach(f => console.log(`      • ${f}`));
  }
  
  // Save diffs to files
  const diffId = timestamp.getTime();
  
  if (payload.staged_changes?.diff) {
    const stagedDiffFile = path.join(DIFF_DIR, `staged_${diffId}.diff`);
    fs.writeFileSync(stagedDiffFile, payload.staged_changes.diff);
    console.log(`\n📝 Staged diff saved: ${stagedDiffFile}`);
  }
  
  if (payload.unstaged_changes?.diff) {
    const unstagedDiffFile = path.join(DIFF_DIR, `unstaged_${diffId}.diff`);
    fs.writeFileSync(unstagedDiffFile, payload.unstaged_changes.diff);
    console.log(`📝 Unstaged diff saved: ${unstagedDiffFile}`);
  }
  
  console.log('═══════════════════════════════════════════════════════════\n');
  
  // Save to log file (without full diff to keep it smaller)
  try {
    const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    logs.push({
      id: diffId,
      repository: payload.repository,
      branch: payload.branch,
      triggered_by: payload.triggered_by,
      staged_files: payload.staged_changes?.files || [],
      unstaged_files: payload.unstaged_changes?.files || [],
      untracked_files: payload.untracked_files || [],
      last_commit: payload.last_commit,
      has_staged_diff: !!payload.staged_changes?.diff,
      has_unstaged_diff: !!payload.unstaged_changes?.diff,
      timestamp: payload.timestamp,
      received_at: timestamp.toISOString()
    });
    
    // Keep only last 100 entries
    if (logs.length > 100) {
      logs.shift();
    }
    
    fs.writeFileSync(LOG_FILE, JSON.stringify(logs, null, 2));
  } catch (error) {
    console.error('Error saving log:', error.message);
  }
  
  // Send response
  res.status(200).json({
    success: true,
    message: 'Webhook received and diffs saved',
    diff_id: diffId,
    staged_files: payload.staged_changes?.count || 0,
    unstaged_files: payload.unstaged_changes?.count || 0,
    timestamp: timestamp.toISOString()
  });
});

// Get recent logs endpoint
app.get('/autodocs/git/logs', (req, res) => {
  try {
    const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    const limit = parseInt(req.query.limit) || 10;
    res.json({
      total: logs.length,
      logs: logs.slice(-limit).reverse()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

// Get specific diff file
app.get('/autodocs/git/diff/:type/:id', (req, res) => {
  const { type, id } = req.params;
  const diffFile = path.join(DIFF_DIR, `${type}_${id}.diff`);
  
  if (fs.existsSync(diffFile)) {
    const diff = fs.readFileSync(diffFile, 'utf8');
    res.type('text/plain').send(diff);
  } else {
    res.status(404).json({ error: 'Diff file not found' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Webhook server is running' });
});

// Dashboard
app.get('/', (req, res) => {
  const logs = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  
  let html = `
<!DOCTYPE html>
<html>
<head>
  <title>Git Diff Webhook Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f5f5;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { color: #333; margin-bottom: 20px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-number { font-size: 32px; font-weight: bold; color: #0066cc; }
    .stat-label { color: #666; margin-top: 5px; }
    .log-entry {
      background: white;
      padding: 20px;
      margin: 15px 0;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .log-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      padding-bottom: 15px;
      border-bottom: 1px solid #eee;
    }
    .repo-info { font-weight: bold; color: #333; }
    .timestamp { color: #999; font-size: 0.9em; }
    .files-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 15px;
      margin-top: 10px;
    }
    .file-section {
      background: #f9f9f9;
      padding: 15px;
      border-radius: 5px;
    }
    .section-title {
      font-weight: bold;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .file-list { list-style: none; }
    .file-list li {
      padding: 5px 0;
      color: #555;
      font-family: 'Courier New', monospace;
      font-size: 0.9em;
    }
    .diff-link {
      display: inline-block;
      margin-top: 10px;
      padding: 8px 15px;
      background: #0066cc;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-size: 0.9em;
    }
    .diff-link:hover { background: #0052a3; }
    .no-files { color: #999; font-style: italic; }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: bold;
    }
    .badge-staged { background: #28a745; color: white; }
    .badge-unstaged { background: #ffc107; color: #333; }
    .badge-untracked { background: #6c757d; color: white; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔔 Git Diff Webhook Dashboard</h1>
    
    <div class="stats">
      <div class="stat-card">
        <div class="stat-number">${logs.length}</div>
        <div class="stat-label">Total Webhooks</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${logs.filter(l => l.has_staged_diff).length}</div>
        <div class="stat-label">With Staged Changes</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${logs.filter(l => l.has_unstaged_diff).length}</div>
        <div class="stat-label">With Unstaged Changes</div>
      </div>
    </div>
    
    <h2>Recent Changes</h2>
  `;
  
  logs.slice(-20).reverse().forEach(log => {
    html += `
    <div class="log-entry">
      <div class="log-header">
        <div class="repo-info">
          📦 ${log.repository} • 🌿 ${log.branch}
        </div>
        <div class="timestamp">${new Date(log.timestamp).toLocaleString()}</div>
      </div>
      
      <div class="files-grid">
        ${log.staged_files.length > 0 ? `
        <div class="file-section">
          <div class="section-title">
            <span class="badge badge-staged">${log.staged_files.length}</span>
            ✅ Staged Files
          </div>
          <ul class="file-list">
            ${log.staged_files.map(f => `<li>• ${f}</li>`).join('')}
          </ul>
          ${log.has_staged_diff ? `<a href="/autodocs/git/diff/staged/${log.id}" class="diff-link" target="_blank">View Diff</a>` : ''}
        </div>
        ` : ''}
        
        ${log.unstaged_files.length > 0 ? `
        <div class="file-section">
          <div class="section-title">
            <span class="badge badge-unstaged">${log.unstaged_files.length}</span>
            ⚠️ Unstaged Files
          </div>
          <ul class="file-list">
            ${log.unstaged_files.map(f => `<li>• ${f}</li>`).join('')}
          </ul>
          ${log.has_unstaged_diff ? `<a href="/autodocs/git/diff/unstaged/${log.id}" class="diff-link" target="_blank">View Diff</a>` : ''}
        </div>
        ` : ''}
        
        ${log.untracked_files.length > 0 ? `
        <div class="file-section">
          <div class="section-title">
            <span class="badge badge-untracked">${log.untracked_files.length}</span>
            ❓ Untracked Files
          </div>
          <ul class="file-list">
            ${log.untracked_files.map(f => `<li>• ${f}</li>`).join('')}
          </ul>
        </div>
        ` : ''}
      </div>
      
      ${log.last_commit ? `<div style="margin-top:15px; padding-top:15px; border-top:1px solid #eee; color:#666; font-size:0.9em;">💾 ${log.last_commit}</div>` : ''}
    </div>
    `;
  });
  
  html += `
  </div>
</body>
</html>
  `;
  
  res.send(html);
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🚀 Git Diff Webhook Server          ║
╠════════════════════════════════════════╣
║   📍 URL: http://localhost:${PORT}     ║
║   🎯 Endpoint: /autodocs/git          ║
║   📊 Dashboard: http://localhost:${PORT}║
║   📁 Diffs saved to: ./diffs/         ║
╚════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down webhook server...');
  process.exit(0);
});