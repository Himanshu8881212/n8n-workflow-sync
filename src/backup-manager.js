import { mkdir, readFile, writeFile, readdir, stat, rm } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { Logger } from './logger-enhanced.js';

const logger = new Logger('BackupManager');

/**
 * Backup Manager for workflow files
 * 
 * @class BackupManager
 * @description Manages automatic backups of workflow files before destructive operations
 * Features:
 * - Automatic backup before sync operations
 * - Timestamped backup directories
 * - Backup rotation (keep last N backups)
 * - Restore from backup
 * - Backup verification with checksums
 * 
 * @example
 * const backupManager = new BackupManager('./workflows', './backups');
 * await backupManager.createBackup('pre-sync');
 * await backupManager.restoreBackup('backup-2025-01-13-123456');
 */
export class BackupManager {
  /**
   * Create a backup manager
   * @param {string} sourceDir - Directory to backup
   * @param {string} backupDir - Directory to store backups
   * @param {Object} options - Backup options
   * @param {number} options.maxBackups - Maximum number of backups to keep (default: 10)
   * @param {boolean} options.compress - Compress backups (not implemented yet)
   */
  constructor(sourceDir, backupDir = '.backups', options = {}) {
    this.sourceDir = sourceDir;
    this.backupDir = backupDir;
    this.maxBackups = options.maxBackups || 10;
    this.compress = options.compress || false;
  }

  /**
   * Create a backup of all workflow files
   * @param {string} label - Label for the backup (e.g., 'pre-sync', 'manual')
   * @returns {Promise<Object>} Backup metadata
   */
  async createBackup(label = 'manual') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    const backupName = `backup-${label}-${timestamp}`;
    const backupPath = join(this.backupDir, backupName);

    logger.info(`Creating backup: ${backupName}`);

