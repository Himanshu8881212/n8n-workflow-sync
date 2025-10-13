import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, relative, sep } from 'path';
import { existsSync } from 'fs';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch';
import { config } from './config.js';

/**
 * File Manager for local workflow files
 */
export class FileManager {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  /**
   * Get all workflow files recursively
   */
  async getAllWorkflowFiles() {
    const files = [];
    await this._scanDirectory(this.baseDir, files);
    return files.filter(f => this._shouldInclude(f));
  }

  /**
   * Recursively scan directory for JSON files
   */
  async _scanDirectory(dir, files) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await this._scanDirectory(fullPath, files);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  /**
   * Check if file should be included based on patterns
   */
  _shouldInclude(filePath) {
    const relativePath = relative(this.baseDir, filePath);

    // Check ignore patterns
    for (const pattern of config.filters.ignorePatterns) {
      if (minimatch(relativePath, pattern)) {
        return false;
      }
    }

    // Check include patterns
    for (const pattern of config.filters.includePatterns) {
      if (minimatch(relativePath, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Read workflow from file
   */
  async readWorkflow(filePath) {
    const content = await readFile(filePath, 'utf-8');
    const workflow = JSON.parse(content);

    return {
      ...workflow,
      _metadata: {
        filePath: relative(this.baseDir, filePath),
        hash: this._calculateHash(content),
        lastModified: (await stat(filePath)).mtime,
      },
    };
  }

  /**
   * Write workflow to file
   */
  async writeWorkflow(filePath, workflow) {
    // Remove metadata before writing
    const { _metadata, ...cleanWorkflow } = workflow;

    const content = JSON.stringify(cleanWorkflow, null, 2);

    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    await writeFile(filePath, content, 'utf-8');
    return this._calculateHash(content);
  }

  /**
   * Calculate file hash for change detection
   */
  _calculateHash(content) {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get absolute path from relative path
   */
  getAbsolutePath(relativePath) {
    return join(this.baseDir, relativePath);
  }

  /**
   * Get workflow path from metadata
   */
  getWorkflowPath(workflow) {
    // Extract path from workflow tags or name
    const tags = workflow.tags || [];
    const pathTag = tags.find(t => t.name?.startsWith('path:'));

    if (pathTag) {
      const path = pathTag.name.replace('path:', '');
      return join(this.baseDir, path);
    }

    // Fallback: derive from workflow name
    return this._derivePathFromName(workflow.name);
  }

  /**
   * Derive file path from workflow name
   */
  _derivePathFromName(name) {
    // Parse workflow name pattern: [Suite] Method - Stage
    // Example: [Text] SFT - Configure -> 01-text-generation-suite/02-supervised-finetuning/sft/configure-sft.json

    const match = name.match(/\[(.+?)\]\s+(.+?)\s+-\s+(.+)/);
    if (!match) {
      // Fallback to simple naming
      const fileName = name.toLowerCase().replace(/\s+/g, '-') + '.json';
      return join(this.baseDir, fileName);
    }

    const [, suite, method, stage] = match;
    const suiteMap = {
      'Text': '01-text-generation-suite',
      'Image': '02-image-data-suite',
      'TimeSeries': '03-time-series-suite',
      'Tabular': '04-tabular-data-suite',
      'Shared': '00-shared-components',
      'Utility': '99-utilities',
    };

    const suiteDir = suiteMap[suite] || suite.toLowerCase();
    const methodDir = method.toLowerCase().replace(/\s+/g, '-');
    const fileName = `${stage.toLowerCase().replace(/\s+/g, '-')}-${methodDir}.json`;

    return join(this.baseDir, suiteDir, methodDir, fileName);
  }

  /**
   * Get relative path for display
   */
  getRelativePath(filePath) {
    return relative(this.baseDir, filePath);
  }
}

