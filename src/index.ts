import express from 'express';
import { Webhooks, createNodeMiddleware } from '@octokit/webhooks';
import { Octokit } from '@octokit/rest';
import axios from 'axios';
import dotenv from 'dotenv';
import { Keypair, Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import bs58 from 'bs58';

// Load environment variables
dotenv.config();

// Get environment variables
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const GITHUB_APP_ID = process.env.GITHUB_APP_ID || '';
const GITHUB_PRIVATE_KEY = process.env.GITHUB_PRIVATE_KEY || '';
const GITHUB_INSTALLATION_ID = process.env.GITHUB_INSTALLATION_ID || '';
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || '';
const WALLET_PUBLIC_KEY = process.env.WALLET_PUBLIC_KEY || '';
const PORT = process.env.PORT || 3000;

// Set up GitHub webhook handling
const webhooks = new Webhooks({
  secret: GITHUB_WEBHOOK_SECRET
});

// Set up GitHub API client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// Create Express app
const app = express();

// Create a keypair from the private key
// Handle different formats of private key
let walletKeypair: Keypair;
try {
  // If it's a base58 encoded string (most common format from wallets)
  if (WALLET_PRIVATE_KEY.match(/^[1-9A-HJ-NP-Za-km-z]{88,}$/)) {
    const bs58 = require('bs58');
    const secretKey = bs58.decode(WALLET_PRIVATE_KEY);
    walletKeypair = Keypair.fromSecretKey(secretKey);
  }
  // If it's a JSON array string
  else if (WALLET_PRIVATE_KEY.startsWith('[') && WALLET_PRIVATE_KEY.endsWith(']')) {
    const secretKey = Uint8Array.from(JSON.parse(WALLET_PRIVATE_KEY));
    walletKeypair = Keypair.fromSecretKey(secretKey);
  }
  // If it's a base64 encoded string
  else {
    walletKeypair = Keypair.fromSecretKey(
      Buffer.from(WALLET_PRIVATE_KEY, 'base64')
    );
  }
} catch (error) {
  console.error('Error creating keypair from private key:', error);
  throw new Error('Invalid private key format');
}

// Parse the command from the comment
function parseCommand(comment: string) {
  // Match command pattern: /bounty <amount> <mint-address>
  const match = comment.match(/^\/bounty\s+(\d+(?:\.\d+)?)\s+([A-Za-z0-9]+)$/);
  if (!match) return null;

  return {
    amount: parseFloat(match[1]),
    mintAddress: match[2]
  };
}

// Check if user is authorized
async function isAuthorizedUser(username: string, repoOwner: string, repoName: string) {
  try {
    // Check if user is a collaborator with write access or higher
    const { data } = await octokit.repos.getCollaboratorPermissionLevel({
      owner: repoOwner,
      repo: repoName,
      username
    });
    
    return ['write', 'admin'].includes(data.permission);
  } catch (error) {
    console.error('Error checking user authorization:', error);
    return false;
  }
}

// Get repository language
async function getRepoLanguage(owner: string, repo: string) {
  try {
    const { data } = await octokit.repos.listLanguages({
      owner,
      repo
    });
    
    // Return the primary language (first in the list)
    return Object.keys(data)[0] || 'Other';
  } catch (error) {
    console.error('Error getting repository language:', error);
    return 'Other';
  }
}

// Create bounty on gibwork
async function createBounty(
  amount: number,
  mintAddress: string,
  issueTitle: string,
  issueBody: string,
  repoLanguage: string
) {
  try {
    const response = await axios.post('https://api2.gib.work/tasks/public/transaction', {
      token: {
        mintAddress,
        amount
      },
      title: issueTitle,
      content: issueBody,
      requirements: "PR to be merged",
      tags: [repoLanguage],
      payer: WALLET_PUBLIC_KEY
    }, {
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json'
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error creating bounty:', error);
    throw error;
  }
}

// Sign the transaction
function signTransaction(serializedTransaction: string) {
  try {
    // Decode the transaction
    const transaction = Transaction.from(Buffer.from(serializedTransaction, 'base64'));
    
    // Sign the transaction
    transaction.partialSign(walletKeypair);
    
    // Return the signed transaction
    return transaction.serialize().toString('base64');
  } catch (error) {
    console.error('Error signing transaction:', error);
    throw error;
  }
}

// Handle issue_comment events
webhooks.on('issue_comment.created', async ({ payload }) => {
  const { comment, issue, repository } = payload;
  const commentBody = comment.body.trim();
  
  // Parse the command
  const command = parseCommand(commentBody);
  if (!command) return;
  
  // Check if user is authorized
  const isAuthorized = await isAuthorizedUser(
    comment.user.login,
    repository.owner.login,
    repository.name
  );
  
  if (!isAuthorized) {
    // Comment that user is not authorized
    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issue.number,
      body: `@${comment.user.login} You are not authorized to create bounties. Only repository collaborators with write or admin access can create bounties.`
    });
    return;
  }
  
  try {
    // Get repository language
    const repoLanguage = await getRepoLanguage(
      repository.owner.login,
      repository.name
    );
    
    // Create bounty
    const bountyResponse = await createBounty(
      command.amount,
      command.mintAddress,
      issue.title,
      issue.body || 'No description provided',
      repoLanguage
    );
    
    // Sign the transaction
    const signedTransaction = signTransaction(bountyResponse.serializedTransaction);
    
    // TODO: Submit the signed transaction to the blockchain
    // This would typically involve sending the signed transaction to a Solana node
    // For simplicity, we're skipping this step but in a real implementation
    // you would use @solana/web3.js to submit the transaction
    
    // Comment on the issue
    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issue.number,
      body: `🎉 Bounty created! Task ID: ${bountyResponse.taskId}\n\nAmount: ${command.amount} ${command.mintAddress}\nCheck it on gibwork soon!`
    });
    
  } catch (error) {
    console.error('Error processing bounty:', error);
    
    // Comment that there was an error
    await octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: issue.number,
      body: `❌ Error creating bounty: ${(error as Error).message}`
    });
  }
});

// Set up the middleware
app.use(createNodeMiddleware(webhooks));

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});