    try {
      // Ensure backup directory exists
      if (!existsSync(this.backupDir)) {
        await mkdir(this.backupDir, { recursive: true });
      }

      // Create backup subdirectory
      await mkdir(backupPath, { recursive: true });

      // Copy all files
      const files = await this._getAllFiles(this.sourceDir);
      const copiedFiles = [];

      for (const file of files) {
        const relativePath = file.replace(this.sourceDir + '/', '');
        const destPath = join(backupPath, relativePath);
        const destDir = join(destPath, '..');

        // Ensure destination directory exists
        if (!existsSync(destDir)) {
          await mkdir(destDir, { recursive: true });
        }

        // Copy file
        const content = await readFile(file);
        await writeFile(destPath, content);

        copiedFiles.push({
          path: relativePath,
          size: content.length,
          checksum: this._calculateChecksum(content),
        });
      }

      // Create metadata file
      const metadata = {
        name: backupName,
        label,
        timestamp: new Date().toISOString(),
        sourceDir: this.sourceDir,
        fileCount: copiedFiles.length,
        files: copiedFiles,
        totalSize: copiedFiles.reduce((sum, f) => sum + f.size, 0),
      };

      await writeFile(join(backupPath, 'metadata.json'), JSON.stringify(metadata, null, 2));

      logger.info(`Backup created successfully: ${backupName}`, {
        fileCount: copiedFiles.length,
        totalSize: metadata.totalSize,
      });

      // Rotate old backups
      await this._rotateBackups();

      return metadata;
    } catch (error) {
      logger.error('Failed to create backup', error);
      throw error;
    }
  }

  /**
   * List all available backups
   * @returns {Promise<Array>} List of backup metadata
   */
  async listBackups() {
    if (!existsSync(this.backupDir)) {
      return [];
    }

    const entries = await readdir(this.backupDir, { withFileTypes: true });
    const backups = [];

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backup-')) {
        const metadataPath = join(this.backupDir, entry.name, 'metadata.json');
        if (existsSync(metadataPath)) {
          const metadata = JSON.parse(await readFile(metadataPath, 'utf-8'));
          const stats = await stat(join(this.backupDir, entry.name));
          backups.push({
            ...metadata,
            path: join(this.backupDir, entry.name),
            created: stats.birthtime,
          });
        }
      }
    }

    // Sort by timestamp (newest first)
    return backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  /**
   * Restore from a backup
   * @param {string} backupName - Name of the backup to restore
   * @param {Object} options - Restore options
   * @param {boolean} options.verify - Verify checksums before restore (default: true)
   * @param {boolean} options.createBackup - Create backup before restore (default: true)
   * @returns {Promise<Object>} Restore result
   */
  async restoreBackup(backupName, options = {}) {
    const verify = options.verify !== false;
    const createBackup = options.createBackup !== false;

    const backupPath = join(this.backupDir, backupName);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }

    logger.info(`Restoring backup: ${backupName}`);

    try {
      // Load metadata
      const metadataPath = join(backupPath, 'metadata.json');
      const metadata = JSON.parse(await readFile(metadataPath, 'utf-8'));

      // Verify backup integrity
      if (verify) {
        logger.info('Verifying backup integrity...');
        const isValid = await this._verifyBackup(backupPath, metadata);
        if (!isValid) {
          throw new Error('Backup verification failed - checksums do not match');
        }
        logger.info('Backup verification passed');
      }

      // Create backup of current state before restore
      if (createBackup) {
        await this.createBackup('pre-restore');
      }

      // Restore files
      const restoredFiles = [];
      for (const fileInfo of metadata.files) {
        const sourcePath = join(backupPath, fileInfo.path);
        const destPath = join(this.sourceDir, fileInfo.path);
        const destDir = join(destPath, '..');

        // Ensure destination directory exists
        if (!existsSync(destDir)) {
          await mkdir(destDir, { recursive: true });
        }

        // Copy file
        const content = await readFile(sourcePath);
        await writeFile(destPath, content);

        restoredFiles.push(fileInfo.path);
      }

      logger.info(`Backup restored successfully: ${backupName}`, {
        fileCount: restoredFiles.length,
      });

      return {
        success: true,
        backupName,
        filesRestored: restoredFiles.length,
        files: restoredFiles,
      };
    } catch (error) {
      logger.error('Failed to restore backup', error);
      throw error;
    }
  }

  /**
   * Delete a backup
   * @param {string} backupName - Name of the backup to delete
   * @returns {Promise<boolean>} True if deleted successfully
   */
  async deleteBackup(backupName) {
    const backupPath = join(this.backupDir, backupName);

    if (!existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }

    logger.info(`Deleting backup: ${backupName}`);

    try {
      await rm(backupPath, { recursive: true, force: true });
      logger.info(`Backup deleted: ${backupName}`);
      return true;
    } catch (error) {
      logger.error('Failed to delete backup', error);
      throw error;
    }
  }

  /**
   * Get all files recursively
   * @private
   */
  async _getAllFiles(dir) {
    const files = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip backup directory
        if (fullPath === this.backupDir) continue;
        files.push(...(await this._getAllFiles(fullPath)));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Calculate checksum for content
   * @private
   */
  _calculateChecksum(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Verify backup integrity
   * @private
   */
  async _verifyBackup(backupPath, metadata) {
    for (const fileInfo of metadata.files) {
      const filePath = join(backupPath, fileInfo.path);
      if (!existsSync(filePath)) {
        logger.warn(`File missing in backup: ${fileInfo.path}`);
        return false;
      }

      const content = await readFile(filePath);
      const checksum = this._calculateChecksum(content);

      if (checksum !== fileInfo.checksum) {
        logger.warn(`Checksum mismatch for: ${fileInfo.path}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Rotate old backups (keep only maxBackups)
   * @private
   */
  async _rotateBackups() {
    const backups = await this.listBackups();

    if (backups.length > this.maxBackups) {
      const toDelete = backups.slice(this.maxBackups);
      logger.info(`Rotating backups: deleting ${toDelete.length} old backups`);

      for (const backup of toDelete) {
        await this.deleteBackup(backup.name);
      }
    }
  }
}

