# Contributing to n8n Workflow Sync

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. **Fork the repository**
2. **Clone your fork**
   ```bash
   git clone https://github.com/your-username/n8n-workflow-sync.git
   cd n8n-workflow-sync
   ```
3. **Install dependencies**
   ```bash
   npm install
   ```
4. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your n8n credentials
   ```

## 🔧 Development

### Running Locally

```bash
# Start the sync service
npm start

# Run in development mode (auto-restart)
npm run dev

# Run specific commands
npm run sync:pull
npm run sync:push
```

### Code Style

- Use ES6+ features
- Follow existing code patterns
- Use meaningful variable names
- Add comments for complex logic
- Keep functions small and focused

### File Structure

```
src/
├── config.js          # Configuration management
├── file-manager.js    # File operations
├── index.js           # Main entry point
├── n8n-client.js      # n8n API client
├── sync-engine.js     # Core sync logic
├── sync-state.js      # State management
└── watcher.js         # File watching
```

## 🐛 Reporting Bugs

When reporting bugs, please include:

1. **Description** - Clear description of the issue
2. **Steps to reproduce** - How to reproduce the bug
3. **Expected behavior** - What should happen
4. **Actual behavior** - What actually happens
5. **Environment** - Node version, OS, n8n version
6. **Logs** - Relevant error messages or logs

## ✨ Suggesting Features

Feature requests are welcome! Please:

1. Check if the feature already exists
2. Describe the use case
3. Explain why it would be useful
4. Provide examples if possible

## 📝 Pull Request Process

1. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Write clean, documented code
   - Follow existing patterns
   - Test your changes

3. **Commit your changes**
   ```bash
   git commit -m "feat: add your feature description"
   ```
   
   Use conventional commits:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `refactor:` - Code refactoring
   - `test:` - Adding tests
   - `chore:` - Maintenance tasks

4. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Create a Pull Request**
   - Provide a clear description
   - Reference any related issues
   - Explain what changed and why

## 🧪 Testing

Before submitting a PR:

1. Test the sync service with your n8n instance
2. Verify both push and pull operations work
3. Check that file watching detects changes
4. Ensure no duplicates are created
5. Test conflict resolution

## 📚 Documentation

When adding features:

- Update README.md if needed
- Add inline code comments
- Update .env.example for new config options
- Document breaking changes

## 🤝 Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Help others learn

## 💡 Areas for Contribution

Looking for ideas? Here are some areas that need work:

- **Testing** - Add unit and integration tests
- **Error handling** - Improve error messages and recovery
- **Performance** - Optimize sync operations
- **Features** - See GitHub issues for feature requests
- **Documentation** - Improve guides and examples
- **Bug fixes** - Check open issues

## 📞 Questions?

- Open an issue for questions
- Check existing issues and discussions
- Read the README.md thoroughly

Thank you for contributing! 🎉

