import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises';
import { join, dirname, relative, extname } from 'path';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch';
import yaml from 'js-yaml';
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
   * Recursively scan directory for JSON and YAML files
   */
  async _scanDirectory(dir, files) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        await this._scanDirectory(fullPath, files);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === '.json' || ext === '.yaml' || ext === '.yml') {
          files.push(fullPath);
        }
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
   * Read workflow from file (supports JSON and YAML)
   */
  async readWorkflow(filePath) {
    const content = await readFile(filePath, 'utf-8');
    const ext = extname(filePath).toLowerCase();

    let workflow;
    if (ext === '.yaml' || ext === '.yml') {
      workflow = yaml.load(content);
    } else {
      workflow = JSON.parse(content);
    }

    return {
      ...workflow,
      _metadata: {
        filePath: relative(this.baseDir, filePath),
        hash: this._calculateHash(content),
        lastModified: (await stat(filePath)).mtime,
        format: ext === '.yaml' || ext === '.yml' ? 'yaml' : 'json',
      },
    };
  }

  /**
   * Serialize workflow for the file's format (JSON or YAML)
   */
  serialize(filePath, workflow) {
    const { _metadata, ...clean } = workflow;
    const ext = extname(filePath).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
      return yaml.dump(clean, { indent: 2, lineWidth: 120, noRefs: true });
    }
    return JSON.stringify(clean, null, 2) + '\n';
  }

  /**
   * Write workflow to file (supports JSON and YAML)
   */
  async writeWorkflow(filePath, workflow) {
    const content = this.serialize(filePath, workflow);
    await mkdir(dirname(filePath), { recursive: true });
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
   * Get relative path for display
   */
  getRelativePath(filePath) {
    const rel = relative(this.baseDir, filePath);
    return rel.startsWith('..') ? relative(process.cwd(), filePath) : rel;
  }
}

