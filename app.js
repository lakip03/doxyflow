const chokidar = require('chokidar');
const { execSync } = require('child_process');
const axios = require('axios');
const path = require('path');

// Configuration - UPDATE THESE VALUES
const WEBHOOK_URL = 'http://localhost:3000/autodocs/git';
const REPO_PATH = 'C:\\Users\\korisnik\\Nono-Lane-Battler';
const DEBOUNCE_MS = 2000;

let debounceTimer = null;

// Helper function to get Git diff
function getGitDiff() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: REPO_PATH })
      .toString().trim();
    
    // Get diff of staged changes (added with git add)
    const stagedDiff = execSync('git diff --cached', { cwd: REPO_PATH })
      .toString();
    
    // Get diff of unstaged changes (modified but not added)
    const unstagedDiff = execSync('git diff', { cwd: REPO_PATH })
      .toString();
    
    // Get list of staged files
    const stagedFiles = execSync('git diff --cached --name-only', { cwd: REPO_PATH })
      .toString().trim().split('\n').filter(f => f);
    
    // Get list of unstaged files
    const unstagedFiles = execSync('git diff --name-only', { cwd: REPO_PATH })
      .toString().trim().split('\n').filter(f => f);
    
    // Get untracked files
    const untrackedFiles = execSync('git ls-files --others --exclude-standard', { cwd: REPO_PATH })
      .toString().trim().split('\n').filter(f => f);
    
    // Get last commit info
    const lastCommit = execSync('git log -1 --pretty=format:"%h - %s - %an"', { cwd: REPO_PATH })
      .toString().trim();
    
    return {
      branch,
      stagedDiff,
      unstagedDiff,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
      lastCommit,
      hasStagedChanges: stagedDiff.length > 0,
      hasUnstagedChanges: unstagedDiff.length > 0
    };
  } catch (error) {
    console.error('Error getting Git diff:', error.message);
    return null;
  }
}

// Send webhook with diff
async function sendWebhook(filePath, eventType) {
  const gitInfo = getGitDiff();
  
  if (!gitInfo) return;
  
  // Only send if there are actual changes
  if (!gitInfo.hasStagedChanges && !gitInfo.hasUnstagedChanges && gitInfo.untrackedFiles.length === 0) {
    console.log('No changes to report');
    return;
  }
  
  const payload = {
    event: 'file_change',
    repository: path.basename(REPO_PATH),
    branch: gitInfo.branch,
    triggered_by: {
      file: path.relative(REPO_PATH, filePath),
      event_type: eventType
    },
    staged_changes: {
      files: gitInfo.stagedFiles,
      diff: gitInfo.stagedDiff,
      count: gitInfo.stagedFiles.length
    },
    unstaged_changes: {
      files: gitInfo.unstagedFiles,
      diff: gitInfo.unstagedDiff,
      count: gitInfo.unstagedFiles.length
    },
    untracked_files: gitInfo.untrackedFiles,
    last_commit: gitInfo.lastCommit,
    timestamp: new Date().toISOString()
  };
  
  try {
    const response = await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000
    });
    
    console.log('\n✓ Webhook sent successfully!');
    console.log(`  Staged files: ${gitInfo.stagedFiles.length}`);
    console.log(`  Unstaged files: ${gitInfo.unstagedFiles.length}`);
    console.log(`  Untracked files: ${gitInfo.untrackedFiles.length}`);
    console.log(`  Status: ${response.status}\n`);
  } catch (error) {
    console.error(`\n✗ Webhook failed: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error('  → Is your webhook server running on port 3000?\n');
    } else if (error.response) {
      console.error(`  → Server responded with: ${error.response.status}\n`);
    }
  }
}

// Initialize watcher
const watcher = chokidar.watch(REPO_PATH, {
  ignored: [
    /(^|[\/\\])\../,
    '**/node_modules/**',
    '**/.git/**',
    '**/__pycache__/**',
    '**/.venv/**',
    '**/dist/**',
    '**/build/**'
  ],
  persistent: true,
  ignoreInitial: true
});

// Event handlers with debouncing
watcher
  .on('change', (filePath) => {
    console.log(`📝 Modified: ${path.relative(REPO_PATH, filePath)}`);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      sendWebhook(filePath, 'modified');
    }, DEBOUNCE_MS);
  })
  .on('add', (filePath) => {
    console.log(`➕ Created: ${path.relative(REPO_PATH, filePath)}`);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      sendWebhook(filePath, 'created');
    }, DEBOUNCE_MS);
  })
  .on('unlink', (filePath) => {
    console.log(`🗑️  Deleted: ${path.relative(REPO_PATH, filePath)}`);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      sendWebhook(filePath, 'deleted');
    }, DEBOUNCE_MS);
  })
  .on('error', (error) => {
    console.error('Watcher error:', error);
  })
  .on('ready', () => {
    console.log('✓ Watcher ready and monitoring changes\n');
  });

console.log('╔════════════════════════════════════════╗');
console.log('║   Git Diff Watcher with Webhook       ║');
console.log('╠════════════════════════════════════════╣');
console.log(`║   📁 Repo: ${path.basename(REPO_PATH).padEnd(26)} ║`);
console.log(`║   🌐 Webhook: localhost:3000           ║`);
console.log('║   🎯 Tracking: Staged & Unstaged       ║');
console.log('╚════════════════════════════════════════╝\n');
console.log('Press Ctrl+C to stop\n');
