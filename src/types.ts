export interface GitHubComment {
    id: number;
    body: string;
    user: {
      login: string;
    };
    issue_url: string;
    created_at: string;
  }
  
  export interface GitHubIssue {
    id: number;
    title: string;
    body: string;
    number: number;
    html_url: string;
    repository_url: string;
  }
  
  export interface GitHubRepository {
    name: string;
    full_name: string;
    language: string;
    owner: {
      login: string;
    };
  }
  
  export interface BountyCommand {
    amount: number;
    tokenAddress: string;
    issueUrl: string;
  }
  
  export interface BountyRequestPayload {
    token: {
      mintAddress: string;
      amount: number;
    };
    title: string;
    content: string;
    requirements: string;
    tags: string[];
    payer: string;
    isHidden?: boolean; 
  }
  
  export interface BountyResponse {
    taskId: string;
    serializedTransaction: string;
  }
  
  export interface GibworkCreateTaskResponse {
    status: string;
    taskId: string;
    signature: string;
  }
  
  // Auth related types
  export interface AuthorizedUser {
    username: string;
  }