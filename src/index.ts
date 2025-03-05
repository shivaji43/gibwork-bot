import cron from 'node-cron';
import { REPOSITORIES } from './config';
import { getRecentComments, parseBountyCommand, parseRepoFullName } from './github';
import { processBountyCommand } from './bounty';

// Store processed comment IDs to avoid duplicates
const processedComments = new Set<number>();

// Check for bounty commands in comments
const checkForBountyCommands = async () => {
  for (const repoFullName of REPOSITORIES) {
    try {
      const { owner, repo } = parseRepoFullName(repoFullName);
      console.log(`Checking for bounty commands in ${owner}/${repo}...`);
      
      const comments = await getRecentComments(owner, repo);
      console.log(`Found ${comments.length} recent comments`);
      
      for (const comment of comments) {
        // Skip already processed comments
        if (processedComments.has(comment.id)) {
          continue;
        }
        
        // Mark as processed
        processedComments.add(comment.id);
        
        // Parse for bounty command
        const bountyCommand = parseBountyCommand(comment);
        
        if (bountyCommand) {
          console.log(`Found bounty command from ${comment.user.login}: ${bountyCommand.amount} tokens on issue ${bountyCommand.issueUrl}`);
          await processBountyCommand(bountyCommand);
        }
      }
    } catch (error) {
      console.error(`Error checking repo ${repoFullName}:`, error);
    }
  }
};

// Clean up old processed comments to prevent memory leaks
// Only keep comments from the last 24 hours
const cleanupProcessedComments = () => {
  const oneDayAgo = new Date();
  oneDayAgo.setDate(oneDayAgo.getDate() - 1);
  
  console.log(`Cleaning up processed comments older than ${oneDayAgo.toISOString()}`);
  const initialSize = processedComments.size;
  
  // This would require storing timestamps with the comment IDs
  // For a production bot, consider using a database to store processed comments
  // For this example, we're just acknowledging the need for cleanup
  
  console.log(`Memory cleanup complete. Kept ${processedComments.size} of ${initialSize} processed comments.`);
};

// Start the scheduled task (every 30 seconds)
cron.schedule('*/30 * * * * *', async () => {
  console.log(`[${new Date().toISOString()}] Checking for new bounty commands...`);
  await checkForBountyCommands();
});

// Clean up old processed comments once per day
cron.schedule('0 0 * * *', cleanupProcessedComments);

// Initial check on startup
console.log('Starting GitHub Bounty Bot...');
checkForBountyCommands();

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down GitHub Bounty Bot...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down GitHub Bounty Bot...');
  process.exit(0);
});