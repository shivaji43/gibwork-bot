import fetch from 'node-fetch';
import { 
  Keypair, 
  Connection, 
  PublicKey,
  VersionedTransaction,
  TransactionExpiredBlockheightExceededError
} from '@solana/web3.js';
import * as bs58 from 'bs58';
import { BountyCommand, BountyRequestPayload, BountyResponse } from './types';
import { WALLET_PRIVATE_KEY, WALLET_PUBLIC_KEY, SOLANA_RPC_URL } from './config';
import { commentOnIssue, getIssueFromUrl, getRepositoryFromUrl, getRepoInfoFromUrl } from './github';

// Create a Solana connection with higher commitment level
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Get the wallet keypair
const getWalletKeypair = (): Keypair => {
  const privateKeyBytes = bs58.decode(WALLET_PRIVATE_KEY);
  return Keypair.fromSecretKey(privateKeyBytes);
};

// Create a bounty task and get response with serialized transaction
export const createBountyTransaction = async (command: BountyCommand): Promise<BountyResponse> => {
  try {
    // Get issue details
    const issueDetails = await getIssueFromUrl(command.issueUrl);
    
    // Get repository details
    const repository = await getRepositoryFromUrl(issueDetails.repository_url);
    
    const payload: BountyRequestPayload = {
      token: {
        mintAddress: command.tokenAddress,
        amount: command.amount
      },
      title: issueDetails.title,
      content: issueDetails.body || 'No description provided',
      requirements: 'PR to be merged',
      tags: [repository.language || 'unknown'],
      payer: WALLET_PUBLIC_KEY,
      isHidden: true // Make the bounty private and only accessible via link
    };
    
    const response = await fetch('https://api2.gib.work/tasks/public/transaction', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create bounty: ${response.statusText}. Details: ${errorText}`);
    }
    
    return await response.json() as BountyResponse;
  } catch (error) {
    console.error('Error creating bounty transaction:', error);
    throw error;
  }
};

// Check if a transaction is confirmed by signature
export const checkTransactionStatus = async (signature: string): Promise<boolean> => {
  try {
    // Get the transaction status
    const status = await connection.getSignatureStatus(signature, {
      searchTransactionHistory: true
    });
    
    // If status is null, the transaction is not found
    if (!status || !status.value) {
      return false;
    }
    
    // Check if the transaction was confirmed
    return status.value.confirmationStatus === 'confirmed' || 
           status.value.confirmationStatus === 'finalized';
  } catch (error) {
    console.error('Error checking transaction status:', error);
    return false;
  }
};

// Sign and send transaction with improved error handling
export const signAndSendTransaction = async (serializedTransaction: string): Promise<string> => {
  try {
    console.log('Preparing to sign and send transaction...');
    
    // Get wallet keypair
    const wallet = getWalletKeypair();
    
    // Deserialize the transaction
    const serializedTransactionBuffer = Buffer.from(serializedTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(serializedTransactionBuffer);
    
    // Sign the transaction
    transaction.sign([wallet]);
    
    // Send the transaction with higher commitment and more retries
    const signature = await connection.sendTransaction(transaction, {
      preflightCommitment: 'processed', // Use 'processed' for faster acceptance
      maxRetries: 5
    });
    console.log(`Transaction sent with signature: ${signature}`);
    
    try {
      // Get the latest blockhash for confirmation
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      
      // More tolerant confirmation parameters
      const confirmationConfig = {
        signature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
      };
      
      // Try to confirm with a timeout
      await Promise.race([
        connection.confirmTransaction(confirmationConfig, 'confirmed'),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Confirmation timeout')), 60000)
        )
      ]);
      
      console.log(`Transaction confirmed with signature: ${signature}`);
    } catch (confirmError : any) {
      // If confirmation fails, check if the transaction was actually successful
      console.warn(`Confirmation error: ${confirmError.message}`);
      
      // Wait a moment to let the transaction propagate
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Check transaction status directly
      const isConfirmed = await checkTransactionStatus(signature);
      
      if (isConfirmed) {
        console.log(`Transaction ${signature} was confirmed despite confirmation error`);
      } else if (confirmError instanceof TransactionExpiredBlockheightExceededError) {
        // For this specific error, the transaction might still be valid
        console.log(`Block height exceeded but transaction may still be valid: ${signature}`);
        
        // Make additional checks with longer timeout
        for (let i = 0; i < 3; i++) {
          await new Promise(resolve => setTimeout(resolve, 5000));
          const retryConfirmed = await checkTransactionStatus(signature);
          if (retryConfirmed) {
            console.log(`Transaction ${signature} confirmed after retry check`);
            break;
          }
        }
      } else {
        throw new Error(`Transaction may have failed: ${confirmError.message}`);
      }
    }
    
    return signature;
  } catch (error : any) {
    // If the error contains a signature, the transaction was sent but confirmation failed
    if (error.signature) {
      console.warn(`Error confirming transaction, but it has a signature: ${error.signature}`);
      return error.signature;
    }
    
    console.error('Error signing and sending transaction:', error);
    throw error;
  }
};

// Process a bounty command
export const processBountyCommand = async (command: BountyCommand): Promise<void> => {
  let transactionSignature: string | null = null;
  let bountyResponse: BountyResponse | null = null;
  
  try {
    console.log(`Processing bounty command: ${command.amount} tokens for issue ${command.issueUrl}`);
    
    // Create the bounty transaction
    bountyResponse = await createBountyTransaction(command);
    
    // Sign and send the transaction
    transactionSignature = await signAndSendTransaction(bountyResponse.serializedTransaction);
    console.log(`Transaction processed with signature: ${transactionSignature}`);
    
    // Get the issue details for commenting
    const issueDetails = await getIssueFromUrl(command.issueUrl);
    const { owner, repo } = getRepoInfoFromUrl(issueDetails.repository_url);
    
    // Format token type for display
    const tokenType = command.tokenAddress === 'So11111111111111111111111111111111111111112' ? 'SOL' : 
                      command.tokenAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : 
                      'tokens';
    
    // Generate URLs
    const explorerUrl = `https://explorer.solana.com/tx/${transactionSignature}`;
    const bountyUrl = `https://app.gib.work/tasks/${bountyResponse.taskId}`;
    
    // Check transaction status one more time before commenting
    const isConfirmed = await checkTransactionStatus(transactionSignature);
    const statusNote = isConfirmed ? 
      'Transaction confirmed.' : 
      'Transaction submitted but confirmation is pending. You can check its status using the transaction link below.';
    
    // Comment on the issue with the bounty confirmation
    await commentOnIssue(
      owner,
      repo,
      issueDetails.number,
      `✅ Bounty created successfully!\n\n` +
      `Bounty ID: ${bountyResponse.taskId}\n` +
      `Amount: ${command.amount} ${tokenType}\n` +
      `${statusNote}\n\n` +
      `🔗 Links:\n` +
      `- Bounty: [View on Gib.work](${bountyUrl}) (Private bounty, only accessible via this link)\n` +
      `- Transaction: [View on Solana Explorer](${explorerUrl})\n\n` +
      `Thank you for contributing to the project!`
    );
    
    console.log(`Bounty created successfully. ID: ${bountyResponse.taskId}`);
  } catch (error) {
    console.error('Error processing bounty command:', error);
    
    // If we have a transaction signature but encountered an error during confirmation,
    // we should still check if the transaction was actually successful
    if (transactionSignature && bountyResponse) {
      try {
        const isSuccessful = await checkTransactionStatus(transactionSignature);
        if (isSuccessful) {
          console.log(`Despite errors, transaction ${transactionSignature} appears to be successful`);
          
          // Handle as a successful transaction
          const issueDetails = await getIssueFromUrl(command.issueUrl);
          const { owner, repo } = getRepoInfoFromUrl(issueDetails.repository_url);
          
          // Format token type for display
          const tokenType = command.tokenAddress === 'So11111111111111111111111111111111111111112' ? 'SOL' : 
                          command.tokenAddress === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' ? 'USDC' : 
                          'tokens';
          
          // Generate URLs
          const explorerUrl = `https://explorer.solana.com/tx/${transactionSignature}`;
          const bountyUrl = `https://app.gib.work/tasks/${bountyResponse.taskId}`;
          
          await commentOnIssue(
            owner,
            repo,
            issueDetails.number,
            `✅ Bounty created successfully (with confirmation issues)!\n\n` +
            `We encountered some issues confirming the transaction, but it appears to have been successful.\n` +
            `Amount: ${command.amount} ${tokenType}\n\n` +
            `🔗 Links:\n` +
            `- Bounty: [View on Gib.work](${bountyUrl}) (Private bounty, only accessible via this link)\n` +
            `- Transaction: [View on Solana Explorer](${explorerUrl})\n\n` +
            `Please verify the transaction status using the links above.`
          );
          
          return;
        }
      } catch (statusCheckError) {
        console.error('Error checking transaction status:', statusCheckError);
      }
    }
    
    // Get the issue details for commenting about the error
    try {
      const issueDetails = await getIssueFromUrl(command.issueUrl);
      const { owner, repo } = getRepoInfoFromUrl(issueDetails.repository_url);
      
      // Comment on the issue with the error
      let errorMessage = (error as Error).message;
      
      // If we have a transaction signature, include it in the error message
      if (transactionSignature) {
        const explorerUrl = `https://explorer.solana.com/tx/${transactionSignature}`;
        
        // If we have a bounty ID, include it in the error message
        if (bountyResponse && bountyResponse.taskId) {
          const bountyUrl = `https://app.gib.work/tasks/${bountyResponse.taskId}`;
          errorMessage += `\n\nTransaction was sent but confirmation failed. The bounty may still have been created:\n` +
                         `- Bounty: [View on Gib.work](${bountyUrl}) (Private bounty, only accessible via this link)\n` +
                         `- Transaction: [View on Solana Explorer](${explorerUrl})`;
        } else {
          errorMessage += `\n\nTransaction was sent but confirmation failed. You can check its status here: [${transactionSignature}](${explorerUrl})`;
        }
      }
      
      await commentOnIssue(
        owner,
        repo,
        issueDetails.number,
        `❌ Issue with bounty creation: ${errorMessage}`
      );
    } catch (commentError) {
      console.error('Error posting failure comment:', commentError);
    }
  }
};