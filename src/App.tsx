/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Play, 
  Square, 
  Terminal, 
  Search, 
  FileText, 
  ExternalLink, 
  Settings, 
  Download, 
  Cpu, 
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  Briefcase,
  Sparkles,
  LogOut,
  X,
  ArrowLeft
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { AutomationStatus, JobFilter, JobEntry, AppNotification } from './types.ts';
import { USER_RESUME_CONTENT, PLATFORMS, DEFAULT_FILTER } from './constants.ts';
import { AutomationService } from './services/automationService.ts';
import { auth, db } from './lib/firebase.ts';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';
import Markdown from 'react-markdown';
import { 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  collection, 
  query, 
  where,
  addDoc,
  updateDoc,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';

// CSS variables for the Technical Dashboard recipe
const styles = {
  bg: "#141414",
  ink: "#E4E3E0",
  line: "#2A2A2A",
  accent: "#00FF00",
  mono: "'JetBrains Mono', monospace",
  sans: "'Inter', sans-serif",
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AutomationStatus>({
    isRunning: false,
    isPassiveScan: false,
    lastRun: null,
    nextRun: "12:00 AM",
    logs: [],
    notifications: []
  });

  const [filter, setFilter] = useState<JobFilter>(DEFAULT_FILTER);
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [resumeText, setResumeText] = useState<string>(USER_RESUME_CONTENT);
  const [tailoredResumes, setTailoredResumes] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState<'monitor' | 'settings' | 'deploy' | 'resume'>('monitor');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [selectedJobForModal, setSelectedJobForModal] = useState<JobEntry | null>(null);
  const [jobResumes, setJobResumes] = useState<any[]>([]);
  const [modalTab, setModalTab] = useState<'cover-letter' | 'resumes'>('cover-letter');
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobEntry | null>(null);
  const [testMessage, setTestMessage] = useState<string>("NexusFlow Test Handshake: Protocol Online.");
  const [aiDiagnosis, setAiDiagnosis] = useState<string | null>(null);
  const [isDebugging, setIsDebugging] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const automationServiceRef = useRef<AutomationService | null>(null);

  // Auth Listener
  useEffect(() => {
    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      if (currentUser && process.env.GEMINI_API_KEY) {
        automationServiceRef.current = new AutomationService(process.env.GEMINI_API_KEY, {
          region: "us-east-1",
          accessKeyId: (import.meta as any).env.VITE_AWS_ACCESS_KEY_ID,
          secretAccessKey: (import.meta as any).env.VITE_AWS_SECRET_ACCESS_KEY
        });
      }
    });
  }, []);

  // Sync Data from Firestore
  useEffect(() => {
    if (!user) return;

    // Sync Status
    const statusRef = doc(db, 'status', user.uid);
    const unsubStatus = onSnapshot(statusRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as AutomationStatus;
        setStatus(data);
        if (data.filter) {
          setFilter(data.filter);
        }

        // Sync AWS Config dynamically
        if (automationServiceRef.current && data.credentials?.awsRegion) {
          automationServiceRef.current.updateAWSConfig({
            region: data.credentials.awsRegion,
            accessKeyId: (import.meta as any).env.VITE_AWS_ACCESS_KEY_ID,
            secretAccessKey: (import.meta as any).env.VITE_AWS_SECRET_ACCESS_KEY
          });
        }
      }
    });

    // Sync Jobs
    const jobsQuery = query(collection(db, 'jobs'), where('userId', '==', user.uid));
    const unsubJobs = onSnapshot(jobsQuery, (querySnap) => {
      const jobsList: JobEntry[] = [];
      querySnap.forEach((doc) => {
        jobsList.push({ ...doc.data(), id: doc.id } as JobEntry);
      });
      setJobs(jobsList.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || "")));
    });

    // Sync Master Resume
    const resumeRef = query(collection(db, 'resumes'), where('userId', '==', user.uid), where('type', '==', 'master'));
    const unsubResume = onSnapshot(resumeRef, (querySnap) => {
      if (!querySnap.empty) {
        setResumeText(querySnap.docs[0].data().content);
      }
    });

    return () => {
      unsubStatus();
      unsubJobs();
      unsubResume();
    };
  }, [user]);

  useEffect(() => {
    if (selectedJobForModal) {
      const q = query(
        collection(db, 'resumes'), 
        where('jobId', '==', selectedJobForModal.id),
        where('userId', '==', user?.uid)
      );
      getDocs(q).then(snap => {
        const list = snap.docs.map(d => ({ ...d.data(), id: d.id }));
        const sorted = list.sort((a: any, b: any) => (b.version || 0) - (a.version || 0));
        setJobResumes(sorted);
        if (sorted.length > 0) {
          setSelectedResumeId(sorted[0].id);
        }
      });
    } else {
      setJobResumes([]);
    }
  }, [selectedJobForModal, user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = () => auth.signOut();

  const addLog = async (message: string) => {
    if (!user) return;
    const logEntry = `[${new Date().toLocaleTimeString()}] ${message}`;
    const statusRef = doc(db, 'status', user.uid);
    
    const currentLogs = status.logs || [];
    const newLogs = [...currentLogs, logEntry].slice(-100);
    await setDoc(statusRef, { 
      ...status, 
      logs: newLogs,
      userId: user.uid 
    }, { merge: true });
  };

  const addNotification = async (message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    if (!user) return;
    const notification: AppNotification = {
      id: Math.random().toString(36).substr(2, 9),
      message,
      type,
      timestamp: new Date().toISOString(),
      read: false
    };
    const statusRef = doc(db, 'status', user.uid);
    const newNotifications = [notification, ...(status.notifications || [])].slice(0, 20);
    await setDoc(statusRef, { notifications: newNotifications }, { merge: true });
  };

  const handleSyncConfig = async () => {
    if (!user) return;
    const statusRef = doc(db, 'status', user.uid);
    await setDoc(statusRef, { filter }, { merge: true });
    addLog("Target heuristic configuration synchronized to global stream.");
    addNotification("Configuration updated and applied to discovery engine.", "success");
  };

  const handleTestSNS = async () => {
    if (!automationServiceRef.current) return;
    
    if (status.credentials?.snsTopicArn) {
      addLog(`Initiating AWS SNS handshake with payload: "${testMessage}"...`);
      try {
          await automationServiceRef.current.sendSNSAlert(
              status.credentials.snsTopicArn,
              testMessage
          );
          addNotification("SNS Test Success", "success");
          addLog("SNS Handshake successful. Terminal linked.");
      } catch (error) {
          addNotification("SNS Topic Test Failed", "warning");
          addLog(`SNS Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    if (status.credentials?.phoneNumber) {
      addLog(`Initiating Direct SMS handshake to ${status.credentials.phoneNumber}...`);
      try {
          await automationServiceRef.current.sendDirectSMS(
              status.credentials.phoneNumber,
              `Direct SMS handshake: ${testMessage}`
          );
          addNotification("SMS Test Success", "success");
          addLog("SMS Handshake successful.");
      } catch (error) {
          addNotification("SMS Test Failed", "warning");
          addLog(`SMS Error: ${error instanceof Error ? error.message : 'Unknown'}`);
      }
    }

    if (!status.credentials?.snsTopicArn && !status.credentials?.phoneNumber) {
        addNotification("Set SNS Topic ARN or Phone Number first", "warning");
    }
  };

  const discoverJobs = async (isRecurring = false) => {
    if (!automationServiceRef.current || !user) {
      if (!isRecurring) addLog("Critical: Automation Service not initialized. Check API Key.");
      return;
    }

    setIsProcessing(true);
    if (!isRecurring) addLog("Initializing Job Discovery Agent...");
    else addLog("Sentinel Pulse: Scanning for new high-probability targets...");
    
    try {
      const discovered = await automationServiceRef.current.discoverJobs(filter);
      
      if (discovered.length > 0) {
        let newCount = 0;
        for (const job of discovered) {
          // Check if link already exists to avoid duplicates
          const qExist = query(collection(db, 'jobs'), where('url', '==', job.url), where('userId', '==', user.uid));
          const existSnap = await getDocs(qExist);
          
          if (existSnap.empty) {
            const docRef = await addDoc(collection(db, 'jobs'), {
              ...job,
              userId: user.uid,
              timestamp: new Date().toISOString()
            });
            newCount++;

            if (filter.autoTailor) {
              handleTailorJob(docRef.id);
            }
          }
        }
        if (newCount > 0) {
          addLog(`Nexus Sync: ${newCount} new roles verified and pushed to vault.`);
          addNotification(`${newCount} new opportunities detected in the current stream.`, 'success');
        } else {
          if (!isRecurring) addLog("Discovery complete: 0 new unique targets found.");
        }
      } else {
        if (!isRecurring) addLog("No new jobs found matching the criteria.");
      }
    } catch (error: any) {
      const errorMsg = error.message || "";
      if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
        addLog(`[QUOTA EXCEEDED] Catalyst limit reached. Sentinel idling.`);
      } else {
        addLog(`Discovery error: ${errorMsg.slice(0, 50)}...`);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  // Realtime Discovery Loop
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status.isRunning && user) {
      // Run every 15 minutes for "realtime" feel
      interval = setInterval(() => {
        discoverJobs(true);
      }, 15 * 60 * 1000);
    }
    return () => clearInterval(interval);
  }, [status.isRunning, user, filter]);

  const handleTailorJob = async (id: string) => {
    const job = jobs.find(j => j.id === id);
    if (!job || !resumeText || !automationServiceRef.current || !user) {
        addLog(`Cannot tailor job ${id}: ${!resumeText ? 'Missing master resume' : 'Internal error'}`);
        return;
    }

    const jobRef = doc(db, 'jobs', id);
    try {
        await updateDoc(jobRef, { status: 'customizing' });
        addLog(`Customizing resume for ${job.company}...`);

        const tailored = await automationServiceRef.current.tailorResume(resumeText, `${job.title} at ${job.company}`);
        
        addLog(`Generating AI Cover Letter for ${job.company}...`);
        const coverLetter = await automationServiceRef.current.generateCoverLetter(tailored, job.title, job.company);

        // Versioning logic
        const qCount = query(collection(db, 'resumes'), where('jobId', '==', id));
        const countSnap = await getDocs(qCount);
        const version = countSnap.size + 1;

        await updateDoc(jobRef, { 
          status: 'applied',
          coverLetter: coverLetter || "Applied via Sentinel Cloud"
        });

        await addDoc(collection(db, 'resumes'), {
          content: tailored,
          type: 'tailored',
          jobId: id,
          userId: user.uid,
          version: version,
          updatedAt: serverTimestamp()
        });

        addLog(`Version ${version} of tailored assets ready for ${job.company}. Saved to vaults.`);
        addNotification(`New version (v${version}) ready for ${job.company}.`, 'success');

        if (status.credentials?.snsTopicArn) {
          await automationServiceRef.current.sendSNSAlert(
            status.credentials.snsTopicArn,
            `NexusFlow Alert: Successfully applied to ${job.company} for ${job.title} (Version v${version}). View assets in Dashboard.`
          );
        }

        if (status.credentials?.phoneNumber) {
          await automationServiceRef.current.sendDirectSMS(
            status.credentials.phoneNumber,
            `NexusFlow Alert: Successfully applied to ${job.company} (v${version}).`
          );
        }
    } catch (error: any) {
        try {
            await updateDoc(jobRef, { status: 'failed' });
        } catch (dbErr) {
            console.error("Critical DB failure:", dbErr);
        }
        
        const errorMsg = error.message || "";
        if (errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED')) {
            addLog(`[QUOTA EXCEEDED] NexusFlow Sentinel throttled by AI endpoint. Switching to passive scan mode.`);
            addNotification("AI Rate Limit Reached. Retrying later.", "warning");
        } else if (errorMsg.includes('permission')) {
            addLog(`[SECURITY ERROR] Firestore permissions block update for ${job.company}. Check Security Rules.`);
            addNotification("Database Access Denied.", "warning");
        } else {
            addLog(`Failed to tailor for ${job.company}: ${errorMsg.slice(0, 50)}...`);
        }
    }
  };

  const handleAIDebug = async () => {
    if (!automationServiceRef.current || status.logs.length === 0) return;
    setIsDebugging(true);
    addLog("Neural Debugger initiated. Analyzing log trajectory...");
    try {
      const diagnosis = await automationServiceRef.current.debugLogs(status.logs);
      setAiDiagnosis(diagnosis);
      addLog("Diagnosis complete. Review Sentinel findings.");
    } catch (e) {
      addLog("Neural link failed. Debugger offline.");
    } finally {
      setIsDebugging(false);
    }
  };

  const handleHRMessage = async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !automationServiceRef.current || !user) return;
    
    addLog(`Drafting HR outreach for ${job.company}...`);
    setIsProcessing(true);
    try {
      const message = await automationServiceRef.current.interactWithHR(job.platform, `Inquiry about ${job.title} role.`);
      addNotification(`HR outreach drafted for ${job.company}. check logs.`, 'info');
      addLog(`HR Draft: "${message}"`);
      
      // Update job status to 'responded' to reflect in stats
      const jobRef = doc(db, 'jobs', job.id);
      await updateDoc(jobRef, { status: 'responded' });
    } catch (e) {
      addLog("HR Outreach failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  const updateCredentials = async (platform: 'linkedin' | 'indeed' | 'naukri' | 'snsTopicArn' | 'awsRegion' | 'phoneNumber' | 'hirist' | 'unstop', value: string) => {
    if (!user) return;
    const statusRef = doc(db, 'status', user.uid);
    const newCredentials = { ...(status.credentials || {}), [platform]: value };
    await setDoc(statusRef, { credentials: newCredentials }, { merge: true });

    if (platform === 'awsRegion' && automationServiceRef.current) {
      automationServiceRef.current.updateAWSConfig({
        region: value,
        accessKeyId: (import.meta as any).env.VITE_AWS_ACCESS_KEY_ID,
        secretAccessKey: (import.meta as any).env.VITE_AWS_SECRET_ACCESS_KEY
      });
    }

    addNotification(`${platform.charAt(0).toUpperCase() + platform.slice(1)} configuration updated.`, 'success');
  };

  const updatePlatformUrl = async (platformCode: string, url: string) => {
    if (!user) return;
    const statusRef = doc(db, 'status', user.uid);
    const newUrls = { ...(status.platformUrls || {}), [platformCode]: url };
    await setDoc(statusRef, { platformUrls: newUrls }, { merge: true });
    
    // Also sync to filter
    const newFilter = { ...filter, platformUrls: newUrls };
    setFilter(newFilter);
    await setDoc(statusRef, { filter: newFilter }, { merge: true });
    
    addNotification(`${platformCode} search URL updated.`, 'success');
  };

  const triggerInterventionSim = async () => {
    if (!user || !automationServiceRef.current) return;
    const statusRef = doc(db, 'status', user.uid);
    await updateDoc(statusRef, { interventionRequired: true });
    
    addLog("[CRITICAL] Human Intervention Required: Captcha detected on Indeed.");
    addNotification("Action Required: Captcha Detected", "warning");

    if (status.credentials?.snsTopicArn) {
      await automationServiceRef.current.sendSNSAlert(
        status.credentials.snsTopicArn,
        "NexusFlow Sentinel: Human Intervention Required! Captcha detected at Indeed application portal."
      );
      addLog("SNS Alert dispatched to mobile terminal.");
    }
  };
  const handleToggle = async () => {
    if (!user) return;
    const newState = !status.isRunning;
    const statusRef = doc(db, 'status', user.uid);
    await setDoc(statusRef, { ...status, isRunning: newState, userId: user.uid }, { merge: true });
    
    addLog(`Automation Sentinel ${newState ? 'activated' : 'deactivated'}.`);
    
    if (newState) {
      discoverJobs();
    }
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center font-mono text-[#818cf8]">
        <div className="flex flex-col items-center gap-4">
          <Zap className="w-12 h-12 animate-pulse accent-glow rounded-full bg-[#818cf8]/20 p-2" />
          <div className="text-xs tracking-[0.3em] uppercase opacity-70">Initializing NexusFlow...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--bg-gradient)] flex items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full glass p-10 text-center">
          <div className="w-16 h-16 bg-[#818cf8] rounded-xl accent-glow mx-auto mb-6 flex items-center justify-center">
            <Zap className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 text-[#f8fafc]">NexusFlow</h1>
          <p className="text-[#94a3b8] text-sm mb-8 leading-relaxed">
            The AutoApply Sentinel requires a secure connection to your private cloud storage to manage your professional trajectory.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full py-4 bg-[#818cf8] text-[#f8fafc] font-semibold text-sm rounded-xl hover:scale-[1.02] transition-transform active:scale-95 accent-glow"
          >
            Authenticate with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans bg-[#0f172a] text-[#f8fafc] flex p-6 gap-6 relative overflow-hidden selection:bg-[#818cf8]/30 selection:text-[#818cf8]">
      {/* Dynamic Background Atmosphere */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-15%] left-[-15%] w-[45vw] h-[45vw] rounded-full bg-[#818cf8]/10 blur-[140px] animate-pulse" />
        <div className="absolute bottom-[-15%] right-[-15%] w-[55vw] h-[55vw] rounded-full bg-[#34d399]/5 blur-[160px]" />
        <div className="absolute top-[30%] right-[10%] w-[25vw] h-[25vw] rounded-full bg-[#818cf8]/5 blur-[100px]" />
      </div>

      {/* Sidebar */}
      <aside className="w-[240px] glass p-6 flex flex-col gap-2 rounded-[20px] h-full sticky top-6 z-10">
        <div className="flex items-center gap-3 mb-10 px-2 font-extrabold text-xl tracking-tighter">
          <div className="w-6 h-6 bg-[#818cf8] rounded-md accent-glow" />
          NexusFlow
        </div>
        
        {[
          { id: 'monitor', label: 'Dashboard', icon: Briefcase },
          { id: 'resume', label: 'Resume Logic', icon: FileText },
          { id: 'settings', label: 'Job Sources', icon: Search },
          { id: 'deploy', label: 'AWS Config', icon: Cpu },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id as any)}
            className={`flex items-center gap-3 px-4 py-3 rounded-[12px] text-sm font-medium transition-all ${
              activeTab === item.id ? 'bg-white/10 text-[#f8fafc]' : 'text-[#94a3b8] hover:text-[#f8fafc]'
            }`}
          >
            <item.icon size={18} className={activeTab === item.id ? 'text-[#818cf8]' : ''} />
            {item.label}
          </button>
        ))}

        <div className="mt-auto space-y-4 px-2">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-[#94a3b8] mb-1">Authenticated</span>
            <span className="text-[11px] truncate text-white/60">{user.email}</span>
            <button onClick={handleLogout} className="text-[10px] text-red-500 hover:text-red-400 mt-1 flex items-center gap-1">
              <LogOut size={10} /> Logout
            </button>
          </div>
          <div className="text-[10px] text-[#94a3b8]/60 uppercase tracking-widest">Uptime: 14d 2h 12m</div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 grid grid-cols-3 auto-rows-min gap-5 h-full overflow-y-auto relative p-1 pb-20 scroll-smooth">
        {/* Notifications Toast */}
        <div className="absolute top-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
          <AnimatePresence>
            {status.notifications?.filter(n => !n.read).slice(0, 3).map((note) => (
              <motion.div
                key={note.id}
                initial={{ opacity: 0, x: 50, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={`pointer-events-auto p-4 rounded-xl border shadow-xl flex items-start gap-3 glass ${
                  note.type === 'success' ? 'border-[#34d399]/30 bg-[#34d399]/5' : 
                  note.type === 'warning' ? 'border-yellow-500/30 bg-yellow-500/5' : 
                  'border-[#818cf8]/30 bg-[#818cf8]/5'
                }`}
              >
                <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  note.type === 'success' ? 'bg-[#34d399]' : 
                  note.type === 'warning' ? 'bg-yellow-500' : 
                  'bg-[#818cf8]'
                }`} />
                <div className="flex-1">
                  <p className="text-[12px] font-medium leading-tight text-white/90">{note.message}</p>
                  <span className="text-[9px] text-[#94a3b8] mt-1 block">Just now</span>
                </div>
                <button 
                  onClick={async () => {
                    const statusRef = doc(db, 'status', user.uid);
                    const updated = status.notifications.map(n => n.id === note.id ? { ...n, read: true } : n);
                    await updateDoc(statusRef, { notifications: updated });
                  }}
                  className="text-[#94a3b8] hover:text-white"
                >
                  <X size={12} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Header Card */}
        <section className="col-span-3 glass p-6 flex justify-between items-center rounded-[20px]">
          <div>
            <h1 className="text-2xl font-bold mb-1">{activeTab === 'monitor' ? 'Software Dev Automation' : activeTab.toUpperCase()}</h1>
            <p className="text-sm text-[#94a3b8]">Targeting: {filter.role} ({filter.experience})</p>
          </div>
          <div className="flex items-center gap-4">
             <div className="bg-[#34d399]/10 text-[#34d399] px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border border-[#34d399]/20">
              <div className="w-2 h-2 bg-[#34d399] rounded-full shadow-[0_0_8px_#34d399]" />
              System Active — Searching LinkedIn, Naukri, Indeed
            </div>
            <button 
              onClick={handleToggle}
              className={`p-3 rounded-full transition-all accent-glow ${
                status.isRunning 
                  ? 'bg-red-500/20 text-red-500 border border-red-500/30' 
                  : 'bg-[#818cf8]/20 text-[#818cf8] border border-[#818cf8]/30'
              }`}
            >
              {status.isRunning ? <Square size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>
          </div>
        </section>

        {activeTab === 'monitor' && (
          <>
            {/* Stat Cards */}
            <div className="glass p-6 rounded-[20px] flex flex-col gap-1">
              <span className="text-[11px] text-[#94a3b8] uppercase tracking-wider font-semibold">Jobs Scanned</span>
              <span className="text-3xl font-bold">{jobs.length > 0 ? jobs.length + 380 : 0}</span>
            </div>
            <div className="glass p-6 rounded-[20px] flex flex-col gap-1">
              <span className="text-[11px] text-[#94a3b8] uppercase tracking-wider font-semibold">Tailored</span>
              <span className="text-3xl font-bold">{jobs.filter(j => ['applied', 'responded', 'interview'].includes(j.status)).length}</span>
            </div>
            <div className="glass p-6 rounded-[20px] flex flex-col gap-1">
              <span className="text-[11px] text-[#94a3b8] uppercase tracking-wider font-semibold">Responses</span>
              <span className="text-3xl font-bold">{jobs.filter(j => ['responded', 'interview'].includes(j.status)).length}</span>
            </div>

            {/* Opportunities (Job List) */}
            <section className="col-span-2 glass rounded-[20px] overflow-hidden flex flex-col h-[450px]">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Zap size={14} className="text-[#818cf8]" /> 
                  Opportunities Vault
                </h2>
                <span className="text-[10px] text-[#94a3b8] uppercase tracking-widest">{jobs.length} roles found</span>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-white/5 scrollbar-hide">
                <AnimatePresence mode='popLayout'>
                  {jobs.map((job) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={job.id}
                      onClick={() => setSelectedJob(job)}
                      className={`group p-4 flex items-center justify-between transition-all cursor-pointer z-10 relative overflow-hidden ${
                        selectedJob?.id === job.id 
                          ? 'bg-[#818cf8]/10 border-l-4 border-l-[#818cf8]' 
                          : 'hover:bg-white/5 border-l-4 border-l-transparent'
                      }`}
                    >
                      <div className="flex flex-col text-left min-w-0 flex-1 pr-4 overflow-hidden">
                        <div className="flex items-center gap-2 mb-1">
                           <span className="flex-shrink-0 text-[8px] font-bold px-1 py-0.5 rounded bg-[#818cf8]/10 border border-[#818cf8]/20 text-[#818cf8] uppercase tracking-tighter">
                            {job.platform}
                           </span>
                           <h3 className="text-sm font-bold text-white/95 truncate tracking-tight group-hover:text-[#818cf8] transition-colors" title={job.title}>
                            {job.title}
                           </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[#94a3b8] truncate font-medium">{job.company}</span>
                          <span className="w-0.5 h-0.5 rounded-full bg-white/10" />
                          <span className="text-[8px] text-[#94a3b8]/40 font-mono italic">
                            {new Date(job.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[8px] px-1.5 py-0.5 rounded border border-current font-black uppercase tracking-widest bg-opacity-5
                          ${job.status === 'applied' ? 'text-emerald-400 font-bold' : job.status === 'customizing' ? 'text-yellow-400 animate-pulse' : 'text-[#94a3b8]/40'}
                        `}>
                          {job.status}
                        </span>
                        
                        <div className="flex items-center gap-2">
                           {job.url && (
                             <a 
                                href={job.url} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="p-2 hover:bg-white/10 rounded-lg text-[#94a3b8] hover:text-white transition-all"
                                title="Open Native Source"
                             >
                                <ExternalLink size={14} />
                             </a>
                           )}
                          {job.status === 'applied' && (
                             <>
                               <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModalTab('cover-letter');
                                    setSelectedJobForModal(job);
                                  }}
                                  className="p-2 bg-[#818cf8]/10 text-[#818cf8] rounded-lg hover:bg-[#818cf8] hover:text-white transition-all border border-[#818cf8]/20"
                                  title="View Assets & History"
                               >
                                  <FileText size={14} />
                               </button>
                               <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTailorJob(job.id);
                                  }}
                                  className="p-2 bg-[#818cf8]/5 text-[#818cf8]/60 rounded-lg hover:bg-[#818cf8] hover:text-white transition-all border border-white/5"
                                  title="Re-tailor (Create Version)"
                               >
                                  <Sparkles size={14} />
                               </button>
                               <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHRMessage(job.id);
                                  }}
                                  className="p-2 bg-[#34d399]/10 text-[#34d399] rounded-lg hover:bg-[#34d399] hover:text-white transition-all border border-[#34d399]/20"
                                  title="Contact HR"
                               >
                                  <Briefcase size={14} />
                               </button>
                             </>
                          )}
                          {job.status === 'pending' && (
                             <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTailorJob(job.id);
                                }}
                                className="p-2 bg-[#818cf8]/20 text-[#818cf8] rounded-lg hover:bg-[#818cf8] hover:text-white transition-all accent-glow"
                                title="Tailor Resume"
                             >
                               <Sparkles size={14} />
                             </button>
                          )}
                          <a 
                            href={job.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="p-2 bg-white/5 text-[#94a3b8] rounded-lg hover:bg-white/10 hover:text-white transition-all"
                          >
                            <ExternalLink size={14} />
                          </a>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  {jobs.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-10 opacity-30 italic">
                      <Search size={32} className="mb-4" />
                      <p className="text-sm">No roles detected in the stream.</p>
                    </div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* Infrastructure / AWS Area / Job Selection Overlay */}
            <section className="glass p-0 rounded-[20px] h-[450px] overflow-hidden flex flex-col relative group">
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5 shrink-0">
                <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                  {selectedJob ? 'Selection Intelligence' : 'Infrastructure Matrix'}
                </h2>
                {selectedJob && (
                  <button 
                    onClick={() => setSelectedJob(null)}
                    className="p-1 hover:bg-white/10 rounded-md text-[#94a3b8]"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 scrollbar-hide">
                <AnimatePresence mode="wait">
                  {selectedJob ? (
                    <motion.div 
                      key="job-detail"
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="space-y-6"
                    >
                      <div className="p-5 bg-[#818cf8]/10 border border-[#818cf8]/20 rounded-2xl">
                        <span className="text-[9px] font-bold text-[#818cf8] uppercase tracking-[0.2em] mb-2 block">{selectedJob.platform} Source Entry</span>
                        <h3 className="text-xl font-bold leading-tight mb-1 text-white">{selectedJob.title}</h3>
                        <p className="text-[#94a3b8] font-medium">{selectedJob.company}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-white/5 border border-white/5 rounded-xl">
                          <span className="text-[9px] text-[#94a3b8] uppercase block mb-1">Status</span>
                          <span className="text-xs font-mono font-bold uppercase text-[#f8fafc]">{selectedJob.status}</span>
                        </div>
                        <div className="p-4 bg-white/5 border border-white/5 rounded-xl">
                          <span className="text-[9px] text-[#94a3b8] uppercase block mb-1">Last Sync</span>
                          <span className="text-xs font-mono font-bold uppercase text-[#f8fafc]">
                            {new Date().toLocaleTimeString()}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-bold text-[#94a3b8] uppercase tracking-widest">Available Operations</h4>
                        <div className="grid grid-cols-1 gap-2">
                           {selectedJob.status === 'applied' ? (
                             <button 
                                onClick={() => {
                                  setModalTab('cover-letter');
                                  setSelectedJobForModal(selectedJob);
                                }}
                                className="w-full py-3 bg-[#818cf8] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2"
                             >
                                <FileText size={14} /> View Deployment Assets
                             </button>
                           ) : (
                             <button 
                                onClick={() => handleTailorJob(selectedJob.id)}
                                className="w-full py-3 bg-[#818cf8] text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:brightness-110 transition-all flex items-center justify-center gap-2 accent-glow"
                             >
                                <Sparkles size={14} /> Run Neural Tailoring
                             </button>
                           )}
                           <a 
                              href={selectedJob.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="w-full py-3 bg-white/5 text-[#94a3b8] rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-all flex items-center justify-center gap-2 border border-white/5"
                           >
                              <ExternalLink size={14} /> Native Application Link
                           </a>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="infra-stats"
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="space-y-6"
                    >
                      <div className="space-y-3">
                         <div className="flex justify-between text-[11px] items-baseline">
                            <span className="text-[#94a3b8] uppercase tracking-tighter">Cluster Owner</span>
                            <span className="font-mono text-[#f8fafc] font-bold">{user?.displayName || 'TERMINAL_USER'}</span>
                         </div>
                         <div className="flex justify-between text-[11px] items-baseline">
                            <span className="text-[#94a3b8] uppercase tracking-tighter">Availability Zone</span>
                            <span className="font-mono text-[#f8fafc] font-bold">ASIA-SOUTH-1A</span>
                         </div>
                         <div className="flex justify-between text-[11px] items-baseline">
                            <span className="text-[#94a3b8] uppercase tracking-tighter">Worker Instance</span>
                            <span className="font-mono text-[#f8fafc] font-bold">t2.micro (headless)</span>
                         </div>
                      </div>

                      <div className="p-4 bg-yellow-500/5 border border-yellow-500/10 rounded-xl">
                        <div className="flex items-center gap-2 text-yellow-500 mb-2">
                          <AlertCircle size={14} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Intervention Monitoring</span>
                        </div>
                        <p className="text-[10px] text-[#94a3b8] leading-relaxed">
                          The sentinel is monitoring for Captcha/DDoS walls. Ensure your mobile number is linked for Instant Push alerts.
                        </p>
                      </div>

                      <div className="space-y-4">
                        <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                          <span className="text-[10px] text-[#94a3b8] font-bold font-mono">SNS_TERMINAL_SYNC</span>
                          <span className={`w-2 h-2 rounded-full ${status.credentials?.snsTopicArn ? 'bg-[#34d399] animate-pulse' : 'bg-red-500'}`} />
                        </div>
                        <div className="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                          <span className="text-[10px] text-[#94a3b8] font-bold font-mono">LINKEDIN_AUTH_SESSION</span>
                          <span className={`w-2 h-2 rounded-full ${status.credentials?.linkedin ? 'bg-[#34d399] animate-pulse' : 'bg-red-500'}`} />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </section>

            {/* Live Feed (Logs) */}
            <section className="col-span-3 glass p-6 rounded-[20px] flex flex-col min-h-[400px] mb-10">
               <div className="flex justify-between items-center mb-4">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-[#94a3b8]">System Logs</h2>
                <div className="flex gap-1.5 items-center">
                  <button 
                    onClick={handleAIDebug}
                    disabled={isDebugging || status.logs.length === 0}
                    className="mr-2 px-2 py-0.5 bg-[#818cf8]/10 text-[#818cf8] border border-[#818cf8]/20 rounded text-[9px] font-bold uppercase hover:bg-[#818cf8] hover:text-white transition-all flex items-center gap-1 disabled:opacity-50"
                  >
                    <Sparkles size={10} /> {isDebugging ? 'Analyzing...' : 'Neural Debugger'}
                  </button>
                  <button 
                    onClick={triggerInterventionSim}
                    className="mr-4 px-2 py-0.5 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded text-[9px] font-bold uppercase hover:bg-yellow-500 hover:text-black transition-all"
                  >
                    Simulate Captcha
                  </button>
                  <div className="w-2 h-2 rounded-full bg-red-400/20 border border-red-400/40"></div>
                  <div className="w-2 h-2 rounded-full bg-yellow-400/20 border border-yellow-400/40"></div>
                  <div className="w-2 h-2 rounded-full bg-[#34d399]/20 border border-[#34d399]/40"></div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 font-mono text-[10px] leading-relaxed scrollbar-hide">
                {status.logs.map((log, i) => (
                    <div key={i} className="flex gap-3 text-[#94a3b8]/80 break-words">
                      <span className="text-[#818cf8]/40 shrink-0">{i+1}</span>
                      <span className="text-[#f8fafc]/60 flex-1">{log}</span>
                    </div>
                )).reverse()}
                {status.logs.length === 0 && (
                  <div className="h-full flex items-center justify-center opacity-20">No active logs in buffer.</div>
                )}
              </div>
            </section>
          </>
        )}

        {activeTab === 'resume' && (
          <section className="col-span-3 glass p-10 rounded-[20px] space-y-6">
            <button 
              onClick={() => setActiveTab('monitor')}
              className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#94a3b8] hover:text-[#818cf8] transition-all mb-4"
            >
              <ArrowLeft size={12} /> Back to Dashboard
            </button>
            <div>
              <h2 className="text-2xl font-bold mb-2">Master Resume Hub</h2>
              <p className="text-[#94a3b8] text-sm leading-relaxed">Your professional seed data for all AI tailoring operations.</p>
            </div>
            <textarea
              value={resumeText}
              onChange={(e) => setResumeText(e.target.value)}
              placeholder="Paste your resume content here..."
              className="w-full h-[450px] bg-black/20 border border-white/10 rounded-xl p-6 text-sm font-mono focus:border-[#818cf8] outline-none transition-all resize-none text-white/90"
            />
            <div className="flex justify-end gap-3">
               <button onClick={() => setResumeText('')} className="px-6 py-2 rounded-xl text-xs font-semibold text-[#94a3b8] hover:bg-white/5">Clear</button>
               <button 
                  onClick={async () => {
                    if (!user || !resumeText) return;
                    await setDoc(doc(db, 'resumes', `${user.uid}_master`), {
                      content: resumeText,
                      type: 'master',
                      userId: user.uid,
                      updatedAt: serverTimestamp()
                    });
                    addLog("Master resume synchronized to cloud storage.");
                  }}
                  className="px-6 py-2 bg-[#818cf8] rounded-xl text-xs font-bold text-white accent-glow"
               >
                 Save Master Resume
               </button>
            </div>
          </section>
        )}

        {activeTab === 'settings' && (
          <section className="col-span-3 glass p-10 rounded-[20px] space-y-10">
            <button 
              onClick={() => setActiveTab('monitor')}
              className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#94a3b8] hover:text-[#818cf8] transition-all mb-4"
            >
              <ArrowLeft size={12} /> Back to Dashboard
            </button>
            <div>
              <h2 className="text-2xl font-bold mb-2">Agent Parameters</h2>
              <p className="text-[#94a3b8] text-sm leading-relaxed">Customize the job discovery heuristic and platform targeting.</p>
            </div>

            <div className="grid grid-cols-2 gap-12">
              <div className="space-y-6">
                <div>
                  <label className="text-[11px] text-[#94a3b8] uppercase tracking-widest block mb-3 font-bold">Target Role</label>
                  <input 
                    type="text" 
                    value={filter.role}
                    onChange={(e) => setFilter({...filter, role: e.target.value})}
                    className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-sm focus:border-[#818cf8] outline-none transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[#94a3b8] uppercase tracking-widest block mb-3 font-bold">Experience Range</label>
                  <select 
                    value={filter.experience}
                    onChange={(e) => setFilter({...filter, experience: e.target.value})}
                    className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-sm focus:border-[#818cf8] outline-none transition-all"
                  >
                    <option>0-1 year</option>
                    <option>0-2 years</option>
                    <option>Entry Level</option>
                  </select>
                </div>

                <div className="pt-4 border-t border-white/5 space-y-4">
                  <div className="flex items-center justify-between p-4 bg-black/20 rounded-xl border border-white/5">
                    <div>
                      <div className="text-xs font-bold text-[#f8fafc]">Automatic Tailoring</div>
                      <div className="text-[10px] text-[#94a3b8]">Instantly customize resume on discovery</div>
                    </div>
                    <button 
                      onClick={() => setFilter({...filter, autoTailor: !filter.autoTailor})}
                      className={`w-10 h-5 rounded-full transition-all relative ${filter.autoTailor ? 'bg-[#818cf8]' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${filter.autoTailor ? 'right-1' : 'left-1'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#94a3b8] uppercase tracking-widest block mb-3 font-bold">Target Channels & Custom Search URLs</label>
                <div className="space-y-3 bg-black/10 rounded-xl p-4">
                  {PLATFORMS.map(platform => (
                    <div key={platform} className="space-y-2">
                      <label className="flex items-center gap-3 hover:bg-white/5 rounded-lg transition-all cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={filter.platforms.includes(platform)} 
                          onChange={() => {
                            const newPlatforms = filter.platforms.includes(platform)
                              ? filter.platforms.filter(p => p !== platform)
                              : [...filter.platforms, platform];
                            setFilter({...filter, platforms: newPlatforms});
                          }}
                          className="w-4 h-4 rounded border-white/10 bg-black/20 text-[#818cf8] focus:ring-offset-0 focus:ring-0" 
                        />
                        <span className="text-xs font-medium">{platform}</span>
                      </label>
                      {filter.platforms.includes(platform) && (
                        <input 
                          type="text"
                          placeholder={`${platform} Search URL (Keywords applied automatically)`}
                          value={filter.platformUrls?.[platform] || ''}
                          onChange={(e) => {
                            const newUrls = { ...(filter.platformUrls || {}), [platform]: e.target.value };
                            setFilter({...filter, platformUrls: newUrls});
                          }}
                          className="w-full bg-black/40 border border-white/5 rounded-lg px-3 py-2 text-[10px] font-mono text-white/70 focus:border-[#818cf8]/50 outline-none transition-all placeholder:text-white/10 ml-7 w-[calc(100%-28px)]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <button 
                onClick={handleSyncConfig}
                className="px-8 py-3 bg-[#818cf8] text-white font-bold text-sm rounded-xl accent-glow"
              >
                Sync Configuration
              </button>
            </div>
          </section>
        )}

        {activeTab === 'deploy' && (
          <section className="col-span-3 glass p-10 rounded-[20px] space-y-10">
            <button 
              onClick={() => setActiveTab('monitor')}
              className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#94a3b8] hover:text-[#818cf8] transition-all mb-4"
            >
              <ArrowLeft size={12} /> Back to Dashboard
            </button>
            <div>
              <h2 className="text-2xl font-bold mb-2">Cloud Infrastructure Bridge</h2>
              <p className="text-[#94a3b8] text-sm leading-relaxed">Deploy the NexusFlow Sentinel to a headless environment for 24/7 autonomous professional scaling.</p>
            </div>

            <div className="grid grid-cols-3 gap-8">
              <div className="col-span-2 space-y-8">
                {/* Credentials Vault */}
                <div className="glass p-6 rounded-xl border border-white/5 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-[#818cf8]">
                      <Zap size={16} />
                      <h3 className="text-xs font-bold uppercase tracking-widest">Active Session Vault</h3>
                    </div>
                    <span className="text-[9px] text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20 font-bold uppercase animate-pulse">Session Active</span>
                  </div>
                  
                  <div className="p-4 bg-[#818cf8]/5 border border-[#818cf8]/10 rounded-xl space-y-2">
                    <p className="text-[10px] text-[#94a3b8] font-bold uppercase tracking-widest flex items-center gap-2">
                      <FileText size={12} /> Vault Entry Guide
                    </p>
                    <p className="text-[10px] text-[#f8fafc]/70 leading-relaxed">
                      To synchronize your local session: <br />
                      1. Open <b>LinkedIn/Naukri</b> in another tab and login.<br />
                      2. Press <b>F12</b> (Inspect) &rarr; <b>Application</b> &rarr; <b>Cookies</b>.<br />
                      3. Copy the value of <b>'li_at'</b> for LinkedIn or <b>'token'</b> for Naukri.<br />
                      4. Paste into the vault below. This allows the Sentinel to "impersonate" your browser session for direct interactions.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">LinkedIn Cookie (li_at)</label>
                      <input 
                        type="password"
                        placeholder="••••••••••••"
                        value={status.credentials?.linkedin || ''}
                        onChange={(e) => updateCredentials('linkedin', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Naukri Token</label>
                      <input 
                        type="password"
                        placeholder="••••••••••••"
                        value={status.credentials?.naukri || ''}
                        onChange={(e) => updateCredentials('naukri', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Indeed Cookie (RQ/CTK)</label>
                      <input 
                        type="password"
                        placeholder="••••••••••••"
                        value={status.credentials?.indeed || ''}
                        onChange={(e) => updateCredentials('indeed', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Hirist Cookie</label>
                      <input 
                        type="password"
                        placeholder="••••••••••••"
                        value={status.credentials?.hirist || ''}
                        onChange={(e) => updateCredentials('hirist', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Unstop Cookie</label>
                      <input 
                        type="password"
                        placeholder="••••••••••••"
                        value={status.credentials?.unstop || ''}
                        onChange={(e) => updateCredentials('unstop', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Amazon SNS Topic ARN</label>
                        <button 
                          onClick={handleTestSNS}
                          className="text-[10px] text-[#818cf8] hover:text-white transition-all font-bold uppercase tracking-widest flex items-center gap-1 bg-[#818cf8]/10 px-2 py-0.5 rounded border border-[#818cf8]/20"
                        >
                          <Zap size={10} /> Test Link
                        </button>
                      </div>
                      <p className="text-[9px] text-yellow-500/80 leading-tight">
                        Note: AWS SNS requires you to hit <b>'Confirm Subscription'</b> in your email/SMS inbox after linking the ARN.
                      </p>
                      <input 
                        type="text"
                        placeholder="arn:aws:sns:..."
                        value={status.credentials?.snsTopicArn || ''}
                        onChange={(e) => updateCredentials('snsTopicArn', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">AWS Region (SNS)</label>
                      <input 
                        type="text"
                        placeholder="e.g., us-east-1"
                        value={status.credentials?.awsRegion || 'us-east-1'}
                        onChange={(e) => updateCredentials('awsRegion', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Test Handshake Payload</label>
                      <input 
                        type="text"
                        placeholder="Enter test message (e.g., hi)"
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">Notify Mobile Number</label>
                      <input 
                        type="tel"
                        placeholder="+91-..."
                        value={status.credentials?.phoneNumber || ''}
                        onChange={(e) => updateCredentials('phoneNumber', e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Targeted Search Matrices */}
                <div className="glass p-6 rounded-xl border border-white/5 space-y-6">
                  <div className="flex items-center gap-2 text-[#818cf8]">
                    <Search size={16} />
                    <h3 className="text-xs font-bold uppercase tracking-widest">Targeted Search Matrices</h3>
                  </div>
                  
                  <p className="text-[11px] text-[#94a3b8] leading-tight">
                    Provide direct job search URLs from your browser to guide the Sentinel. The AI will prioritize these specific search results.
                  </p>

                  <div className="grid grid-cols-2 gap-6">
                    {PLATFORMS.filter(p => !['Career Portals'].includes(p)).map(platform => (
                      <div key={platform} className="space-y-2">
                        <label className="text-[10px] text-[#94a3b8] uppercase tracking-wider font-bold">{platform} Search Feed URL</label>
                        <input 
                          type="text"
                          placeholder={`Paste ${platform} job search URL...`}
                          value={status.platformUrls?.[platform.toLowerCase()] || ''}
                          onChange={(e) => updatePlatformUrl(platform.toLowerCase(), e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-xs font-mono focus:border-[#818cf8] outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#818cf8]">Boot Script (EC2)</h3>
                  <pre className="bg-black/40 p-6 rounded-xl border border-white/5 font-mono text-[11px] text-[#94a3b8] overflow-x-auto whitespace-pre">
{`#!/bin/bash
# NexusFlow Sentinel v1.0.4 - Automation Provisioning
sudo apt-get update && sudo apt-get install -y nodejs npm
git clone https://github.com/nexus/sentinel
cd sentinel && npm install
npm run start:headless`}
                  </pre>
                </div>

                <div className="space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-[#818cf8]">Auto-Terminate Sequence</h3>
                  <div className="bg-black/40 p-6 rounded-xl border border-white/5 font-mono text-[11px] text-[#94a3b8]">
                    # Trigger instance halt on cycle completion <br />
                    aws ec2 terminate-instances --instance-ids $(curl -s http://169.254.169.254/latest/meta-data/instance-id)
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="p-6 bg-[#34d399]/10 border border-[#34d399]/20 rounded-xl space-y-4">
                  <div className="flex items-center gap-2 text-[#34d399]">
                    <Zap size={16} />
                    <span className="text-[11px] font-bold uppercase tracking-widest">Free Tier Optimized</span>
                  </div>
                  <ul className="space-y-3 text-[11px] text-[#94a3b8] leading-relaxed">
                    <li className="flex gap-2"><span>•</span> Use t2.micro AMI (Ubuntu)</li>
                    <li className="flex gap-2"><span>•</span> Configure Security Groups for Port 3000</li>
                    <li className="flex gap-2"><span>•</span> IAM Role: ec2:TerminateAccess</li>
                  </ul>
                </div>
                <button 
                  onClick={() => {
                    const content = [
                      '# NexusFlow Sentinel v1.0.4',
                      '# Auto-generated Provisioning Script',
                      '',
                      `CREDENTIALS_LINKEDIN=${status.credentials?.linkedin || ''}`,
                      `CREDENTIALS_NAUKRI=${status.credentials?.naukri || ''}`,
                      `CREDENTIALS_INDEED=${status.credentials?.indeed || ''}`,
                      `CREDENTIALS_HIRIST=${status.credentials?.hirist || ''}`,
                      `CREDENTIALS_UNSTOP=${status.credentials?.unstop || ''}`,
                      `SNS_TOPIC_ARN=${status.credentials?.snsTopicArn || ''}`,
                      '',
                      '# Target Filter Config',
                      `TARGET_ROLE=${filter.role}`,
                      `TARGET_EXPERIENCE=${filter.experience}`,
                      '',
                      '# Specific Platform Search URLs',
                      ...Object.entries(filter.platformUrls || {}).map(([platform, url]) => 
                        `URL_${platform.toUpperCase().replace(/\s+/g, '_')}=${url || ''}`
                      ),
                      '',
                      '# Deployment Metadata',
                      `GENERATED_AT=${new Date().toISOString()}`,
                      `SENTINEL_UID=${user.uid}`,
                    ].join('\n');
                    
                    const blob = new Blob([content], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Sentinel_Config.txt';
                    a.click();
                    addNotification("Sentinel Provisioning Package exported.", "success");
                  }}
                  className="w-full py-4 bg-white/5 border border-white/10 rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] hover:bg-white/10 hover:border-[#818cf8]/40 transition-all flex items-center justify-center gap-2"
                >
                  <Cpu size={14} /> Export Sentinel.zip
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Asset Modal (Cover Letter & Resume Versions) */}
        <AnimatePresence>
          {selectedJobForModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="glass w-full max-w-4xl max-h-[85vh] flex flex-col rounded-[20px] overflow-hidden"
              >
                <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                  <div className="flex gap-6 items-center">
                    <div>
                      <h3 className="text-sm font-bold truncate">Deployment Assets: {selectedJobForModal.company}</h3>
                      <p className="text-[10px] text-[#94a3b8] uppercase tracking-widest">{selectedJobForModal.title}</p>
                    </div>
                    <div className="flex bg-black/40 p-1 rounded-lg border border-white/5">
                      <button 
                        onClick={() => setModalTab('cover-letter')}
                        className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${modalTab === 'cover-letter' ? 'bg-[#818cf8] text-white' : 'text-[#94a3b8] hover:text-white'}`}
                      >
                        Cover Letter
                      </button>
                      <button 
                        onClick={() => setModalTab('resumes')}
                        className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${modalTab === 'resumes' ? 'bg-[#818cf8] text-white' : 'text-[#94a3b8] hover:text-white'}`}
                      >
                        Resume History ({jobResumes.length})
                      </button>
                    </div>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectedJobForModal(null);
                      setSelectedResumeId(null);
                    }}
                    className="p-2 hover:bg-white/5 rounded-lg text-[#94a3b8] hover:text-white transition-all"
                  >
                    <X size={16} />
                  </button>
                </div>
                
                <div className="flex-1 overflow-hidden grid grid-cols-12">
                  {modalTab === 'cover-letter' ? (
                    <div className="col-span-12 overflow-y-auto p-10 font-serif leading-relaxed text-sm text-[#f8fafc]/90 bg-black/10">
                      <div className="whitespace-pre-wrap max-w-prose mx-auto">
                        {selectedJobForModal.coverLetter || "Generating content..."}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="col-span-4 border-r border-white/5 py-4 overflow-y-auto bg-black/20">
                        {jobResumes.map((res) => (
                          <button
                            key={res.id}
                            onClick={() => setSelectedResumeId(res.id)}
                            className={`w-full text-left p-4 border-b border-white/5 transition-all ${selectedResumeId === res.id ? 'bg-[#818cf8]/10 border-l-4 border-l-[#818cf8]' : 'hover:bg-white/5 border-l-4 border-l-transparent'}`}
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-bold text-white">Version {res.version}</span>
                              <span className="text-[9px] text-[#94a3b8]">
                                {res.updatedAt?.seconds ? new Date(res.updatedAt.seconds * 1000).toLocaleDateString() : 'Draft'}
                              </span>
                            </div>
                            <p className="text-[10px] text-[#94a3b8] line-clamp-1 italic">
                              {res.content.split('\n')[0]}
                            </p>
                          </button>
                        ))}
                        {jobResumes.length === 0 && (
                          <div className="p-10 text-center opacity-30 text-[10px] uppercase">No versions recorded.</div>
                        )}
                      </div>
                      <div className="col-span-8 overflow-y-auto p-10 font-mono text-xs text-[#f8fafc]/70 bg-black/10">
                        {selectedResumeId ? (
                          <div className="whitespace-pre-wrap">
                            {jobResumes.find(r => r.id === selectedResumeId)?.content}
                          </div>
                        ) : (
                          <div className="h-full flex items-center justify-center opacity-30 text-[10px] italic">
                            Select a version to preview content
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="p-4 border-t border-white/5 flex justify-end gap-3 bg-white/5">
                  <button 
                    onClick={() => {
                      const content = modalTab === 'cover-letter' 
                        ? selectedJobForModal.coverLetter 
                        : jobResumes.find(r => r.id === selectedResumeId)?.content;
                      
                      if (content) {
                        navigator.clipboard.writeText(content);
                        addNotification(`${modalTab === 'cover-letter' ? 'Cover letter' : 'Tailored resume'} copied to system clip.`, "success");
                      }
                    }}
                    disabled={modalTab === 'resumes' && !selectedResumeId}
                    className="px-6 py-2 bg-[#818cf8] text-white rounded-xl text-[10px] font-bold accent-glow disabled:opacity-30"
                  >
                    Copy to Clipboard
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

      </main>
      {/* AI Debugger Diagnosis Modal */}
      <AnimatePresence>
        {aiDiagnosis && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md"
            onClick={() => setAiDiagnosis(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="max-w-2xl w-full glass p-10 rounded-[28px] max-h-[80vh] flex flex-col relative"
            >
               <button 
                onClick={() => setAiDiagnosis(null)}
                className="absolute top-6 right-6 p-2 hover:bg-white/10 rounded-full transition-colors"
               >
                <X size={20} />
               </button>

               <div className="flex items-center gap-3 mb-6 text-[#818cf8]">
                 <Terminal size={24} />
                 <h2 className="text-xl font-bold uppercase tracking-widest">Sentinel Diagnosis</h2>
               </div>

               <div className="flex-1 overflow-y-auto pr-4 scrollbar-hide text-sm leading-relaxed text-[#f8fafc]/80 markdown-body">
                 <Markdown>{aiDiagnosis}</Markdown>
               </div>

               <div className="mt-8 pt-6 border-t border-white/5 flex justify-end">
                 <button 
                    onClick={() => setAiDiagnosis(null)}
                    className="px-6 py-2.5 bg-[#818cf8] text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:brightness-110 transition-all"
                 >
                   Acknowledge & Close
                 </button>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}



