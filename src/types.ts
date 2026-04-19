export interface AutomationStatus {
  isRunning: boolean;
  isPassiveScan: boolean;
  lastRun: string | null;
  nextRun: string;
  logs: string[];
  notifications: AppNotification[];
  credentials?: {
    linkedin?: string;
    indeed?: string;
    naukri?: string;
    hirist?: string;
    unstop?: string;
    snsTopicArn?: string;
    phoneNumber?: string;
  };
  platformUrls?: Record<string, string>;
  interventionRequired?: boolean;
}

export interface AppNotification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning';
  timestamp: string;
  read: boolean;
}

export interface JobFilter {
  role: string;
  experience: string;
  platforms: string[];
  platformUrls?: Record<string, string>;
  autoTailor: boolean;
}

export interface JobEntry {
  id: string;
  title: string;
  company: string;
  platform: string;
  url: string;
  status: 'pending' | 'customizing' | 'applied' | 'failed';
  timestamp: string;
  coverLetter?: string;
}
