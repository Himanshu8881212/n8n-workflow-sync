# n8n Workflow Sync Service

> **Production-ready bidirectional sync service for n8n workflows**

Keep your n8n workflows in sync with your local Git repository. Perfect for version control, team collaboration, and workflow backup.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)

## ✨ Features

- 🔄 **Bidirectional Sync** - Keep local files and n8n perfectly in sync
- 👁️ **File Watching** - Auto-sync when local files change (1s debounce)
- ⏰ **Periodic Pull** - Automatically pull changes from n8n (configurable interval)
- 🎯 **Manual Sync** - Push, pull, or full sync on demand
- 🔀 **Conflict Resolution** - Configurable strategies (newest_wins, local_wins, remote_wins)
- 💾 **State Management** - Tracks sync state to prevent duplicates
- 🚀 **Production Ready** - Robust error handling, retry logic, and logging
- 📁 **Folder Structure** - Maintains your workflow folder organization
- 🔐 **Secure** - API key authentication with environment variables
- 🧹 **No Duplicates** - Smart name-based matching prevents duplicate workflows
- 📍 **No Scattered Files** - File path-based sync state keeps files in correct locations

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd Workflows/n8n-workflows/sync-service
npm install
```

### 2. Configure

Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and set:
```env
N8N_API_URL=http://localhost:5678/api/v1
N8N_API_KEY=your-api-key-here
WORKFLOWS_DIR=../../Generation Methods
```

### 3. Run Sync Service

**Automatic Mode (Recommended):**
```bash
./sync.sh
# or
npm start
```

This will:
- ✅ Perform initial sync (pull from n8n, then push local changes)
- ✅ Watch local files for changes and auto-sync to n8n
- ✅ Pull from n8n every 5 seconds
- ✅ Debounce file changes (1 second delay)

**Manual Mode:**
```bash
# Push local workflows to n8n
npm run sync:push

# Pull n8n workflows to local files
npm run sync:pull

# Full bidirectional sync (pull + push)
npm run sync:full
```

## 📖 Usage

### Automatic Sync (Watcher)

Start the watcher to automatically sync changes:

```bash
cd Workflows/n8n-workflows/sync-service
./sync.sh
```

**What it does:**
- Detects local file changes and syncs to n8n
- Pulls from n8n every 5 seconds
- No duplicates, no scattered files
- Production-ready!

**Stop the watcher:**
Press `Ctrl+C`

### Manual Sync

For manual control without the watcher:

```bash
# After editing locally:
npm run sync:push

# After editing in n8n:
npm run sync:pull

# Both directions:
npm run sync:full
```

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_API_URL` | `http://localhost:5678/api/v1` | n8n API endpoint |
| `N8N_API_KEY` | - | n8n API key (required) |
| `WORKFLOWS_DIR` | `../../Generation Methods` | Path to workflows directory |
| `SYNC_INTERVAL_MS` | `5000` | Periodic pull interval (ms) |
| `DEBOUNCE_MS` | `1000` | File change debounce delay (ms) |
| `CONFLICT_STRATEGY` | `newest_wins` | Conflict resolution strategy |

### Conflict Resolution

- **`newest_wins`** (default): Use most recently modified version
- **`local_wins`**: Always prefer local files
- **`remote_wins`**: Always prefer n8n version

## 📁 Workflow Structure

Workflows are organized in the `Generation Methods/` directory:

```
Generation Methods/
├── 00-shared-components/
│   ├── lifecycle/
│   │   ├── configure/configuration-manager.json
│   │   ├── generate/data-generator.json
│   │   ├── evaluate/evaluation-runner.json
│   │   └── export/data-exporter.json
│   └── ...
├── 01-text-generation-suite/
├── 02-image-data-suite/
├── 03-time-series-suite/
├── 04-tabular-data-suite/
└── 99-utilities/
```

**Total: 49 dummy workflows** in deepest-level folders.

## 🔄 How It Works

### Sync Architecture

```
Local Files (Git)          ←→         n8n Instance
Generation Methods/              http://localhost:5678

┌──────────────────┐              ┌──────────────────┐
│ File Watcher     │──────────→   │ n8n API          │
│ (chokidar)       │   Push       │ Update Workflow  │
└──────────────────┘              └──────────────────┘

┌──────────────────┐              ┌──────────────────┐
│ Periodic Pull    │   ←──────    │ n8n API          │
│ (every 5s)       │   Pull       │ List Workflows   │
└──────────────────┘              └──────────────────┘
```

### Key Features

- **File path-based sync state** - Remembers where each workflow came from
- **Name-based matching** - Matches local files to n8n workflows by name
- **No duplicates** - Smart matching prevents duplicate workflows
- **No scattered files** - Sync state maintains correct file locations
- **Hash-based change detection** - Only syncs when content actually changes

## 🐛 Troubleshooting

### Service won't start
- Check n8n is running: `curl http://localhost:5678/api/v1/workflows`
- Verify API key in `.env`
- Check `WORKFLOWS_DIR` path is correct

### Workflows not syncing
- Check file is valid JSON
- Verify workflow name is unique
- Check sync logs for errors
- Try manual sync: `npm run sync:push`

### Duplicates or scattered files
- Stop watcher
- Run cleanup: `node cleanup-n8n.js`
- Reset state: `rm -f .sync-state.json`
- Push clean: `npm run sync:push`

## 📊 Verification

Check everything is working:

```bash
# Local workflows
find "../../Generation Methods" -name "*.json" -type f | wc -l
# Should output: 49

# n8n workflows (no duplicates)
node -e "
const { N8nClient } = require('./src/n8n-client.js');
(async () => {
  const client = new N8nClient();
  const workflows = await client.listWorkflows();
  console.log(\`Total: \${workflows.length}\`);
  const names = workflows.map(w => w.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  console.log(duplicates.length > 0 ? \`Duplicates: \${duplicates.join(', ')}\` : 'No duplicates');
})();
"
# Should output: Total: 49, No duplicates
```

## 🔐 Security

- Store API key in `.env` (never commit)
- `.env` is in `.gitignore`
- Use proper file permissions
- API keys are never logged

## 🗺️ Roadmap

See [IMPROVEMENTS.md](./IMPROVEMENTS.md) for the full roadmap. Highlights:

**Phase 1 (Current):**
- ✅ Bidirectional sync
- ✅ File watching
- ✅ Conflict resolution
- ✅ Production-ready

**Phase 2 (Planned):**
- ⏳ Unit & integration tests
- ⏳ Dry-run mode
- ⏳ Backup & restore
- ⏳ Performance optimizations

**Phase 3 (Future):**
- 🔮 Webhook support
- 🔮 Multi-instance support
- 🔮 Web UI dashboard
- 🔮 Workflow validation

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

**Quick Start for Contributors:**
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📚 Documentation

- [README.md](./README.md) - This file
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [CHANGELOG.md](./CHANGELOG.md) - Version history
- [IMPROVEMENTS.md](./IMPROVEMENTS.md) - Roadmap and planned features
- [LICENSE](./LICENSE) - MIT License

## 🙏 Acknowledgments

Built with:
- [chokidar](https://github.com/paulmillr/chokidar) - File watching
- [chalk](https://github.com/chalk/chalk) - Terminal styling
- [ora](https://github.com/sindresorhus/ora) - Spinners
- [dotenv](https://github.com/motdotla/dotenv) - Environment variables

## 📝 License

MIT License - see [LICENSE](./LICENSE) for details.

---

**Made with ❤️ for the n8n community**

