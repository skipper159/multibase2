import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  username: string;
  password: string;
  role?: 'admin' | 'user' | 'viewer';
}

export interface SessionData {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
}

export class AuthService {
  private readonly SALT_ROUNDS = 10;
  private readonly SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

  /**
   * Hash a password
   */
  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify password
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate session token
   */
  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Register a new user
   */
  async register(data: RegisterData) {
    try {
      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email: data.email }, { username: data.username }],
        },
      });

      if (existingUser) {
        throw new Error('User with this email or username already exists');
      }

      // Hash password
      const passwordHash = await this.hashPassword(data.password);

      // Create user
      const user = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash,
          role: data.role || 'user',
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      logger.info(`User registered: ${user.email}`);
      return user;
    } catch (error) {
      logger.error('Error registering user:', error);
      throw error;
    }
  }

  /**
   * Login user and create session
   */
  async login(
    credentials: LoginCredentials,
    ipAddress?: string,
    userAgent?: string
  ): Promise<{ user: any; session: SessionData }> {
    try {
      // Find user
      const user = await prisma.user.findUnique({
        where: { email: credentials.email },
      });

      if (!user || !user.isActive) {
        throw new Error('Invalid credentials');
      }

      // Verify password
      const isValid = await this.verifyPassword(credentials.password, user.passwordHash);
      if (!isValid) {
        throw new Error('Invalid credentials');
      }

      // Create session
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + this.SESSION_DURATION);

      const session = await prisma.session.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
          ipAddress,
          userAgent,
        },
      });

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLogin: new Date() },
      });

      logger.info(`User logged in: ${user.email}`);

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
        },
        session: {
          id: session.id,
          userId: session.userId,
          token: session.token,
          expiresAt: session.expiresAt,
        },
      };
    } catch (error) {
      logger.error('Error logging in:', error);
      throw error;
    }
  }

  /**
   * Validate session token
   */
  async validateSession(token: string) {
    try {
      const session = await prisma.session.findUnique({
        where: { token },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              username: true,
              role: true,
              isActive: true,
            },
          },
        },
      });

      if (!session || !session.user.isActive) {
        return null;
      }

      // Check if session expired
      if (session.expiresAt < new Date()) {
        await this.logout(token);
        return null;
      }

      return {
        user: session.user,
        session: {
          id: session.id,
          userId: session.userId,
          token: session.token,
          expiresAt: session.expiresAt,
        },
      };
    } catch (error) {
      logger.error('Error validating session:', error);
      return null;
    }
  }

  /**
   * Logout user (delete session)
   */
  async logout(token: string): Promise<void> {
    try {
      await prisma.session.delete({
        where: { token },
      });
      logger.info('User logged out');
    } catch (error) {
      logger.error('Error logging out:', error);
      throw error;
    }
  }

  /**
   * Get all users
   */
  async getAllUsers() {
    try {
      return await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      logger.error('Error fetching users:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string) {
    try {
      return await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      logger.error('Error fetching user:', error);
      throw error;
    }
  }

  /**
   * Update user
   */
  async updateUser(id: string, data: Partial<RegisterData> & { isActive?: boolean }) {
    try {
      const updateData: any = {};

      if (data.email) updateData.email = data.email;
      if (data.username) updateData.username = data.username;
      if (data.role) updateData.role = data.role;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;
      if (data.password) {
        updateData.passwordHash = await this.hashPassword(data.password);
      }

      const user = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          isActive: true,
          lastLogin: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      logger.info(`User updated: ${user.email}`);
      return user;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  /**
   * Delete user
   */
  async deleteUser(id: string): Promise<void> {
    try {
      await prisma.user.delete({
        where: { id },
      });
      logger.info(`User deleted: ${id}`);
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  /**
   * Create initial admin user if none exists
   */
  async createInitialAdmin() {
    try {
      const adminExists = await prisma.user.findFirst({
        where: { role: 'admin' },
      });

      if (!adminExists) {
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
        await this.register({
          email: 'admin@multibase.local',
          username: 'admin',
          password: defaultPassword,
          role: 'admin',
        });
        logger.info('Initial admin user created');
        logger.warn(`Default admin password: ${defaultPassword}`);
      }
    } catch (error) {
      logger.error('Error creating initial admin:', error);
    }
  }
}

export default new AuthService();
