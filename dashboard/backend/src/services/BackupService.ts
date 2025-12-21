import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import archiver from 'archiver';
import extract from 'extract-zip';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

export interface BackupOptions {
  type: 'full' | 'instance' | 'database';
  instanceId?: string;
  name?: string;
  createdBy: string;
}

export interface RestoreOptions {
  backupId: string;
  instanceId?: string;
}

export class BackupService {
  private readonly BACKUP_DIR: string;

  constructor(backupDir?: string) {
    this.BACKUP_DIR = backupDir || path.join(process.cwd(), '../backups');
    this.ensureBackupDir();
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDir(): Promise<void> {
    try {
      await fs.mkdir(this.BACKUP_DIR, { recursive: true });
    } catch (error) {
      logger.error('Error creating backup directory:', error);
    }
  }

  /**
   * Create a backup
   */
  async createBackup(options: BackupOptions) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = options.name || `backup-${options.type}-${timestamp}`;
      const backupPath = path.join(this.BACKUP_DIR, `${backupName}.zip`);

      let filesToBackup: string[] = [];
      let size = 0;

      switch (options.type) {
        case 'full':
          // Backup everything: database, projects, configs
          filesToBackup = await this.getFullBackupFiles();
          break;

        case 'instance':
          if (!options.instanceId) {
            throw new Error('Instance ID required for instance backup');
          }
          // Backup specific instance
          filesToBackup = await this.getInstanceBackupFiles(options.instanceId);
          break;

        case 'database':
          // Backup only database
          filesToBackup = await this.getDatabaseBackupFiles();
          break;

        default:
          throw new Error(`Invalid backup type: ${options.type}`);
      }

      // Create zip archive
      await this.createZipArchive(filesToBackup, backupPath);

      // Get file size
      const stats = await fs.stat(backupPath);
      size = stats.size;

      // Save backup record to database
      const backup = await prisma.backup.create({
        data: {
          name: backupName,
          type: options.type,
          instanceId: options.instanceId,
          size,
          path: backupPath,
          createdBy: options.createdBy
        }
      });

      logger.info(`Backup created: ${backupName} (${this.formatBytes(size)})`);

      return backup;
    } catch (error) {
      logger.error('Error creating backup:', error);
      throw error;
    }
  }

  /**
   * Get all backups
   */
  async listBackups(type?: string) {
    try {
      const where = type ? { type } : {};
      return await prisma.backup.findMany({
        where,
        include: {
          user: {
            select: {
              email: true,
              username: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
    } catch (error) {
      logger.error('Error listing backups:', error);
      throw error;
    }
  }

  /**
   * Get backup by ID
   */
  async getBackup(id: string) {
    try {
      return await prisma.backup.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              email: true,
              username: true
            }
          }
        }
      });
    } catch (error) {
      logger.error('Error fetching backup:', error);
      throw error;
    }
  }

  /**
   * Delete backup
   */
  async deleteBackup(id: string): Promise<void> {
    try {
      const backup = await this.getBackup(id);
      if (!backup) {
        throw new Error('Backup not found');
      }

      // Delete file
      await fs.unlink(backup.path);

      // Delete database record
      await prisma.backup.delete({
        where: { id }
      });

      logger.info(`Backup deleted: ${backup.name}`);
    } catch (error) {
      logger.error('Error deleting backup:', error);
      throw error;
    }
  }

  /**
   * Restore from backup
   */
  async restoreBackup(options: RestoreOptions) {
    try {
      const backup = await this.getBackup(options.backupId);
      if (!backup) {
        throw new Error('Backup not found');
      }

      const extractPath = path.join(this.BACKUP_DIR, `restore-${Date.now()}`);
      await fs.mkdir(extractPath, { recursive: true });

      // Extract backup
      await extract(backup.path, { dir: extractPath });

      // Restore based on type
      switch (backup.type) {
        case 'full':
          await this.restoreFullBackup(extractPath);
          break;

        case 'instance':
          if (!options.instanceId) {
            throw new Error('Instance ID required for instance restore');
          }
          await this.restoreInstanceBackup(extractPath, options.instanceId);
          break;

        case 'database':
          await this.restoreDatabaseBackup(extractPath);
          break;

        default:
          throw new Error(`Invalid backup type: ${backup.type}`);
      }

      // Cleanup
      await fs.rm(extractPath, { recursive: true, force: true });

      logger.info(`Backup restored: ${backup.name}`);

      return { success: true, message: `Backup ${backup.name} restored successfully` };
    } catch (error) {
      logger.error('Error restoring backup:', error);
      throw error;
    }
  }

  /**
   * Get files for full backup
   */
  private async getFullBackupFiles(): Promise<string[]> {
    const files: string[] = [];
    const projectsDir = path.join(process.cwd(), '../../projects');
    const dbPath = path.join(process.cwd(), 'prisma/data/multibase.db');

    // Add database
    files.push(dbPath);

    // Add all projects
    try {
      const projects = await fs.readdir(projectsDir);
      for (const project of projects) {
        const projectPath = path.join(projectsDir, project);
        files.push(projectPath);
      }
    } catch (error) {
      logger.warn('Error reading projects directory:', error);
    }

    return files;
  }

  /**
   * Get files for instance backup
   */
  private async getInstanceBackupFiles(instanceId: string): Promise<string[]> {
    const projectPath = path.join(process.cwd(), '../../projects', instanceId);
    return [projectPath];
  }

  /**
   * Get files for database backup
   */
  private async getDatabaseBackupFiles(): Promise<string[]> {
    const dbPath = path.join(process.cwd(), 'prisma/data/multibase.db');
    return [dbPath];
  }

  /**
   * Create zip archive
   */
  private async createZipArchive(files: string[], outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = require('fs').createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      for (const file of files) {
        const stats = require('fs').statSync(file);
        if (stats.isDirectory()) {
          archive.directory(file, path.basename(file));
        } else {
          archive.file(file, { name: path.basename(file) });
        }
      }

      archive.finalize();
    });
  }

  /**
   * Restore full backup
   */
  private async restoreFullBackup(extractPath: string): Promise<void> {
    // Copy database
    const dbSrc = path.join(extractPath, 'multibase.db');
    const dbDest = path.join(process.cwd(), 'prisma/data/multibase.db');
    await fs.copyFile(dbSrc, dbDest);

    // Copy projects
    const projectsDest = path.join(process.cwd(), '../../projects');
    const extractedProjects = await fs.readdir(extractPath);
    
    for (const item of extractedProjects) {
      if (item !== 'multibase.db') {
        const src = path.join(extractPath, item);
        const dest = path.join(projectsDest, item);
        await this.copyRecursive(src, dest);
      }
    }
  }

  /**
   * Restore instance backup
   */
  private async restoreInstanceBackup(extractPath: string, instanceId: string): Promise<void> {
    const projectsDest = path.join(process.cwd(), '../../projects', instanceId);
    const extractedDirs = await fs.readdir(extractPath);
    
    if (extractedDirs.length > 0) {
      const src = path.join(extractPath, extractedDirs[0]);
      await this.copyRecursive(src, projectsDest);
    }
  }

  /**
   * Restore database backup
   */
  private async restoreDatabaseBackup(extractPath: string): Promise<void> {
    const dbSrc = path.join(extractPath, 'multibase.db');
    const dbDest = path.join(process.cwd(), 'prisma/data/multibase.db');
    await fs.copyFile(dbSrc, dbDest);
  }

  /**
   * Copy directory recursively
   */
  private async copyRecursive(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyRecursive(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Format bytes to human-readable format
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }
}

export default new BackupService();
