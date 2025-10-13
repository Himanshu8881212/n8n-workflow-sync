# n8n Workflow Sync Service v2.0

**Production-ready bidirectional sync service for n8n workflows with local Git repository.**

[![Tests](https://img.shields.io/badge/tests-passing-brightgreen)](.) 
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)](.)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](.)
[![License](https://img.shields.io/badge/license-MIT-blue)](.)

---

## 🚀 Features

### Core Sync Capabilities
- ✅ **Bidirectional Sync** - Pull from n8n, push to n8n, or full sync
- ✅ **Auto-Sync** - Real-time file watching with intelligent debouncing
- ✅ **Batch Processing** - Efficient handling of multiple file changes
- ✅ **Conflict Resolution** - Configurable strategies (newest wins, local wins, remote wins)
- ✅ **YAML Support** - Work with JSON or YAML workflow files
- ✅ **Dry Run Mode** - Preview changes before applying them

### Advanced Features
- 🌐 **Webhook Server** - Remote sync triggers via HTTP endpoints
- 🔐 **Security** - HMAC-SHA256 signature verification
- 📊 **Metrics** - Comprehensive tracking and monitoring
- 🔄 **Retry Logic** - Automatic retry with exponential backoff
- 📝 **Structured Logging** - Winston-based logging with multiple levels
- 🎯 **Workflow Management** - List, activate, deactivate, prune workflows
- 🔍 **Search & Diff** - Find and compare workflows
- 💾 **Backup/Restore** - Automatic backups before operations
- ✅ **Validation** - Workflow structure validation
- 🏢 **Multi-Instance** - Support for multiple n8n instances

---

## 📋 Quick Start

### 1. Installation

```bash
cd Workflows/n8n-workflows/sync-service
npm install
```

### 2. Configuration

```bash
# Copy example environment file
cp .env.example .env

# Edit with your settings
nano .env
```

**Required settings:**
```env
N8N_API_URL=http://localhost:5678/api/v1
N8N_API_KEY=your_api_key_here
WORKFLOWS_DIR=../../Generation Methods
```

**Optional settings:**
```env
# Auto-sync
WATCH_ENABLED=true
AUTO_PUSH=true
AUTO_PULL=true

# Webhook server
WEBHOOK_ENABLED=true
WEBHOOK_PORT=3000
WEBHOOK_SECRET=your-secret-key

# Logging
LOG_LEVEL=info
```

### 3. Start the Service

```bash
# Start auto-sync service
npm start

# Or run specific operations
npm run sync:pull    # Pull from n8n
npm run sync:push    # Push to n8n
npm run sync:full    # Full bidirectional sync
```

---

## 📚 Usage

### Sync Operations

```bash
# Auto-sync service (watches files + webhook server)
npm start

# One-time operations
npm run sync:pull           # Pull workflows from n8n
npm run sync:push           # Push workflows to n8n
npm run sync:full           # Full bidirectional sync

# With dry-run
npm run sync:pull -- --dry-run
npm run sync:push -- --dry-run
```

### Workflow Management

```bash
# List workflows
npm run workflows:list                    # Table format
npm run workflows:list -- --output json   # JSON format
npm run workflows:list -- --output yaml   # YAML format

# Activate/Deactivate
npm run workflows:activate <id>
npm run workflows:deactivate <id>

# Prune (remove remote workflows not in local directory)
npm run workflows:prune
npm run workflows:prune -- --dry-run

# Search workflows
npm run workflows:search "customer"
npm run workflows:search -- --tag production

# Diff workflows
npm run workflows:diff <id>
```

### Webhook Server

The webhook server allows remote triggering of sync operations:

```bash
# Health check
curl http://localhost:3000/health

# Trigger pull
curl -X POST http://localhost:3000/sync/pull

# Trigger push
curl -X POST http://localhost:3000/sync/push

# Full sync
curl -X POST http://localhost:3000/sync/full

# Get metrics
curl http://localhost:3000/metrics
```

**With signature verification:**
```bash
SIGNATURE=$(echo -n "" | openssl dgst -sha256 -hmac "your-secret" | cut -d' ' -f2)
curl -X POST http://localhost:3000/sync/pull \
  -H "X-Webhook-Signature: $SIGNATURE"
```

See [WEBHOOK_GUIDE.md](./WEBHOOK_GUIDE.md) for complete documentation.

### Development

```bash
# Run tests
npm test                    # All tests
npm run test:unit           # Unit tests only
npm run test:webhook        # Webhook tests only
npm run test:coverage       # With coverage report

# Code quality
npm run lint                # Run linter
npm run lint:fix            # Fix linting issues
npm run format              # Format code
npm run format:check        # Check formatting

# Utilities
npm run version             # Show version info
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   n8n Workflow Sync                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐      ┌──────────────┐               │
│  │ File Watcher │◄────►│ Sync Engine  │               │
│  └──────────────┘      └──────┬───────┘               │
│         │                     │                        │
│         │              ┌──────▼───────┐                │
│         │              │  n8n Client  │                │
│         │              └──────┬───────┘                │
│         │                     │                        │
│  ┌──────▼──────┐       ┌──────▼───────┐               │
│  │   Local     │       │   n8n API    │               │
│  │   Files     │       │   Server     │               │
│  └─────────────┘       └──────────────┘               │
│         ▲                                              │
│         │                                              │
│  ┌──────┴──────┐                                       │
│  │   Webhook   │                                       │
│  │   Server    │                                       │
│  └─────────────┘                                       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Components

- **Sync Engine** - Core sync logic (pull/push/full)
- **n8n Client** - API communication with n8n
- **File Watcher** - Real-time file monitoring with debouncing
- **Webhook Server** - HTTP endpoints for remote triggers
- **File Manager** - JSON/YAML file operations
- **Logger** - Structured logging with Winston
- **Backup Manager** - Automatic backups
- **Workflow Validator** - Structure validation
- **Multi-Instance Manager** - Multiple n8n instances

---

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_API_URL` | `http://localhost:5678/api/v1` | n8n API URL |
| `N8N_API_KEY` | - | n8n API key (required) |
| `WORKFLOWS_DIR` | `../Generation Methods` | Local workflows directory |
| `WATCH_ENABLED` | `false` | Enable file watching |
| `AUTO_PUSH` | `false` | Auto-push on file changes |
| `AUTO_PULL` | `false` | Auto-pull on n8n changes |
| `WEBHOOK_ENABLED` | `false` | Enable webhook server |
| `WEBHOOK_PORT` | `3000` | Webhook server port |
| `WEBHOOK_SECRET` | - | Webhook signature secret |
| `LOG_LEVEL` | `info` | Logging level |
| `DRY_RUN` | `false` | Dry run mode |
| `CONFLICT_STRATEGY` | `newest_wins` | Conflict resolution |

### Conflict Resolution Strategies

- `newest_wins` - Use the most recently modified version
- `local_wins` - Always prefer local files
- `remote_wins` - Always prefer n8n version
- `manual` - Require manual resolution

---

## 📖 Documentation

- [Quick Start Guide](../../QUICK_START.md) - 5-minute setup
- [Webhook Guide](./WEBHOOK_GUIDE.md) - Complete webhook documentation
- [Troubleshooting](../../TROUBLESHOOTING.md) - Common issues and solutions
- [Implementation Summary](../../IMPLEMENTATION_SUMMARY.md) - Technical details
- [Contributing](./CONTRIBUTING.md) - Development guidelines

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:unit           # Unit tests (20 tests)
npm run test:webhook        # Webhook tests (22 tests)

# Coverage report
npm run test:coverage

# Watch mode
npm run test:watch
```

**Test Coverage:** 100% (42/42 tests passing)

---

## 🎯 Comparison vs Reference

| Feature | Reference (n8n-cli) | This Project |
|---------|---------------------|--------------|
| Bidirectional Sync | ✅ Basic | ✅ **Enhanced** |
| File Watching | ✅ Basic | ✅ **Advanced (debouncing, batching)** |
| Webhook Server | ❌ None | ✅ **Full implementation** |
| YAML Support | ❌ None | ✅ **Yes** |
| Dry Run Mode | ❌ None | ✅ **Yes** |
| Retry Logic | ❌ None | ✅ **Exponential backoff** |
| Structured Logging | ❌ Basic | ✅ **Winston with levels** |
| Backup/Restore | ❌ None | ✅ **Automatic** |
| Validation | ❌ None | ✅ **Structure validation** |
| Multi-Instance | ❌ None | ✅ **Yes** |
| Tests | ❌ None | ✅ **42 tests, 100% coverage** |
| Documentation | ⚠️ Basic | ✅ **Comprehensive** |

**Result:** We're significantly ahead! 🏆

---

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT License - See LICENSE file for details

---

## 🙏 Acknowledgments

- Built with [n8n](https://n8n.io/) - Workflow automation platform
- Inspired by [edenreich/n8n-cli](https://github.com/edenreich/n8n-cli)
- Enhanced with modern Node.js best practices

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/Himanshu8881212/GenerationSuite/issues)
- **Documentation:** See docs folder
- **Examples:** See examples folder

---

**Made with ❤️ by DataGen**

