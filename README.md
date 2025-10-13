# n8n Workflow Sync v2.0

🚀 **Production-ready bidirectional sync service for n8n workflows with elegant GUI and powerful CLI**

Automatically sync your n8n workflows with a local Git repository, featuring a beautiful material design dashboard and comprehensive command-line tools.

![Version](https://img.shields.io/badge/version-2.0.0-blue?style=for-the-badge)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

---

## 🎯 Two Ways to Work

### 🖥️ **GUI Dashboard** - Visual & Intuitive
Beautiful web interface for everyday workflow management. Perfect for quick operations and visual monitoring.

**Access:** `npm run gui` → http://localhost:3001

**What You Can Do:**
- ✅ Pull workflows from n8n
- ✅ Push workflows to n8n
- ✅ Full bidirectional sync
- ✅ List all workflows with real-time updates
- ✅ Search workflows by name or ID
- ✅ Filter by status (All/Active/Inactive)
- ✅ Activate/Deactivate workflows
- ✅ Delete workflows
- ✅ Smart workflow detection (Manual vs Trigger-based)
- ✅ Real-time status monitoring (Pulling/Pushing/Syncing/Idle)
- ✅ WebSocket live updates

**Features:**
- Material design with monochromatic gradients
- Responsive and smooth animations
- Scrollable workflow list
- Toast notifications
- One-click operations

### ⌨️ **CLI Commands** - Powerful & Flexible
Complete command-line interface with 29 commands. Perfect for automation, scripting, and advanced operations.

**What You Can Do:**
- ✅ Everything in GUI, plus:
- ✅ Compare workflows (diff local vs remote)
- ✅ Prune deleted workflows
- ✅ Advanced search with filters
- ✅ Shell completion (bash/zsh/fish)
- ✅ Run tests and validation
- ✅ Code quality checks
- ✅ CI/CD integration
- ✅ Automation scripts

---

## ✨ Core Features

### 🔄 **Sync Capabilities**
- **Bidirectional Sync** - Pull from n8n, push to n8n, or full sync
- **Auto-Sync** - Real-time file watching with intelligent debouncing
- **Batch Processing** - Efficient handling of multiple file changes
- **Conflict Resolution** - Configurable strategies (newest wins, local wins, remote wins)
- **Dry Run Mode** - Preview changes before applying
- **Retry Logic** - Automatic retry with exponential backoff

### 🎨 **GUI Dashboard**
- **Material Design** - Elegant black & white theme with gradients
- **Real-time Updates** - WebSocket-powered live status and workflow list
- **Smart Detection** - Automatically identifies Manual vs Trigger-based workflows
- **Search & Filter** - Find workflows instantly by name, ID, or status
- **One-Click Actions** - Activate, deactivate, delete with single click
- **Status Monitoring** - Live status: Pulling, Pushing, Syncing, Idle, Error

### 🛠️ **Advanced Features**
- **File Watcher** - Auto-sync on file changes with debouncing
- **Webhook Server** - Remote sync triggers via HTTP endpoints
- **Backup Manager** - Automatic backups before operations with rotation
- **Workflow Validator** - Schema, node, and connection validation
- **Multi-Instance Manager** - Prevents concurrent syncs with lock files
- **Enhanced Logger** - Winston-based logging with multiple levels
- **Folder Hierarchy** - Tag-based organization (tag → folder structure)
- **YAML Support** - Work with JSON or YAML workflow files

### 🔒 **Security & Reliability**
- **API Key Authentication** - Secure n8n API access
- **HMAC-SHA256** - Webhook signature verification
- **Error Handling** - Comprehensive error handling and recovery
- **Validation** - Pre-sync workflow validation
- **Backup/Restore** - Automatic backups with checksums

---

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/Himanshu8881212/n8n-workflow-sync.git
cd n8n-workflow-sync

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your n8n URL and API key
```

---

## ⚙️ Configuration

Create a `.env` file:

```env
# n8n API Configuration (Required)
N8N_API_URL=http://localhost:5678/api/v1
N8N_API_KEY=your-api-key-here

# Workflow Storage (Required)
WORKFLOWS_DIR=./workflows

# GUI Server (Optional)
GUI_PORT=3001

# Auto-Sync (Optional)
WATCH_ENABLED=true
AUTO_PUSH=true
AUTO_PULL=true
DEBOUNCE_MS=1000

# Webhook Server (Optional)
WEBHOOK_ENABLED=true
WEBHOOK_PORT=3000
WEBHOOK_SECRET=your-secret-key

# Logging (Optional)
LOG_LEVEL=info
```

**Getting your n8n API Key:**
1. Open n8n → Settings → API
2. Click "Create API Key"
3. Copy and paste in `.env`

---

## 🚀 Quick Start

### Start GUI Dashboard
```bash
npm run gui
# Open http://localhost:3001
```

### Start Full Service (Auto-Sync + Webhooks)
```bash
npm start
```

### Run One-Time Sync
```bash
npm run sync:pull    # Pull from n8n
npm run sync:push    # Push to n8n
npm run sync:full    # Full bidirectional sync
```

---

## 📚 Complete CLI Command Reference

### 🚀 **Main Services** (4 commands)
```bash
npm start              # Start full service (file watcher + webhook server)
npm run gui            # Start GUI dashboard (http://localhost:3001)
npm run prod           # Start GUI in production mode
npm run dev            # Start with nodemon (auto-restart on changes)
```

### 🔄 **Sync Operations** (3 commands)
```bash
npm run sync:pull      # Pull workflows from n8n to local
npm run sync:push      # Push workflows from local to n8n
npm run sync:full      # Full bidirectional sync (pull + push)
```

### 📊 **Workflow Management** (6 commands)
```bash
npm run workflows:list                    # List all workflows
npm run workflows:search "keyword"        # Search workflows by keyword
npm run workflows:activate <workflow-id>  # Activate a workflow
npm run workflows:deactivate <id>         # Deactivate a workflow
npm run workflows:diff                    # Compare local vs remote workflows
npm run workflows:prune                   # Remove workflows not in local directory
npm run workflows:prune --dry-run         # Preview what will be deleted
npm run workflows:prune --yes             # Skip confirmation
```

### 🐚 **Shell Completion** (4 commands)
```bash
npm run completion           # Show completion help
npm run completion:bash      # Generate bash completion script
npm run completion:zsh       # Generate zsh completion script
npm run completion:fish      # Generate fish completion script
```

**Install completion:**
```bash
# Bash
npm run completion:bash > /etc/bash_completion.d/n8n-workflow-sync

# Zsh
npm run completion:zsh > ~/.zsh/completion/_n8n-workflow-sync

# Fish
npm run completion:fish > ~/.config/fish/completions/n8n-workflow-sync.fish
```

### 🧪 **Testing** (6 commands)
```bash
npm test                     # Run all tests
npm run test:unit            # Run unit tests only
npm run test:integration     # Run integration tests only
npm run test:webhook         # Run webhook tests
npm run test:watch           # Run tests in watch mode
npm run test:coverage        # Run tests with coverage report
```

### ✨ **Code Quality** (5 commands)
```bash
npm run lint                 # Run ESLint on src/ and tests/
npm run lint:fix             # Auto-fix ESLint issues
npm run format               # Format code with Prettier
npm run format:check         # Check code formatting
npm run validate             # Run lint + test
```

### ℹ️ **Info** (1 command)
```bash
npm run version              # Show version and system info
```

---

## 🎨 GUI Dashboard Features

### **Main Interface**
- **Left Sidebar**
  - Logo: "WORKFLOW SYNC" (centered, bold)
  - Stats Cards: Total Workflows, Last Sync, Status
  - Quick Actions: Pull, Push, Full Sync, Refresh buttons

- **Right Main Area**
  - Title: "Workflows"
  - Search Bar: Real-time search by name or ID
  - Filter Buttons: All, Active, Inactive
  - Workflow List: Scrollable with smooth animations

### **Workflow Cards**
Each workflow shows:
- Workflow name
- Status badge (Active/Inactive/Manual)
- Workflow ID
- Node count
- Action buttons (Activate/Deactivate, Delete)

### **Smart Features**
- **Manual Workflows**: Shows "Manual" badge, no activate button
- **Trigger Workflows**: Shows Active/Inactive badge with activate button
- **Real-time Status**: Updates live (Pulling → Idle, Pushing → Idle)
- **Toast Notifications**: Success/error messages
- **WebSocket Updates**: Live workflow list and stats

### **Design**
- Material design with monochromatic gradients
- Black background (#000, #111)
- White text and buttons
- Smooth hover effects
- Professional scrollbar
- Responsive layout

---

## 🔧 Advanced Usage

### **Compare Workflows**
```bash
npm run workflows:diff
```
Shows:
- Changed workflows
- Unchanged workflows
- Local-only workflows
- Remote-only workflows

### **Clean Up Deleted Workflows**
```bash
# Preview what will be deleted
npm run workflows:prune --dry-run

# Actually delete
npm run workflows:prune --yes
```

### **Search Workflows**
```bash
npm run workflows:search "generator"
npm run workflows:search "active"
```

### **Automation Example**
```bash
#!/bin/bash
# Auto-sync script
npm run sync:pull
npm run workflows:diff
npm run sync:push
```

---

## 📁 Project Structure

```
n8n-workflow-sync/
├── src/
│   ├── gui-server.js          # Web dashboard server
│   ├── n8n-client.js          # n8n API client
│   ├── sync-engine.js         # Sync logic
│   ├── file-manager.js        # File operations
│   ├── backup-manager.js      # Backup functionality
│   ├── workflow-validator.js  # Workflow validation
│   ├── watcher-enhanced.js    # File watcher
│   ├── webhook-server.js      # Webhook support
│   ├── logger-enhanced.js     # Logging system
│   ├── multi-instance-manager.js  # Lock management
│   └── commands/              # CLI commands
├── public/
│   ├── index.html             # GUI dashboard
│   └── app.js                 # Frontend logic
├── workflows/                 # Your synced workflows
├── .env                       # Configuration
└── package.json               # Dependencies
```

---

## 🐛 Troubleshooting

### GUI not loading?
- Check if port 3001 is available
- Verify n8n is running
- Check `.env` configuration

### Workflows not syncing?
- Verify `N8N_API_KEY` is correct
- Check n8n API URL
- Review logs for errors

### Status always showing "Idle"?
- Refresh the page
- Check WebSocket connection
- Check browser console

---

## 📝 License

MIT License

---

**Made with ❤️ by DataGen**

**Total Features**: 35+ | **CLI Commands**: 29 | **GUI Features**: 11 | **Backend Services**: 7
