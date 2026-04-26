import { body, param, validationResult, ValidationChain } from 'express-validator'
import { Request, Response, NextFunction } from 'express'

export const handleValidation = (
  req: Request, res: Response, next: NextFunction
): void => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.type, message: e.msg }))
    })
    return
  }
  next()
}

export const registerValidation: ValidationChain[] = [
  body('email')
    .isEmail().withMessage('Valid email required')
    .normalizeEmail()
    .isLength({ max: 255 }),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must contain a special character'),
  body('username')
    .isLength({ min: 3, max: 30 }).withMessage('Username must be 3-30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Username can only contain letters, numbers, _ and -')
    .trim(),
  body('display_name')
    .optional()
    .isLength({ max: 60 }).withMessage('Display name max 60 characters')
    .trim().escape()
]

export const loginValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required')
]

export const repoValidation: ValidationChain[] = [
  param('owner')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Invalid owner format'),
  param('repo')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Invalid repo name format')
]
