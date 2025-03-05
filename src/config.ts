import dotenv from 'dotenv';
import { AuthorizedUser } from './types';

dotenv.config();

// Environment variables
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';
export const WALLET_PUBLIC_KEY = process.env.WALLET_PUBLIC_KEY || '';

// Solana network configuration
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// GitHub repositories to monitor
export const REPOSITORIES = (process.env.REPOSITORIES || '').split(',').filter(Boolean);

// Authorized users who can create bounties
export const AUTHORIZED_USERS: AuthorizedUser[] = 
  (process.env.AUTHORIZED_USERS || '')
    .split(',')
    .filter(Boolean)
    .map(username => ({ username }));

// Check if a user is authorized
export const isAuthorized = (username: string): boolean => {
  // If no authorized users are specified, no one is authorized
  if (AUTHORIZED_USERS.length === 0) {
    return false;
  }
  
  return AUTHORIZED_USERS.some(user => user.username.toLowerCase() === username.toLowerCase());
};

// Validation
if (!GITHUB_TOKEN) {
  throw new Error('GITHUB_TOKEN is required');
}

if (!WALLET_PRIVATE_KEY) {
  throw new Error('WALLET_PRIVATE_KEY is required');
}

if (!WALLET_PUBLIC_KEY) {
  throw new Error('WALLET_PUBLIC_KEY is required');
}

if (REPOSITORIES.length === 0) {
  throw new Error('REPOSITORIES is required');
}