import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';
import EmailService from './EmailService';

export interface LoginCredentials {
  email: string;
  password: string;
  twoFactorToken?: string;
}

export interface RegisterData {
  email: string;
  username: string;
  password: string;
  role?: 'admin' | 'user' | 'viewer';
  mustChangePassword?: boolean;
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

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');

      // Create user
      const user = await prisma.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash,
          mustChangePassword: data.mustChangePassword ?? false,
          role: data.role || 'user',
          isActive: true, // Allow login but require verification? Or disable until verified?
          isEmailVerified: false,
          verificationToken,
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          mustChangePassword: true,
          isActive: true,
          createdAt: true,
        },
      });

      // Send verification email
      await EmailService.sendVerificationEmail(user.email, verificationToken, user.username);

      // Auto-create a personal organisation for the user
      try {
        let slug = data.username
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .substring(0, 60);

        const existingOrg = await prisma.organisation.findUnique({ where: { slug } });
        if (existingOrg) slug = `${slug}-${Date.now().toString(36)}`;

        await prisma.organisation.create({
          data: {
            name: `${data.username}'s Organisation`,
            slug,
            description: 'Automatically created personal organisation',
            members: { create: { userId: user.id, role: 'owner' } },
          },
        });
        logger.info(`Auto-created organisation for user: ${user.email}`);
      } catch (orgError) {
        logger.error('Failed to create auto-organisation (non-fatal):', orgError);
      }

      logger.info(`User registered: ${user.email}`);
      return user;
    } catch (error) {
      logger.error('Error registering user:', error);
      throw error;
    }
  }

  /**
   * Verify email with token
   */
  async verifyEmail(token: string): Promise<void> {
    try {
      const user = await prisma.user.findFirst({
        where: { verificationToken: token },
      });

      if (!user) {
        throw new Error('Invalid or expired verification token');
      }

      await prisma.user.update({
        where: { id: user.id },
        data: {
          isEmailVerified: true,
          verificationToken: null,
          isActive: true, // Activate user upon verification
        },
      });

      logger.info(`Email verified for user: ${user.email}`);
    } catch (error) {
      logger.error('Error verifying email:', error);
      throw error;
    }
  }

  /**
   * Request password reset
   */
  async forgotPassword(email: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        // Don't reveal user existence
        logger.info(`Password reset requested for non-existent email: ${email}`);
        return;
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 3600000); // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: {
          resetPasswordToken: resetToken,
          resetPasswordExpires: resetExpires,
        },
      });

      // Send email
      await EmailService.sendPasswordResetEmail(user.email, resetToken);
      logger.info(`Password reset email sent to: ${user.email}`);
    } catch (error) {
      logger.error('Error in forgot password service:', error);
      throw error;
    }
  }

  /**
   * Reset password with token
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      const user = await prisma.user.findFirst({
        where: {
          resetPasswordToken: token,
          resetPasswordExpires: {
            gt: new Date(),
          },
        },
      });

      if (!user) {
        throw new Error('Invalid or expired reset token');
      }

      const passwordHash = await this.hashPassword(newPassword);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      });

      // Optional: Revoke all existing sessions
      await prisma.session.deleteMany({
        where: { userId: user.id },
      });

      logger.info(`Password successfully reset for user: ${user.email}`);
    } catch (error) {
      logger.error('Error resetting password:', error);
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
  ): Promise<{ user: any; session: SessionData | null; require2fa?: boolean }> {
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

      // Check 2FA
      if (user.twoFactorEnabled) {
        if (!credentials.twoFactorToken) {
          // 2FA required but no token provided
          return {
            user: { id: user.id },
            session: null,
            require2fa: true,
          };
        }

        // Verify token
        const isTokenValid = authenticator.verify({
          token: credentials.twoFactorToken,
          secret: user.twoFactorSecret!,
        });

        if (!isTokenValid) {
          throw new Error('Invalid 2FA code');
        }
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
          mustChangePassword: user.mustChangePassword,
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
              avatar: true,
              twoFactorEnabled: true,
              mustChangePassword: true,
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
          twoFactorEnabled: true,
          mustChangePassword: true,
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
          mustChangePassword: true,
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
        updateData.mustChangePassword = false;
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
      // First delete all sessions for this user
      await prisma.session.deleteMany({
        where: { userId: id },
      });

      // Delete all backups created by this user
      await prisma.backup.deleteMany({
        where: { createdBy: id },
      });

      // Then delete the user
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
   * Update user password only
   */
  async updatePassword(id: string, password: string): Promise<void> {
    try {
      const passwordHash = await this.hashPassword(password);
      await prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: false },
      });
      logger.info(`Password updated for user: ${id}`);
    } catch (error) {
      logger.error('Error updating password:', error);
      throw error;
    }
  }

  /**
   * Change the currently authenticated user's password after verifying the
   * existing password.
   */
  async changePassword(id: string, currentPassword: string, newPassword: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: { passwordHash: true },
      });

      if (!user || !(await this.verifyPassword(currentPassword, user.passwordHash))) {
        throw new Error('Current password is incorrect');
      }

      const passwordHash = await this.hashPassword(newPassword);
      await prisma.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: false },
      });
      logger.info(`Password changed for user: ${id}`);
    } catch (error) {
      logger.error('Error changing password:', error);
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
        const defaultPassword = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
        const defaultEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@multibase.local';
        const defaultUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';

        if (!defaultPassword) {
          logger.error('Cannot create initial admin: DEFAULT_ADMIN_PASSWORD is not configured.');
          return;
        }

        await this.register({
          email: defaultEmail,
          username: defaultUsername,
          password: defaultPassword,
          role: 'admin',
          mustChangePassword: true,
        });
        logger.info(`Initial admin user created: ${defaultEmail}`);
        logger.warn('Initial admin password change is required at first login.');
      }
    } catch (error) {
      logger.error('Error creating initial admin:', error);
    }
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string) {
    try {
      return await prisma.session.findMany({
        where: { userId },
        select: {
          id: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      logger.error('Error fetching user sessions:', error);
      throw error;
    }
  }

  /**
   * Delete a specific session
   */
  async deleteSession(sessionId: string, userId: string): Promise<void> {
    try {
      // Verify the session belongs to the user (or caller is admin - checked in route)
      const session = await prisma.session.findFirst({
        where: {
          id: sessionId,
          userId,
        },
      });

      if (!session) {
        throw new Error('Session not found or access denied');
      }

      await prisma.session.delete({
        where: { id: sessionId },
      });

      logger.info(`Session ${sessionId} deleted for user ${userId}`);
    } catch (error) {
      logger.error('Error deleting session:', error);
      throw error;
    }
  }

  /**
   * Delete self account
   */
  async deleteSelf(userId: string, password: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Verify password
      const isValid = await this.verifyPassword(password, user.passwordHash);
      if (!isValid) {
        throw new Error('Invalid password');
      }

      // Delete user (cascades to sessions usually)
      await prisma.user.delete({
        where: { id: userId },
      });

      logger.info(`User deleted own account: ${user.email}`);
    } catch (error) {
      logger.error('Error deleting own account:', error);
      throw error;
    }
  }

  // =====================================================
  // Profile Update Methods
  // =====================================================

  /**
   * Update user's own profile (username, email)
   */
  async updateProfile(userId: string, data: { username?: string; email?: string }) {
    try {
      const updateData: any = {};

      if (data.username) {
        // Check if username is taken by another user
        const existingUser = await prisma.user.findFirst({
          where: { username: data.username, NOT: { id: userId } },
        });
        if (existingUser) {
          throw new Error('Username is already taken');
        }
        updateData.username = data.username;
      }

      if (data.email) {
        // Check if email is taken by another user
        const existingUser = await prisma.user.findFirst({
          where: { email: data.email, NOT: { id: userId } },
        });
        if (existingUser) {
          throw new Error('Email is already taken');
        }
        updateData.email = data.email;
      }

      if (Object.keys(updateData).length === 0) {
        throw new Error('No valid fields to update');
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          avatar: true,
          twoFactorEnabled: true,
          isActive: true,
        },
      });

      logger.info(`Profile updated for user: ${userId}`);
      return user;
    } catch (error) {
      logger.error('Error updating profile:', error);
      throw error;
    }
  }

  /**
   * Update user avatar path
   */
  async updateAvatar(userId: string, avatarPath: string | null) {
    try {
      // Get old avatar to delete
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { avatar: true },
      });

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { avatar: avatarPath },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          avatar: true,
          twoFactorEnabled: true,
          isActive: true,
        },
      });

      // Delete old avatar file if exists
      if (user?.avatar && avatarPath !== user.avatar) {
        const oldAvatarPath = path.join(
          __dirname,
          '../../uploads/avatars',
          path.basename(user.avatar)
        );
        if (fs.existsSync(oldAvatarPath)) {
          fs.unlinkSync(oldAvatarPath);
          logger.info(`Deleted old avatar: ${oldAvatarPath}`);
        }
      }

      logger.info(`Avatar updated for user: ${userId}`);
      return updated;
    } catch (error) {
      logger.error('Error updating avatar:', error);
      throw error;
    }
  }

  // =====================================================
  // Two-Factor Authentication Methods
  // =====================================================

  /**
   * Enable 2FA for a user - generates secret and QR code
   */
  async enable2FA(
    userId: string
  ): Promise<{ secret: string; qrCodeDataUrl: string; otpauthUrl: string }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, twoFactorEnabled: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (user.twoFactorEnabled) {
        throw new Error('2FA is already enabled');
      }

      // Generate secret
      const secret = authenticator.generateSecret();
      const otpauthUrl = authenticator.keyuri(user.email, 'Multibase Dashboard', secret);

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

      // Store secret temporarily (not enabled yet, user must verify)
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorSecret: secret },
      });

      logger.info(`2FA secret generated for user: ${userId}`);

      return {
        secret,
        qrCodeDataUrl,
        otpauthUrl,
      };
    } catch (error) {
      logger.error('Error enabling 2FA:', error);
      throw error;
    }
  }

  /**
   * Verify and activate 2FA for a user
   */
  async verify2FA(userId: string, token: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorSecret: true, twoFactorEnabled: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (!user.twoFactorSecret) {
        throw new Error('2FA has not been initiated. Please call enable2FA first.');
      }

      if (user.twoFactorEnabled) {
        throw new Error('2FA is already enabled');
      }

      // Verify the token
      const isValid = authenticator.verify({ token, secret: user.twoFactorSecret });

      if (!isValid) {
        throw new Error('Invalid verification code');
      }

      // Enable 2FA
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true },
      });

      logger.info(`2FA enabled for user: ${userId}`);
      return true;
    } catch (error) {
      logger.error('Error verifying 2FA:', error);
      throw error;
    }
  }

  /**
   * Disable 2FA for a user (requires valid token)
   */
  async disable2FA(userId: string, token: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorSecret: true, twoFactorEnabled: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new Error('2FA is not enabled');
      }

      // Verify the token before disabling
      const isValid = authenticator.verify({ token, secret: user.twoFactorSecret });

      if (!isValid) {
        throw new Error('Invalid verification code');
      }

      // Disable 2FA
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });

      logger.info(`2FA disabled for user: ${userId}`);
      return true;
    } catch (error) {
      logger.error('Error disabling 2FA:', error);
      throw error;
    }
  }

  /**
   * Validate 2FA token for login
   */
  async validate2FAToken(userId: string, token: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorSecret: true, twoFactorEnabled: true },
      });

      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        return false;
      }

      return authenticator.verify({ token, secret: user.twoFactorSecret });
    } catch (error) {
      logger.error('Error validating 2FA token:', error);
      return false;
    }
  }

  /**
   * Check if user has 2FA enabled
   */
  async has2FAEnabled(userId: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      });
      return user?.twoFactorEnabled ?? false;
    } catch (error) {
      logger.error('Error checking 2FA status:', error);
      return false;
    }
  }

  /**
   * Login with 2FA verification
   */
  async loginWith2FA(
    credentials: LoginCredentials,
    twoFactorToken: string,
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

      // Check 2FA
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new Error('2FA is not enabled for this user');
      }

      // Verify 2FA token
      const is2FAValid = authenticator.verify({
        token: twoFactorToken,
        secret: user.twoFactorSecret,
      });

      if (!is2FAValid) {
        throw new Error('Invalid 2FA code');
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

      logger.info(`User logged in with 2FA: ${user.email}`);

      return {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          avatar: user.avatar,
          twoFactorEnabled: user.twoFactorEnabled,
          mustChangePassword: user.mustChangePassword,
        },
        session: {
          id: session.id,
          userId: session.userId,
          token: session.token,
          expiresAt: session.expiresAt,
        },
      };
    } catch (error) {
      logger.error('Error logging in with 2FA:', error);
      throw error;
    }
  }

  /**
   * Admin reset 2FA for a user (no token required)
   * Used when a user loses access to their authenticator app
   */
  async adminReset2FA(userId: string): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorEnabled: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });

      logger.info(`Admin reset 2FA for user: ${userId}`);
    } catch (error) {
      logger.error('Error admin resetting 2FA:', error);
      throw error;
    }
  }
}

export default new AuthService();
