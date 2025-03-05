import { Octokit } from '@octokit/rest';
import { BountyCommand, GitHubComment, GitHubIssue, GitHubRepository } from './types';
import { GITHUB_TOKEN, isAuthorized } from './config';

const octokit = new Octokit({
  auth: GITHUB_TOKEN
});

// Parse a comment for bounty commands
export const parseBountyCommand = (comment: GitHubComment): BountyCommand | null => {
  const regex = /\/bounty\s+(\d+(?:\.\d+)?)\s+([\w\d]{32,44})/i;
  const match = comment.body.match(regex);
  
  if (match && isAuthorized(comment.user.login)) {
    return {
      amount: parseFloat(match[1]),
      tokenAddress: match[2],
      issueUrl: comment.issue_url
    };
  }
  
  return null;
};

// Get recent comments from a repository
export const getRecentComments = async (owner: string, repo: string): Promise<GitHubComment[]> => {
  try {
    const { data } = await octokit.issues.listCommentsForRepo({
      owner,
      repo,
      sort: 'created',
      direction: 'desc',
      per_page: 100 // Adjust as needed
    });
    
    return data as GitHubComment[];
  } catch (error) {
    console.error(`Error getting comments for ${owner}/${repo}:`, error);
    return [];
  }
};

// Get issue details from issue URL
export const getIssueFromUrl = async (issueUrl: string): Promise<GitHubIssue> => {
  const { data } = await octokit.request(`GET ${issueUrl}`);
  return data as GitHubIssue;
};

// Get repository details from repository URL
export const getRepositoryFromUrl = async (repoUrl: string): Promise<GitHubRepository> => {
  const { data } = await octokit.request(`GET ${repoUrl}`);
  return data as GitHubRepository;
};

// Post a comment on an issue
export const commentOnIssue = async (
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> => {
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body
  });
};

// Extract owner and repo from a repository full name
export const parseRepoFullName = (fullName: string): { owner: string; repo: string } => {
  const [owner, repo] = fullName.split('/');
  return { owner, repo };
};

// Extract owner and repo from repository URL
export const getRepoInfoFromUrl = (repoUrl: string): { owner: string, repo: string } => {
  const urlParts = repoUrl.split('/');
  // Assuming URL format like https://api.github.com/repos/owner/repo
  const ownerIndex = urlParts.indexOf('repos') + 1;
  return {
    owner: urlParts[ownerIndex],
    repo: urlParts[ownerIndex + 1]
  };
};