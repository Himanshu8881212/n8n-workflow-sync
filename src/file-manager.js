import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, relative, extname, resolve, sep } from 'path';
import { createHash } from 'crypto';
import { minimatch } from 'minimatch';
import yaml from 'js-yaml';
import { config } from './config.js';

// Node parameters that hold code and may live in a separate file
export const CODE_PARAMS = ['jsCode', 'pythonCode', 'functionCode'];
export const CODE_REF = '@file:';

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
    // *.n8n.json = data-tables / variables files, not workflows
    return files.filter((f) => !f.endsWith('.n8n.json') && this._shouldInclude(f));
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
   * Read workflow from file (supports JSON and YAML).
   *
   * Code node parameters may point at a separate file
   * (`"jsCode": "@file:my-flow.transform.js"`, relative to the workflow file);
   * they are inlined here so everything downstream sees real code.
   * `_metadata.raw` keeps the file exactly as written (with the references),
   * `_metadata.hash` covers the workflow file plus its code files.
   */
  async readWorkflow(filePath) {
    const content = await readFile(filePath, 'utf-8');
    const ext = extname(filePath).toLowerCase();
    const raw = ext === '.yaml' || ext === '.yml' ? yaml.load(content) : JSON.parse(content);

    const codeRefs = [];
    let workflow = raw;
    if (Array.isArray(raw?.nodes)) {
      workflow = { ...raw, nodes: [] };
      for (const node of raw.nodes) {
        const params = { ...(node?.parameters || {}) };
        for (const param of CODE_PARAMS) {
          const value = params[param];
          if (typeof value === 'string' && value.startsWith(CODE_REF)) {
            const path = resolve(dirname(filePath), value.slice(CODE_REF.length).trim());
            if (!existsSync(path)) throw new Error(`node "${node.name}": code file not found: ${value}`);
            params[param] = await readFile(path, 'utf-8');
            codeRefs.push({ node: node.name, param, path, content: params[param] });
          }
        }
        workflow.nodes.push(node?.parameters ? { ...node, parameters: params } : node);
      }
    }

    return {
      ...workflow,
      _metadata: {
        filePath: relative(this.baseDir, filePath),
        hash: this._calculateHash(content + codeRefs.map((r) => '\0' + r.content).join('')),
        raw,
        codeRefs,
        format: ext === '.yaml' || ext === '.yml' ? 'yaml' : 'json',
      },
    };
  }

  /**
   * Build what writing an (inline-code) workflow would produce. Code params
   * listed in `refs` (Map "node\0param" -> code file path) are written to
   * their own file and replaced by an `@file:` reference.
   * @returns {{ content: string, codeFiles: {path: string, content: string}[], hash: string }}
   */
  prepareWrite(filePath, workflow, refs = new Map()) {
    const codeFiles = [];
    let out = workflow;
    if (refs.size && Array.isArray(workflow.nodes)) {
      out = {
        ...workflow,
        nodes: workflow.nodes.map((node) => {
          const params = { ...(node.parameters || {}) };
          for (const param of CODE_PARAMS) {
            const path = refs.get(`${node.name}\0${param}`);
            if (path && typeof params[param] === 'string') {
              codeFiles.push({ path, content: params[param] });
              let rel = relative(dirname(filePath), path).split(sep).join('/');
              if (!rel.startsWith('.')) rel = `./${rel}`;
              params[param] = `${CODE_REF}${rel}`;
            }
          }
          return node.parameters ? { ...node, parameters: params } : node;
        }),
      };
    }
    const content = this.serialize(filePath, out);
    return { content, codeFiles, hash: this._calculateHash(content + codeFiles.map((c) => '\0' + c.content).join('')) };
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
   * Write workflow to file (supports JSON and YAML). `workflow` is written
   * as-is; pass `refs` to split code params into their own files.
   */
  async writeWorkflow(filePath, workflow, refs) {
    const { content, codeFiles, hash } = this.prepareWrite(filePath, workflow, refs);
    await mkdir(dirname(filePath), { recursive: true });
    for (const file of codeFiles) await writeFile(file.path, file.content, 'utf-8');
    await writeFile(filePath, content, 'utf-8');
    return hash;
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

