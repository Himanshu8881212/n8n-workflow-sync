# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2025-10-13

### 🎉 Major Release - Production Ready

### Added
- **File path-based sync state** - Sync state now keyed by file paths instead of workflow IDs
- **Name-based workflow matching** - Prevents duplicate workflows by matching on name
- **Robust error handling** - Better error messages and recovery
- **Conflict resolution** - Configurable strategies (newest_wins, local_wins, remote_wins)
- **Batch operations** - Process multiple workflows efficiently
- **Retry logic** - Automatic retries for failed operations
- **Comprehensive logging** - Better visibility into sync operations
- **Configuration validation** - Validates config on startup

### Changed
- **Sync state structure** - Version 2.0.0 format with file path keys
- **Push logic** - Uses name-based matching with fallback to sync state
- **Pull logic** - Uses sync state to determine correct file paths
- **Watcher** - Fixed to use name-based matching, no more 404 errors

### Fixed
- **Duplicate workflow creation** - No longer creates duplicates on initial sync
- **404 errors on file changes** - Watcher now properly matches workflows
- **Scattered files** - Files stay in correct folders after pull
- **Sync state persistence** - State survives restarts and maintains file locations
- **n8n API compatibility** - Properly handles read-only fields (active, tags)

### Removed
- **Workflow ID from JSON files** - No longer relies on `id` field in workflow files

## [1.0.0] - 2025-10-12

### Added
- Initial release
- Bidirectional sync between local files and n8n
- File watching with chokidar
- Periodic pull from n8n
- Manual sync commands (push, pull, full)
- Basic sync state management
- n8n API client
- Configuration via environment variables

### Known Issues
- Creates duplicate workflows on initial sync
- 404 errors when syncing file changes
- Files scattered in wrong locations after pull

---

## Upgrade Guide

### From 1.x to 2.x

**Breaking Changes:**
- Sync state format changed from workflow ID keys to file path keys
- Old `.sync-state.json` files are incompatible

**Migration Steps:**
1. Backup your current `.sync-state.json`
2. Delete `.sync-state.json`
3. Run `npm run sync:pull` to rebuild state
4. Verify all workflows are in correct locations

**What to Expect:**
- No more duplicate workflows
- Files stay in correct folders
- Watcher works reliably
- Better error messages

