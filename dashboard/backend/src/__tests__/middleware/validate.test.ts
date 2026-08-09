import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { validate } from '../../middleware/validate';
import { LoginSchema, RegisterSchema, FeedbackSchema } from '../../middleware/schemas';

const mockReq = (body: unknown = {}): Request =>
  ({ body, params: {}, query: {} }) as unknown as Request;

const mockRes = () => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockNext = vi.fn() as unknown as NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validate middleware', () => {
  describe('LoginSchema', () => {
    it('passes valid login data to next()', () => {
      const req = mockReq({ email: 'user@example.com', password: 'secret' });
      const res = mockRes();
      validate(LoginSchema)(req, res, mockNext);
      expect(mockNext).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid email', () => {
      const req = mockReq({ email: 'not-an-email', password: 'secret' });
      const res = mockRes();
      validate(LoginSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Validation failed',
          details: expect.arrayContaining([expect.objectContaining({ field: 'email' })]),
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('returns 400 when password is empty', () => {
      const req = mockReq({ email: 'user@example.com', password: '' });
      const res = mockRes();
      validate(LoginSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('strips unknown fields from body', () => {
      const req = mockReq({ email: 'user@example.com', password: 'secret', extra: 'hacked' });
      const res = mockRes();
      validate(LoginSchema)(req, res, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect((req as any).body.extra).toBeUndefined();
    });
  });

  describe('RegisterSchema', () => {
    const validRegister = {
      email: 'user@example.com',
      username: 'testuser',
      password: 'Admin123!',
      captchaToken: 'signed-token',
      captchaSolution: '7',
    };

    it('passes valid registration data', () => {
      const req = mockReq(validRegister);
      const res = mockRes();
      validate(RegisterSchema)(req, res, mockNext);
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('rejects password without uppercase letter', () => {
      const req = mockReq({ ...validRegister, password: 'admin123!' });
      const res = mockRes();
      validate(RegisterSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects password without special character', () => {
      const req = mockReq({ ...validRegister, password: 'Admin1234' });
      const res = mockRes();
      validate(RegisterSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects username with special characters', () => {
      const req = mockReq({ ...validRegister, username: 'user name!' });
      const res = mockRes();
      validate(RegisterSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects username shorter than 3 characters', () => {
      const req = mockReq({ ...validRegister, username: 'ab' });
      const res = mockRes();
      validate(RegisterSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe('FeedbackSchema honeypot', () => {
    const validFeedback = {
      type: 'bug',
      title: 'Something is broken',
      description: 'It crashes when I click submit button',
      urgency: 'high',
      website: '', // honeypot — must be empty
    };

    it('passes feedback with empty honeypot', () => {
      const req = mockReq(validFeedback);
      const res = mockRes();
      validate(FeedbackSchema)(req, res, mockNext);
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('rejects feedback with non-empty honeypot (bot detection)', () => {
      const req = mockReq({ ...validFeedback, website: 'http://spam.com' });
      const res = mockRes();
      validate(FeedbackSchema)(req, res, mockNext);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
