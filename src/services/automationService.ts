import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { JobFilter, JobEntry } from "../types";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";

export class AutomationService {
  private ai: GoogleGenAI;
  private model = "gemini-3-flash-preview"; 
  private snsClient: SNSClient | null = null;

  constructor(apiKey: string, awsConfig?: { region?: string; accessKeyId?: string; secretAccessKey?: string }) {
    this.ai = new GoogleGenAI({ apiKey });
    
    if (awsConfig?.accessKeyId && awsConfig?.secretAccessKey) {
      this.snsClient = new SNSClient({
        region: awsConfig.region || "us-east-1",
        credentials: {
          accessKeyId: awsConfig.accessKeyId,
          secretAccessKey: awsConfig.secretAccessKey
        }
      });
    }
  }

  async updateAWSConfig(awsConfig: { region?: string; accessKeyId?: string; secretAccessKey?: string }) {
    if (awsConfig.accessKeyId && awsConfig.secretAccessKey) {
      this.snsClient = new SNSClient({
        region: awsConfig.region || "us-east-1",
        credentials: {
          accessKeyId: awsConfig.accessKeyId,
          secretAccessKey: awsConfig.secretAccessKey
        }
      });
    }
  }

  async sendDirectSMS(phoneNumber: string, message: string) {
    if (!this.snsClient) return;
    try {
      await this.withRetry(async () => {
        const command = new PublishCommand({
          PhoneNumber: phoneNumber,
          Message: message,
        });
        await this.snsClient?.send(command);
      });
    } catch (error) {
      console.error("Direct SMS failed after retries:", error);
      throw error;
    }
  }

  async sendSNSAlert(topicArn: string, message: string) {
    if (!this.snsClient) {
      console.warn("SNS Client not initialized. Check AWS credentials.");
      return;
    }

    // Guard against common user error: Provide IAM ARN instead of SNS Topic ARN
    if (topicArn.includes(":iam::")) {
      throw new Error(`The provided ARN is an IAM User ARN (${topicArn}). You MUST provide an Amazon SNS Topic ARN (starts with 'arn:aws:sns:').`);
    }

    try {
      await this.withRetry(async () => {
        const command = new PublishCommand({
          TopicArn: topicArn,
          Message: message,
          Subject: "NexusFlow Sentinel Update"
        });
        await this.snsClient?.send(command);
      });
    } catch (error) {
      console.error("SNS Alert failed after retries:", error);
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        
        // Check for specific Gemini API quota issues
        const errorMsg = error.message || "";
        const isQuotaExceeded = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED') || errorMsg.includes('quota');
        
        if (isQuotaExceeded) {
          console.warn("AI Quota Limit Detected. Attempting backoff...");
          // If it's a quota issue, we might want a longer delay
          const delay = Math.pow(3, i) * 2000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        const isTransient = error instanceof Error && 
          (error.message.includes('500') || error.message.includes('fetch') || error.message.includes('timeout'));
        
        if (!isTransient) throw error;
        
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  async discoverJobs(filter: JobFilter): Promise<JobEntry[]> {
    const urlContext = filter.platformUrls && Object.keys(filter.platformUrls).length > 0 
      ? `\nSpecific Search URLs to prioritize:\n${Object.entries(filter.platformUrls)
          .map(([p, u]) => `- ${p}: ${u}`).join('\n')}`
      : '';

    const prompt = `Act as a high-precision job discovery engine for ${filter.role} roles with ${filter.experience} experience.
    Target Platforms: ${filter.platforms.join(', ')}
    ${urlContext}
    
    CRITICAL INSTRUCTIONS:
    1. Find EXACTLY 5 LIVE, active job listings posted TODAY (last 24-48 hours).
    2. Use Google Search to find jobs on ${filter.platforms.join(', ')}.
    3. For EACH result, you MUST provide a URL that is a DIRECT JOB VIEW page. 
       - LinkedIn: MUST be /jobs/view/ID
       - Indeed: MUST be /viewjob?jk=ID
       - Naukri: MUST be /job-listings-ID
       - Apna: MUST be /job-ID
    4. AVOID generic search pages (e.g., indeed.com/jobs?q=...).
    5. VERIFY RECENTNESS: Only return jobs where you are 100% sure they are currently active.
    6. If a Specific Search URL was provided, extract the MOST RECENT jobs from that specific feed first.
    
    Return a STRICT JSON array of objects:
    { "id": "uuid", "title": "Job Title", "company": "Company Name", "platform": "Platform Name", "url": "https://..." }`;

    try {
      const response = await this.withRetry(() => this.ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json"
        }
      }));

      const results = JSON.parse(response.text || "[]");
      return results.map((r: any) => ({
        ...r,
        status: 'pending',
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error("Job discovery failed after retries:", error);
      return [];
    }
  }

  async tailorResume(resumeText: string, jobDescription: string): Promise<string> {
    const prompt = `I will provide my resume and a job description. 
    Modify my resume to better align with the job requirements while maintaining truthfulness.
    Focus on keywords, relevant skills, and wording used in the JD.
    
    RESUME:
    ${resumeText}
    
    JOB DESCRIPTION:
    ${jobDescription}
    
    Return the FULL modified resume in Markdown format.`;

    try {
      const response = await this.withRetry(() => this.ai.models.generateContent({
        model: this.model,
        contents: prompt
      }));
      return response.text || "Failed to tailor resume.";
    } catch (error) {
      console.error("Resume tailoring failed after retries:", error);
      return "Error tailoring resume.";
    }
  }

  async generateCoverLetter(resumeText: string, jobTitle: string, company: string): Promise<string> {
    const prompt = `Write a compelling, professional cover letter for the position of ${jobTitle} at ${company}.
    Use the following resume as a reference for background and skills.
    
    RESUME:
    ${resumeText}
    
    The cover letter should be tailored to the company, enthusiastic, and under 300 words. 
    Return the cover letter in professional format.`;

    try {
      const response = await this.withRetry(() => this.ai.models.generateContent({
        model: this.model,
        contents: prompt
      }));
      return response.text || "Failed to generate cover letter.";
    } catch (error) {
      console.error("Cover letter generation failed:", error);
      return "Error generating cover letter.";
    }
  }

  async interactWithHR(platform: string, context: string): Promise<string> {
    const prompt = `Generate a professional message to an HR/Recruiter on ${platform}.
    Context: ${context}
    The message should be concise, professional, and personalized.`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview", // Flash is enough for simple messaging
        contents: prompt
      });
      return response.text || "";
    } catch (error) {
      console.error("HR interaction failed:", error);
      return "";
    }
  }

  async debugLogs(logs: string[]): Promise<string> {
    const prompt = `Act as the NexusFlow Sentinel AI Debugger.
    Review the following system logs from an automated recruitment agent and pinpoint the exact cause of any failures.
    Provide actionable, concise advice for the user to fix the issue.
    If multiple errors exist, prioritize the most critical ones.
    
    SYSTEM LOGS:
    ${logs.join('\n')}
    
    Format your response with a clear 'DIAGNOSIS' and 'ACTION PLAN'.`;

    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-3.1-pro-preview", // Use Pro for better analysis
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });
      return response.text || "No critical failures detected in log trajectory.";
    } catch (error) {
      console.error("Debug logs failed:", error);
      return "AI Debugger failed to analyze logs. Check network connectivity.";
    }
  }
}
